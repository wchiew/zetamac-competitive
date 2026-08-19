/**
 * Games started and completed, counted separately per game mode.
 *
 * Solo and multiplayer are not comparable: a solo round is abandoned by
 * choice, whereas a multiplayer one can end because the lobby emptied or the
 * connection dropped. Pooling them would produce a completion rate that means
 * nothing for either.
 *
 * Session-scoped and in memory. M2 replaces this with profile counters; the
 * shape is the same so the swap is local to this file.
 */
import { GAME_MODES, type GameMode } from './metrics';

export interface ModeCounts {
  started: number;
  completed: number;
}

function empty(): Record<GameMode, ModeCounts> {
  return Object.fromEntries(GAME_MODES.map((mode) => [mode, { started: 0, completed: 0 }])) as Record<
    GameMode,
    ModeCounts
  >;
}

export const sessionStats = $state<Record<GameMode, ModeCounts>>(empty());

/** A round is started when its clock is, not when the button is pressed. */
export function recordStart(mode: GameMode): void {
  sessionStats[mode].started++;
}

export function recordCompletion(mode: GameMode): void {
  sessionStats[mode].completed++;
}
