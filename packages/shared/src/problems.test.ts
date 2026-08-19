import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODE,
  DEFAULT_MODE_KEY,
  SHIPPED_ROUND_SECONDS,
  modeKey,
  type ModeConfig,
} from './modes.js';
import { ProblemGenerator, generateProblems, type Op } from './problems.js';

const SAMPLE = 5000;

function onlyOp(op: Op): ModeConfig {
  return {
    ...DEFAULT_MODE,
    addition: { ...DEFAULT_MODE.addition, enabled: op === 'add' },
    subtraction: { enabled: op === 'sub' },
    multiplication: { ...DEFAULT_MODE.multiplication, enabled: op === 'mul' },
    division: { enabled: op === 'div' },
  };
}

/** Recovers the operands from the rendered text so answers can be re-checked. */
function parse(text: string): { left: number; symbol: string; right: number } {
  const [left, symbol, right] = text.split(' ') as [string, string, string];
  return { left: Number(left), symbol, right: Number(right) };
}

describe('determinism', () => {
  it('produces an identical sequence for the same seed', () => {
    // This is the property the whole fairness model rests on: two machines
    // running this code must derive the same problems from the same seed.
    const a = generateProblems(DEFAULT_MODE, 123456, SAMPLE);
    const b = generateProblems(DEFAULT_MODE, 123456, SAMPLE);
    expect(a).toEqual(b);
  });

  it('produces different sequences for different seeds', () => {
    const a = generateProblems(DEFAULT_MODE, 1, 50);
    const b = generateProblems(DEFAULT_MODE, 2, 50);
    expect(a).not.toEqual(b);
  });

  it('reports a zero-based index matching the number of draws', () => {
    const gen = new ProblemGenerator(DEFAULT_MODE, 42);
    expect(gen.index).toBe(-1);
    gen.next();
    expect(gen.index).toBe(0);
    gen.next();
    expect(gen.index).toBe(1);
  });
});

describe('answers are correct', () => {
  it('every generated answer matches its own expression', () => {
    for (const p of generateProblems(DEFAULT_MODE, 987, SAMPLE)) {
      const { left, symbol, right } = parse(p.text);
      const expected =
        symbol === '+' ? left + right
        : symbol === '-' ? left - right
        : symbol === '×' ? left * right
        : left / right;
      expect(p.answer, p.text).toBe(expected);
    }
  });

  it('exposes operands that match the displayed text', () => {
    // Metrics read `left`/`right` rather than re-parsing `text`, so the two
    // must never disagree.
    for (const p of generateProblems(DEFAULT_MODE, 321, SAMPLE)) {
      const { left, right } = parse(p.text);
      expect(p.left, p.text).toBe(left);
      expect(p.right, p.text).toBe(right);
    }
  });

  it('never yields a negative or fractional answer', () => {
    for (const p of generateProblems(DEFAULT_MODE, 555, SAMPLE)) {
      expect(Number.isInteger(p.answer), p.text).toBe(true);
      expect(p.answer, p.text).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('zetamac default ranges', () => {
  it('keeps addition operands within 2-100', () => {
    for (const p of generateProblems(onlyOp('add'), 7, SAMPLE)) {
      const { left, right } = parse(p.text);
      for (const v of [left, right]) {
        expect(v, p.text).toBeGreaterThanOrEqual(2);
        expect(v, p.text).toBeLessThanOrEqual(100);
      }
    }
  });

  it('keeps subtraction inside the addition ranges', () => {
    // Subtraction is the inverse of an addition, so both the subtrahend and
    // the answer must be legal addition operands.
    for (const p of generateProblems(onlyOp('sub'), 8, SAMPLE)) {
      const { left, right } = parse(p.text);
      expect(right, p.text).toBeGreaterThanOrEqual(2);
      expect(right, p.text).toBeLessThanOrEqual(100);
      expect(p.answer, p.text).toBeGreaterThanOrEqual(2);
      expect(p.answer, p.text).toBeLessThanOrEqual(100);
      expect(left, p.text).toBeLessThanOrEqual(200);
    }
  });

  it('keeps multiplication operands at 2-12 by 2-100', () => {
    for (const p of generateProblems(onlyOp('mul'), 9, SAMPLE)) {
      const { left, right } = parse(p.text);
      expect(left, p.text).toBeGreaterThanOrEqual(2);
      expect(left, p.text).toBeLessThanOrEqual(12);
      expect(right, p.text).toBeGreaterThanOrEqual(2);
      expect(right, p.text).toBeLessThanOrEqual(100);
    }
  });

  it('always divides by the 2-12 factor, never the 2-100 one', () => {
    // The divisor must come from the left range. Dividing by the wide right
    // range would produce problems like "660 ÷ 60", which zetamac never shows.
    for (const p of generateProblems(onlyOp('div'), 10, SAMPLE)) {
      const { left, right } = parse(p.text);
      expect(left % right, p.text).toBe(0);
      expect(right, p.text).toBeGreaterThanOrEqual(2);
      expect(right, p.text).toBeLessThanOrEqual(12);
      expect(p.answer, p.text).toBeGreaterThanOrEqual(2);
      expect(p.answer, p.text).toBeLessThanOrEqual(100);
    }
  });

  it('uses all four operations under the default config', () => {
    const seen = new Set(generateProblems(DEFAULT_MODE, 11, SAMPLE).map((p) => p.op));
    expect([...seen].sort()).toEqual(['add', 'div', 'mul', 'sub']);
  });
});

describe('presentation', () => {
  it('never repeats a problem back to back', () => {
    const problems = generateProblems(DEFAULT_MODE, 2024, SAMPLE);
    for (let i = 1; i < problems.length; i++) {
      expect(problems[i]!.text).not.toBe(problems[i - 1]!.text);
    }
  });
});

describe('mode keys', () => {
  it('is stable for the zetamac default', () => {
    // Pinned: changing this silently splits the leaderboard in two. Built from
    // the shipped duration rather than DEFAULT_MODE_KEY so a dev round-length
    // override cannot make the guard vacuous.
    const shipped = { ...DEFAULT_MODE, durationSeconds: SHIPPED_ROUND_SECONDS };
    expect(modeKey(shipped)).toBe('d120|a|s|2-100x2-100|m|v|2-12x2-100');
  });

  it('defaults to the shipped duration when nothing overrides it', () => {
    expect(DEFAULT_MODE.durationSeconds).toBe(SHIPPED_ROUND_SECONDS);
    expect(DEFAULT_MODE_KEY).toBe('d120|a|s|2-100x2-100|m|v|2-12x2-100');
  });

  it('separates configs that generate different problems', () => {
    const shorter = { ...DEFAULT_MODE, durationSeconds: 60 };
    const easierTimes = {
      ...DEFAULT_MODE,
      multiplication: { ...DEFAULT_MODE.multiplication, right: { min: 2, max: 12 } },
    };
    const keys = [DEFAULT_MODE_KEY, modeKey(shorter), modeKey(easierTimes)];
    expect(new Set(keys).size).toBe(3);
  });

  it('includes the addition ranges when only subtraction is enabled', () => {
    const wide = onlyOp('sub');
    const narrow = { ...wide, addition: { ...wide.addition, right: { min: 2, max: 20 } } };
    expect(modeKey(wide)).not.toBe(modeKey(narrow));
  });

  it('throws when no operation is enabled', () => {
    const empty: ModeConfig = {
      ...DEFAULT_MODE,
      addition: { ...DEFAULT_MODE.addition, enabled: false },
      subtraction: { enabled: false },
      multiplication: { ...DEFAULT_MODE.multiplication, enabled: false },
      division: { enabled: false },
    };
    expect(() => new ProblemGenerator(empty, 1)).toThrow(/no operations/);
  });
});
