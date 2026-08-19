/**
 * Per-round metrics.
 *
 * Two tiers, deliberately:
 *
 * - **Per-problem records** are collected in memory and shown on the results
 *   screen only. They are never persisted — the interesting question at that
 *   granularity is "how did *this* run go", not "how have I done over a year".
 * - **The aggregates** in `RoundSummary` are what a profile would store.
 *
 * Nothing here touches Svelte state. The accumulator runs on the keystroke
 * path, where a reactive write would put a render between a key and the
 * screen.
 */
import type { Op } from '@zmc/shared';

export type GameMode = 'solo' | 'multiplayer';

export const GAME_MODES: readonly GameMode[] = ['solo', 'multiplayer'];

export const OPS: readonly Op[] = ['add', 'sub', 'mul', 'div'];

export const OP_SYMBOL: Record<Op, string> = {
  add: '+',
  sub: '-',
  mul: '×',
  div: '÷',
};

export interface ProblemRecord {
  index: number;
  op: Op;
  left: number;
  right: number;
  answer: number;
  /** Digits in the answer — long answers take longer to type, not to think. */
  answerDigits: number;
  /** Problem shown → first key. Null if never touched. */
  msToFirstKey: number | null;
  /** Problem shown → correct answer. Null if the clock ran out first. */
  msToSolve: number | null;
  /** Round start → problem shown, for pacing across the round. */
  offsetMs: number;
}

export interface OpStats {
  op: Op;
  solved: number;
  /** Medians, not means: one tab-away turns a mean into nonsense. */
  medianSolveMs: number | null;
  medianThinkMs: number | null;
  medianTypeMs: number | null;
}

export interface RoundContext {
  gameMode: GameMode;
  /**
   * Whether the score came from the authoritative server rather than this
   * browser. Tracked separately from `gameMode` rather than inferred from it:
   * they happen to coincide today (solo is local, multiplayer is verified),
   * but M3 moves ranked solo into a server room, at which point a solo round
   * can be verified too. Without the flag, an all-time high score silently
   * mixes trusted and untrusted numbers.
   */
  serverVerified: boolean;
  durationSeconds: number;
}

export interface RoundSummary extends RoundContext {
  score: number;
  byOp: OpStats[];
  medianThinkMs: number | null;
  medianTypeMs: number | null;
  /** Retained for the results screen; not for persistence. */
  problems: ProblemRecord[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

function thinkMs(record: ProblemRecord): number | null {
  return record.msToFirstKey;
}

function typeMs(record: ProblemRecord): number | null {
  if (record.msToSolve === null || record.msToFirstKey === null) return null;
  return record.msToSolve - record.msToFirstKey;
}

function defined(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null);
}

export function summarize(
  problems: ProblemRecord[],
  score: number,
  context: RoundContext,
): RoundSummary {
  // Only solved problems carry timing: an unsolved one was cut off by the
  // clock, so its duration says more about the timer than about the player.
  const solved = problems.filter((record) => record.msToSolve !== null);

  const byOp = OPS.map((op) => {
    const forOp = solved.filter((record) => record.op === op);
    return {
      op,
      solved: forOp.length,
      medianSolveMs: median(defined(forOp.map((r) => r.msToSolve))),
      medianThinkMs: median(defined(forOp.map(thinkMs))),
      medianTypeMs: median(defined(forOp.map(typeMs))),
    };
  });

  return {
    ...context,
    score,
    byOp,
    medianThinkMs: median(defined(solved.map(thinkMs))),
    medianTypeMs: median(defined(solved.map(typeMs))),
    problems,
  };
}

/**
 * Collects records during a round. A plain class, not a store — every method
 * here is called from the keystroke handler.
 */
export class RoundMetrics {
  #records: ProblemRecord[] = [];
  #startedAt = 0;
  #current: {
    op: Op;
    left: number;
    right: number;
    answer: number;
    shownAt: number;
    firstKeyAt: number | null;
  } | null = null;

  begin(now: number): void {
    this.#records = [];
    this.#current = null;
    this.#startedAt = now;
  }

  show(problem: { op: Op; left: number; right: number; answer: number }, now: number): void {
    this.#current = { ...problem, shownAt: now, firstKeyAt: null };
  }

  /** Called on every keystroke; only the first one for a problem matters. */
  keyed(now: number): void {
    if (this.#current && this.#current.firstKeyAt === null) this.#current.firstKeyAt = now;
  }

  /** `now` is null when the round ended before this problem was solved. */
  close(now: number | null): void {
    const open = this.#current;
    if (!open) return;
    this.#current = null;
    this.#records.push({
      index: this.#records.length,
      op: open.op,
      left: open.left,
      right: open.right,
      answer: open.answer,
      answerDigits: String(open.answer).length,
      msToFirstKey: open.firstKeyAt === null ? null : Math.round(open.firstKeyAt - open.shownAt),
      msToSolve: now === null ? null : Math.round(now - open.shownAt),
      offsetMs: Math.round(open.shownAt - this.#startedAt),
    });
  }

  get records(): ProblemRecord[] {
    return this.#records;
  }
}
