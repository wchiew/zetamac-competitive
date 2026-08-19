/**
 * Wire protocol for multiplayer lobbies.
 *
 * Shared so the client cannot drift from the server. Message shapes are plain
 * JSON — at 2-4 players exchanging a score a few times a second this is a few
 * hundred bytes/sec, nowhere near warranting a binary encoding.
 */

export const JOIN_CODE_LENGTH = 4;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** Lead-in between a round being triggered and the first problem appearing. */
export const COUNTDOWN_MS = 3000;

/**
 * Grace period in a matchmade lobby between reaching MIN_PLAYERS and the round
 * starting, so a third and fourth player can still get in. Hitting
 * MAX_PLAYERS starts immediately instead of waiting it out.
 */
export const FILL_WINDOW_MS = 10_000;

/**
 * Ceiling on accepted scoring rate. No human sustains 4 correct answers a
 * second; anything above it is a client reporting a score it did not earn.
 */
export const MAX_ANSWERS_PER_SECOND = 4;

/** How often a client reports progress, and how often the server broadcasts. */
export const PROGRESS_INTERVAL_MS = 250;
export const SCORE_BROADCAST_INTERVAL_MS = 250;

/** Late-arriving answers within this window still count, absorbing latency. */
export const DEADLINE_GRACE_MS = 1000;

export const MAX_NAME_LENGTH = 16;

export interface LobbyPlayer {
  id: string;
  name: string;
  score: number;
  connected: boolean;
}

export interface Standing {
  id: string;
  name: string;
  score: number;
  /** 1-based. Equal scores share a placement. */
  placement: number;
}

/** Everything about a lobby that the client renders, sent as one unit. */
export interface LobbyState {
  players: LobbyPlayer[];
  hostId: string;
  /** True for matchmade lobbies, which start themselves; false for private ones. */
  autoStart: boolean;
  /** Server-clock epoch the round auto-starts at, or 0 when not counting down. */
  fillDeadline: number;
}

export type ClientMessage =
  /** Private lobby: creator gets a code to share and presses start themselves. */
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  /** Public lobby: server picks an open one or opens a new one. */
  | { t: 'matchmake'; name: string }
  | { t: 'start' }
  | { t: 'progress'; solvedThrough: number }
  | { t: 'ping'; clientTime: number };

export type ServerMessage =
  | ({ t: 'joined'; code: string; playerId: string } & LobbyState)
  | ({ t: 'lobby' } & LobbyState)
  | { t: 'starting'; seed: number; startAtServerTime: number; durationSeconds: number }
  | { t: 'scores'; scores: Array<{ id: string; score: number }> }
  | { t: 'ended'; standings: Standing[] }
  | { t: 'pong'; clientTime: number; serverTime: number }
  | { t: 'error'; message: string };

const JOIN_CODE_PATTERN = new RegExp(`^[0-9]{${JOIN_CODE_LENGTH}}$`);

/** Join codes are digits only, so they can be read aloud or typed on a numpad. */
export function isJoinCode(value: string): boolean {
  return JOIN_CODE_PATTERN.test(value);
}

export function sanitizeName(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
  return trimmed === '' ? 'Player' : trimmed;
}

/** Dense ranking: two players on 40 both place 1st, the next places 3rd. */
export function toStandings(players: Array<{ id: string; name: string; score: number }>): Standing[] {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  let placement = 0;
  let previousScore = Number.NaN;
  return sorted.map((player, index) => {
    if (player.score !== previousScore) {
      placement = index + 1;
      previousScore = player.score;
    }
    return { ...player, placement };
  });
}
