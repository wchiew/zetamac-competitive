/**
 * Mode configuration and canonical mode keys.
 *
 * Scores are only comparable within an identical config: 60 correct on
 * multiplication 2-5 is not 60 correct on the default ranges. Every persisted
 * score is therefore tagged with a `modeKey`, and only DEFAULT_MODE_KEY feeds
 * the global leaderboards.
 */

export interface Range {
  readonly min: number;
  readonly max: number;
}

export interface ModeConfig {
  readonly durationSeconds: number;
  readonly addition: { readonly enabled: boolean; readonly left: Range; readonly right: Range };
  /** Inverse of addition — operands come from the addition ranges. */
  readonly subtraction: { readonly enabled: boolean };
  readonly multiplication: { readonly enabled: boolean; readonly left: Range; readonly right: Range };
  /** Inverse of multiplication — operands come from the multiplication ranges. */
  readonly division: { readonly enabled: boolean };
}

/** Stock zetamac: 120s, addition 2-100 x 2-100, multiplication 2-12 x 2-100, all four operations. */
export const DEFAULT_MODE: ModeConfig = {
  durationSeconds: 120,
  addition: { enabled: true, left: { min: 2, max: 100 }, right: { min: 2, max: 100 } },
  subtraction: { enabled: true },
  multiplication: { enabled: true, left: { min: 2, max: 12 }, right: { min: 2, max: 100 } },
  division: { enabled: true },
};

function rangeKey(r: Range): string {
  return `${r.min}-${r.max}`;
}

/**
 * Stable, human-readable identity for a config. Two configs produce the same
 * key if and only if they produce the same distribution of problems, so this
 * is safe to use as a leaderboard partition key.
 */
export function modeKey(cfg: ModeConfig): string {
  const parts = [`d${cfg.durationSeconds}`];
  // Subtraction draws from the addition ranges and division from the
  // multiplication ranges, so a range is part of the identity whenever either
  // operation that reads it is enabled.
  if (cfg.addition.enabled) parts.push('a');
  if (cfg.subtraction.enabled) parts.push('s');
  if (cfg.addition.enabled || cfg.subtraction.enabled) {
    parts.push(`${rangeKey(cfg.addition.left)}x${rangeKey(cfg.addition.right)}`);
  }
  if (cfg.multiplication.enabled) parts.push('m');
  if (cfg.division.enabled) parts.push('v');
  if (cfg.multiplication.enabled || cfg.division.enabled) {
    parts.push(`${rangeKey(cfg.multiplication.left)}x${rangeKey(cfg.multiplication.right)}`);
  }
  return parts.join('|');
}

export const DEFAULT_MODE_KEY: string = modeKey(DEFAULT_MODE);
