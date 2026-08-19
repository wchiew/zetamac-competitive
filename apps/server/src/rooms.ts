import { randomInt, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  COUNTDOWN_MS,
  DEADLINE_GRACE_MS,
  DEFAULT_MODE,
  FILL_WINDOW_MS,
  JOIN_CODE_LENGTH,
  MAX_ANSWERS_PER_SECOND,
  MAX_PLAYERS,
  MIN_PLAYERS,
  SCORE_BROADCAST_INTERVAL_MS,
  randomSeed,
  toStandings,
  type LobbyPlayer,
  type LobbyState,
  type ServerMessage,
} from '@zmc/shared';

type Phase = 'lobby' | 'countdown' | 'running' | 'done';

interface Player {
  id: string;
  name: string;
  socket: WebSocket;
  /** Highest total the client has reported, before the rate cap is applied. */
  claimed: number;
  /** What the claim is worth right now, once the rate cap is applied. */
  score: number;
  connected: boolean;
}

const CODE_MAX = 10 ** JOIN_CODE_LENGTH;

/** Backstop sweep, in case an event-driven reap is ever missed. */
const REAP_INTERVAL_MS = 30_000;

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

/**
 * One lobby. The server is the sole authority on scores, on when a round
 * starts, and on when it ends — clients only ever report progress, which is
 * validated before it is believed.
 *
 * Public rooms are the matchmaking pool and start themselves once enough
 * players are present. Private rooms are reached by join code and wait for
 * their host.
 */
export class Room {
  readonly code: string;
  readonly isPublic: boolean;
  readonly createdAt = Date.now();
  readonly players = new Map<string, Player>();
  hostId = '';
  phase: Phase = 'lobby';
  /** Invoked when the last connected player leaves, so the registry can reap. */
  onEmpty: (() => void) | null = null;

  #fillDeadline = 0;
  #fillTimer: NodeJS.Timeout | null = null;
  #seed = 0;
  #startAt = 0;
  #endsAt = 0;
  #countdownTimer: NodeJS.Timeout | null = null;
  #broadcastTimer: NodeJS.Timeout | null = null;
  #endTimer: NodeJS.Timeout | null = null;

  constructor(code: string, isPublic: boolean) {
    this.code = code;
    this.isPublic = isPublic;
  }

  get connectedCount(): number {
    let count = 0;
    for (const player of this.players.values()) if (player.connected) count++;
    return count;
  }

  get isFull(): boolean {
    return this.players.size >= MAX_PLAYERS;
  }

  /**
   * Counts only connected players. A room whose players all dropped mid-round
   * still holds them for the standings, and must still be reapable.
   */
  get isEmpty(): boolean {
    return this.connectedCount === 0;
  }

  /** Invariant I2: pool membership is derived, never stored, so it cannot drift. */
  get isOpenForMatchmaking(): boolean {
    return this.isPublic && this.phase === 'lobby' && !this.isFull;
  }

  get acceptsJoins(): boolean {
    return this.phase === 'lobby' || this.phase === 'done';
  }

  state(): LobbyState {
    return {
      players: this.roster(),
      hostId: this.hostId,
      autoStart: this.isPublic,
      fillDeadline: this.#fillDeadline,
    };
  }

  roster(): LobbyPlayer[] {
    return [...this.players.values()].map(({ id, name, score, connected }) => ({
      id,
      name,
      score,
      connected,
    }));
  }

  add(name: string, socket: WebSocket): Player {
    const player: Player = { id: randomUUID(), name, socket, claimed: 0, score: 0, connected: true };
    this.players.set(player.id, player);
    if (this.hostId === '') this.hostId = player.id;

    // A full public lobby has nothing left to wait for.
    if (this.isPublic && this.phase === 'lobby' && this.isFull) this.startRound();
    else this.#syncFillWindow();

    return player;
  }

  remove(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;

    if (this.phase === 'running' || this.phase === 'countdown') {
      // Mid-round, keep them in the standings with whatever they earned rather
      // than making everyone else's competition silently change shape.
      player.connected = false;
    } else {
      this.players.delete(playerId);
    }

    if (this.hostId === playerId) {
      const next = [...this.players.values()].find((p) => p.connected);
      this.hostId = next?.id ?? '';
    }

    this.#syncFillWindow();
    this.broadcastLobby();
    if (this.isEmpty) this.onEmpty?.();
  }

  broadcast(message: ServerMessage): void {
    for (const player of this.players.values()) send(player.socket, message);
  }

  broadcastLobby(): void {
    this.broadcast({ t: 'lobby', ...this.state() });
  }

  canStart(playerId: string): string | null {
    if (playerId !== this.hostId) return 'Only the host can start the game.';
    if (this.phase === 'countdown' || this.phase === 'running') return 'A game is already running.';
    if (this.connectedCount < MIN_PLAYERS) return `Need at least ${MIN_PLAYERS} players.`;
    return null;
  }

  startRound(): void {
    this.#clearFillWindow();
    this.#clearRoundTimers();

    // Anyone who dropped during the previous round is cleared out here rather
    // than mid-game, so standings stay stable while a round is in flight.
    for (const [id, player] of this.players) {
      if (!player.connected) this.players.delete(id);
      else {
        player.claimed = 0;
        player.score = 0;
      }
    }

    this.#seed = randomSeed();
    this.#startAt = Date.now() + COUNTDOWN_MS;
    this.#endsAt = this.#startAt + DEFAULT_MODE.durationSeconds * 1000;
    this.phase = 'countdown';

    this.broadcast({
      t: 'starting',
      seed: this.#seed,
      startAtServerTime: this.#startAt,
      durationSeconds: DEFAULT_MODE.durationSeconds,
    });

    this.#countdownTimer = setTimeout(() => {
      if (this.phase === 'countdown') this.phase = 'running';
    }, COUNTDOWN_MS);

    this.#broadcastTimer = setInterval(() => {
      this.#applyRateCap();
      this.broadcast({
        t: 'scores',
        scores: [...this.players.values()].map((p) => ({ id: p.id, score: p.score })),
      });
    }, SCORE_BROADCAST_INTERVAL_MS);

    this.#endTimer = setTimeout(
      () => this.#end(),
      COUNTDOWN_MS + DEFAULT_MODE.durationSeconds * 1000 + DEADLINE_GRACE_MS,
    );
  }

  /**
   * Most answers the round could plausibly have yielded by now. A client can
   * lie about how many it solved but not about how much time has passed, so
   * this is what makes a reported number worth storing.
   */
  #ceiling(now: number): number {
    const elapsedSeconds = Math.max(0, (Math.min(now, this.#endsAt) - this.#startAt) / 1000);
    // +2 of slack so the first answers are not rejected by a limit computed
    // over a near-zero elapsed time.
    return Math.floor(elapsedSeconds * MAX_ANSWERS_PER_SECOND) + 2;
  }

  /**
   * Re-apply the rate cap to every player's standing claim.
   *
   * The cap has to be re-evaluated over time rather than applied once on
   * arrival: a player who solves a burst in the opening seconds legitimately
   * exceeds the ceiling *at that instant*, and clamping their claim there
   * would destroy those answers permanently, since a client with an unchanged
   * total never sends again. Holding the claim and releasing it as the
   * ceiling rises keeps honest bursts intact while still bounding cheaters.
   */
  #applyRateCap(): void {
    const ceiling = this.#ceiling(Date.now());
    for (const player of this.players.values()) {
      player.score = Math.min(player.claimed, ceiling);
    }
  }

  reportProgress(playerId: string, solvedThrough: number): void {
    const player = this.players.get(playerId);
    if (!player || this.phase !== 'running') return;

    const now = Date.now();
    if (now > this.#endsAt + DEADLINE_GRACE_MS) return;
    if (!Number.isInteger(solvedThrough) || solvedThrough <= player.claimed) return;

    player.claimed = solvedThrough;
    player.score = Math.min(player.claimed, this.#ceiling(now));
  }

  /**
   * Sole owner of the fill window (invariant I4). Rather than arming and
   * clearing it from each call site, this re-derives whether it *should* be
   * running and reconciles — so the timer cannot disagree with the roster.
   */
  #syncFillWindow(): void {
    const shouldRun =
      this.isPublic && this.phase === 'lobby' && this.connectedCount >= MIN_PLAYERS;

    if (shouldRun === (this.#fillTimer !== null)) return;

    if (shouldRun) {
      this.#fillDeadline = Date.now() + FILL_WINDOW_MS;
      this.#fillTimer = setTimeout(() => {
        this.#fillTimer = null;
        // Re-check: players may have left while the window ran.
        if (this.phase === 'lobby' && this.connectedCount >= MIN_PLAYERS) this.startRound();
        else this.#clearFillWindow();
      }, FILL_WINDOW_MS);
    } else {
      this.#clearFillWindow();
    }
  }

  #clearFillWindow(): void {
    if (this.#fillTimer) clearTimeout(this.#fillTimer);
    this.#fillTimer = null;
    this.#fillDeadline = 0;
  }

  #end(): void {
    this.#clearRoundTimers();
    // Final release: by the deadline the ceiling covers the whole round, so
    // any claim held back earlier is now credited in full.
    this.#applyRateCap();
    this.phase = 'done';
    this.broadcast({ t: 'ended', standings: toStandings(this.roster()) });

    // Everyone may have dropped mid-round; without this the room would sit in
    // the registry forever holding disconnected players.
    if (this.isEmpty) {
      this.onEmpty?.();
      return;
    }

    // A matchmade lobby has no host to press "play again", so returning it to
    // `lobby` is the only way another round can ever happen — otherwise it
    // strands everyone on the standings screen. Clients keep showing standings
    // while the next fill window runs.
    if (this.isPublic) {
      this.phase = 'lobby';
      this.#syncFillWindow();
    }
    // Carries the reset fill deadline, so nobody renders a stale countdown.
    this.broadcastLobby();
  }

  #clearRoundTimers(): void {
    if (this.#countdownTimer) clearTimeout(this.#countdownTimer);
    if (this.#broadcastTimer) clearInterval(this.#broadcastTimer);
    if (this.#endTimer) clearTimeout(this.#endTimer);
    this.#countdownTimer = null;
    this.#broadcastTimer = null;
    this.#endTimer = null;
  }

  dispose(): void {
    this.#clearFillWindow();
    this.#clearRoundTimers();
  }
}

export class RoomRegistry {
  readonly #rooms = new Map<string, Room>();
  #reaper: NodeJS.Timeout | null = null;

  get size(): number {
    return this.#rooms.size;
  }

  get(code: string): Room | undefined {
    return this.#rooms.get(code);
  }

  create(isPublic: boolean): Room {
    const room = new Room(this.#allocateCode(), isPublic);
    room.onEmpty = () => this.reap(room);
    this.#rooms.set(room.code, room);
    return room;
  }

  /**
   * Pick a public lobby to drop a player into, opening one if none fits.
   *
   * MUST stay synchronous. Node runs one thread and a message handler runs to
   * completion, so selecting a room and adding the player to it is atomic and
   * two players cannot both take the last slot. An `await` anywhere between
   * the two would let the event loop interleave and reintroduce that race —
   * so if async work is ever needed here, do it *before* selection and
   * re-validate the room afterwards.
   */
  findOrCreate(): Room {
    let best: Room | null = null;
    for (const room of this.#rooms.values()) {
      if (!room.isOpenForMatchmaking) continue;
      // Fullest first so games reach MIN_PLAYERS sooner; oldest breaks ties so
      // a room cannot be passed over indefinitely.
      if (
        best === null ||
        room.players.size > best.players.size ||
        (room.players.size === best.players.size && room.createdAt < best.createdAt)
      ) {
        best = room;
      }
    }
    return best ?? this.create(true);
  }

  delete(code: string): void {
    this.#rooms.get(code)?.dispose();
    this.#rooms.delete(code);
  }

  reap(room: Room): void {
    if (room.isEmpty) this.delete(room.code);
  }

  /** Backstop for any room the event-driven path fails to reap. */
  startReaper(): void {
    if (this.#reaper) return;
    this.#reaper = setInterval(() => {
      for (const room of [...this.#rooms.values()]) this.reap(room);
    }, REAP_INTERVAL_MS);
    this.#reaper.unref();
  }

  #allocateCode(): string {
    // The space is only 10k codes, so collisions are realistic enough to
    // handle rather than assume away.
    for (let attempt = 0; attempt < 200; attempt++) {
      const code = String(randomInt(0, CODE_MAX)).padStart(JOIN_CODE_LENGTH, '0');
      if (!this.#rooms.has(code)) return code;
    }
    throw new Error('no join codes available');
  }
}
