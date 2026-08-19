/**
 * Lobby connection.
 *
 * Holds the authoritative view the server pushes down; the client never
 * invents a score or a deadline of its own.
 */
import {
  PROGRESS_INTERVAL_MS,
  type ClientMessage,
  type LobbyPlayer,
  type LobbyState,
  type ServerMessage,
  type Standing,
} from '@zmc/shared';

export type NetPhase = 'offline' | 'connecting' | 'lobby' | 'countdown' | 'running' | 'done';

const CLOCK_SAMPLES = 5;

function socketUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}

class Net {
  phase = $state<NetPhase>('offline');
  error = $state('');
  code = $state('');
  playerId = $state('');
  hostId = $state('');
  players = $state<LobbyPlayer[]>([]);
  standings = $state<Standing[]>([]);
  autoStart = $state(false);
  /** Auto-start deadline in this browser's clock, or 0 when not counting. */
  fillDeadlineEpoch = $state(0);

  seed = $state(0);
  /** Round start, already converted into this browser's Date.now() clock. */
  startAtEpoch = $state(0);
  durationSeconds = $state(0);

  #socket: WebSocket | null = null;
  #pending: ClientMessage | null = null;
  /** serverTime - localTime, from the lowest-latency ping sample. */
  #clockOffset = 0;
  #bestRtt = Number.POSITIVE_INFINITY;
  #progressTimer: number | null = null;
  #lastSent = -1;
  #solvedThrough = 0;

  get isHost(): boolean {
    return this.playerId !== '' && this.playerId === this.hostId;
  }

  get self(): LobbyPlayer | undefined {
    return this.players.find((p) => p.id === this.playerId);
  }

  get opponents(): LobbyPlayer[] {
    return this.players.filter((p) => p.id !== this.playerId);
  }

  createLobby(name: string): void {
    this.#connectThen({ t: 'create', name });
  }

  matchmake(name: string): void {
    this.#connectThen({ t: 'matchmake', name });
  }

  joinLobby(code: string, name: string): void {
    this.#connectThen({ t: 'join', code, name });
  }

  startGame(): void {
    this.#send({ t: 'start' });
  }

  /**
   * Called by the arena on every correct answer. Buffered rather than sent
   * immediately: a socket write per keystroke would be wasteful, and the
   * server only broadcasts four times a second anyway.
   */
  reportSolved(solvedThrough: number): void {
    this.#solvedThrough = solvedThrough;
  }

  leave(): void {
    this.#stopProgress();
    this.#socket?.close();
    this.#socket = null;
    this.phase = 'offline';
    this.code = '';
    this.playerId = '';
    this.hostId = '';
    this.players = [];
    this.standings = [];
    this.autoStart = false;
    this.fillDeadlineEpoch = 0;
    this.error = '';
  }

  #connectThen(message: ClientMessage): void {
    this.error = '';
    this.standings = [];
    if (this.#socket && this.#socket.readyState === WebSocket.OPEN) {
      this.#send(message);
      return;
    }

    this.phase = 'connecting';
    this.#pending = message;
    const socket = new WebSocket(socketUrl());
    this.#socket = socket;

    socket.onopen = () => {
      this.#syncClock();
      if (this.#pending) {
        this.#send(this.#pending);
        this.#pending = null;
      }
    };
    socket.onmessage = (event) => this.#receive(JSON.parse(event.data as string) as ServerMessage);
    socket.onerror = () => {
      this.error = 'Could not reach the game server. Is it running?';
      this.phase = 'offline';
    };
    socket.onclose = () => {
      this.#stopProgress();
      if (this.phase !== 'offline' && this.phase !== 'done') {
        this.error = this.error || 'Connection lost.';
        this.phase = 'offline';
      }
    };
  }

  #send(message: ClientMessage): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(JSON.stringify(message));
    }
  }

  /**
   * Estimate the server clock so a start time expressed in server epoch can be
   * rendered against this machine's clock. Keeps the sample with the lowest
   * round trip, which is the one least distorted by queueing delay.
   */
  #syncClock(): void {
    for (let i = 0; i < CLOCK_SAMPLES; i++) {
      setTimeout(() => this.#send({ t: 'ping', clientTime: Date.now() }), i * 50);
    }
  }

  #receive(message: ServerMessage): void {
    switch (message.t) {
      case 'pong': {
        const now = Date.now();
        const rtt = now - message.clientTime;
        if (rtt < this.#bestRtt) {
          this.#bestRtt = rtt;
          this.#clockOffset = message.serverTime - (message.clientTime + now) / 2;
        }
        return;
      }
      case 'joined':
        this.code = message.code;
        this.playerId = message.playerId;
        this.#applyLobby(message);
        // A 'starting' may already have arrived if this join filled the lobby.
        if (this.phase === 'connecting') this.phase = 'lobby';
        return;
      case 'lobby':
        this.#applyLobby(message);
        return;
      case 'starting':
        this.seed = message.seed;
        this.startAtEpoch = message.startAtServerTime - this.#clockOffset;
        this.durationSeconds = message.durationSeconds;
        this.standings = [];
        // The window that led here is spent; leaving it set would render an
        // expired countdown on the next lobby screen.
        this.fillDeadlineEpoch = 0;
        this.phase = 'countdown';
        this.#solvedThrough = 0;
        this.#lastSent = -1;
        this.#startProgress();
        return;
      case 'scores': {
        const byId = new Map(message.scores.map((s) => [s.id, s.score]));
        this.players = this.players.map((p) => ({ ...p, score: byId.get(p.id) ?? p.score }));
        if (this.phase === 'countdown' && Date.now() >= this.startAtEpoch) this.phase = 'running';
        return;
      }
      case 'ended':
        this.#stopProgress();
        this.standings = message.standings;
        // Cleared here rather than waiting for the 'lobby' that follows, so no
        // frame can render the spent deadline.
        this.fillDeadlineEpoch = 0;
        this.phase = 'done';
        return;
      case 'error':
        this.error = message.message;
        if (this.phase === 'connecting') this.phase = 'offline';
        return;
    }
  }

  #applyLobby(state: LobbyState): void {
    this.players = state.players;
    this.hostId = state.hostId;
    this.autoStart = state.autoStart;
    // Same conversion as the round start: server epoch into this machine's.
    this.fillDeadlineEpoch = state.fillDeadline === 0 ? 0 : state.fillDeadline - this.#clockOffset;
  }

  #startProgress(): void {
    this.#stopProgress();
    this.#progressTimer = setInterval(() => {
      if (this.#solvedThrough === this.#lastSent) return;
      this.#lastSent = this.#solvedThrough;
      this.#send({ t: 'progress', solvedThrough: this.#solvedThrough });
    }, PROGRESS_INTERVAL_MS) as unknown as number;
  }

  #stopProgress(): void {
    if (this.#progressTimer !== null) clearInterval(this.#progressTimer);
    this.#progressTimer = null;
  }
}

export const net = new Net();
