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

export const SHIPPED_ROUND_SECONDS = 120;

/**
 * Round length, overridable so the dev loop does not require sitting through a
 * full round to reach the results screen.
 *
 * Read from both runtimes because this module is shared: Vite inlines
 * `import.meta.env` at build time, Node reads `process.env`. Both are probed
 * defensively, since each is absent in the other's environment.
 *
 * This changes DEFAULT_MODE_KEY, which is correct — a 30s round is genuinely a
 * different, non-comparable mode, so dev scores can never land on a
 * leaderboard beside real ones.
 */
function configuredRoundSeconds(): number {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const raw = viteEnv?.['VITE_ROUND_SECONDS'] ?? nodeEnv?.['ROUND_SECONDS'];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : SHIPPED_ROUND_SECONDS;
}

/** Stock zetamac: 120s, addition 2-100 x 2-100, multiplication 2-12 x 2-100, all four operations. */
export const DEFAULT_MODE: ModeConfig = {
  durationSeconds: configuredRoundSeconds(),
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
