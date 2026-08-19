import { mulberry32, pick, randInt, type Rng } from './prng.js';
import type { ModeConfig } from './modes.js';

export type Op = 'add' | 'sub' | 'mul' | 'div';

export interface Problem {
  /** Left-hand side as displayed, e.g. "84 ÷ 12". */
  readonly text: string;
  readonly answer: number;
  readonly op: Op;
  /**
   * The two operands exactly as displayed. Carried separately from `text`
   * because per-operand analysis ("slow dividing by 7") should not depend on
   * re-parsing a display string.
   */
  readonly left: number;
  readonly right: number;
}

function enabledOps(cfg: ModeConfig): Op[] {
  const ops: Op[] = [];
  if (cfg.addition.enabled) ops.push('add');
  if (cfg.subtraction.enabled) ops.push('sub');
  if (cfg.multiplication.enabled) ops.push('mul');
  if (cfg.division.enabled) ops.push('div');
  return ops;
}

function build(cfg: ModeConfig, rng: Rng, op: Op): Problem {
  switch (op) {
    case 'add': {
      const a = randInt(rng, cfg.addition.left.min, cfg.addition.left.max);
      const b = randInt(rng, cfg.addition.right.min, cfg.addition.right.max);
      return { text: `${a} + ${b}`, answer: a + b, op, left: a, right: b };
    }
    case 'sub': {
      // Generated as the inverse of an addition so the answer always lands
      // inside the configured range and is never negative.
      const a = randInt(rng, cfg.addition.left.min, cfg.addition.left.max);
      const b = randInt(rng, cfg.addition.right.min, cfg.addition.right.max);
      const sum = a + b;
      const subtractLeft = rng() < 0.5;
      return subtractLeft
        ? { text: `${sum} - ${a}`, answer: b, op, left: sum, right: a }
        : { text: `${sum} - ${b}`, answer: a, op, left: sum, right: b };
    }
    case 'mul': {
      const a = randInt(rng, cfg.multiplication.left.min, cfg.multiplication.left.max);
      const b = randInt(rng, cfg.multiplication.right.min, cfg.multiplication.right.max);
      return { text: `${a} × ${b}`, answer: a * b, op, left: a, right: b };
    }
    case 'div': {
      // Inverse of a multiplication, so the quotient is always a whole number.
      // The divisor is always the left-range factor (2-12 by default), never
      // the wide right-range one — dividing by 60 is a different, much harder
      // skill than dividing by 12, and zetamac never asks for it.
      const a = randInt(rng, cfg.multiplication.left.min, cfg.multiplication.left.max);
      const b = randInt(rng, cfg.multiplication.right.min, cfg.multiplication.right.max);
      return { text: `${a * b} ÷ ${a}`, answer: b, op, left: a * b, right: a };
    }
  }
}

/**
 * Ordered problem stream for one game. Both the player's browser and the
 * server construct this from the same (config, seed) pair and step through it
 * in lockstep, which is what makes a lobby fair and a score verifiable.
 */
export class ProblemGenerator {
  readonly #cfg: ModeConfig;
  readonly #rng: Rng;
  readonly #ops: Op[];
  #lastText = '';
  #index = -1;

  constructor(cfg: ModeConfig, seed: number) {
    this.#cfg = cfg;
    this.#rng = mulberry32(seed);
    this.#ops = enabledOps(cfg);
    if (this.#ops.length === 0) {
      throw new Error('mode config has no operations enabled');
    }
  }

  /** Zero-based position of the problem most recently returned by next(). */
  get index(): number {
    return this.#index;
  }

  next(): Problem {
    // Back-to-back repeats feel broken to the player; redraw on collision.
    // Bounded because every enabled operation has far more than 8 outcomes.
    let problem = build(this.#cfg, this.#rng, pick(this.#rng, this.#ops));
    for (let attempt = 0; problem.text === this.#lastText && attempt < 8; attempt++) {
      problem = build(this.#cfg, this.#rng, pick(this.#rng, this.#ops));
    }
    this.#lastText = problem.text;
    this.#index++;
    return problem;
  }
}

/** Materialize the first `count` problems — used by server-side verification. */
export function generateProblems(cfg: ModeConfig, seed: number, count: number): Problem[] {
  const gen = new ProblemGenerator(cfg, seed);
  return Array.from({ length: count }, () => gen.next());
}
