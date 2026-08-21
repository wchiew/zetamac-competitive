/**
 * The only path by which anything reaches the database.
 *
 * Kept behind an interface with a no-op default so the game is fully playable
 * with no Supabase project configured — which is the state of every fresh
 * clone, and of local development. Persistence is an enhancement, never a
 * prerequisite for a round.
 *
 * Both implementations map onto the two RPCs in
 * `supabase/migrations/0003_record_game.sql`; the aggregate bookkeeping lives
 * there, in one transaction, rather than being reassembled here.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Op } from '@zmc/shared';

export type GameMode = 'solo' | 'multiplayer';

export interface OpStat {
  op: Op;
  solved: number;
  /** Null when nothing of this operation was solved. */
  median_solve_ms: number | null;
}

export interface RoundStart {
  userId: string;
  modeKey: string;
  gameMode: GameMode;
  durationSeconds: number;
  serverVerified: boolean;
  lobbySize?: number;
}

export interface RoundCompletion {
  gameId: string;
  score: number;
  opStats: OpStat[];
  placement?: number;
  winningScore?: number;
}

export interface Persistence {
  readonly enabled: boolean;
  /** Returns the new game id, or null when persistence is off. */
  startGame(input: RoundStart): Promise<string | null>;
  completeGame(input: RoundCompletion): Promise<void>;
}

const disabled: Persistence = {
  enabled: false,
  async startGame() {
    return null;
  },
  async completeGame() {
    /* nothing to record */
  },
};

class SupabasePersistence implements Persistence {
  readonly enabled = true;
  readonly #client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.#client = createClient(url, serviceRoleKey, {
      // A server has no user session to persist or refresh.
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async startGame(input: RoundStart): Promise<string | null> {
    const { data, error } = await this.#client.rpc('start_game', {
      p_user_id: input.userId,
      p_mode_key: input.modeKey,
      p_game_mode: input.gameMode,
      p_duration_s: input.durationSeconds,
      p_server_verified: input.serverVerified,
      p_lobby_size: input.lobbySize ?? null,
    });
    if (error) throw new Error(`start_game failed: ${error.message}`);
    return data as string;
  }

  async completeGame(input: RoundCompletion): Promise<void> {
    const { error } = await this.#client.rpc('complete_game', {
      p_game_id: input.gameId,
      p_score: input.score,
      p_op_stats: input.opStats,
      p_placement: input.placement ?? null,
      p_winning_score: input.winningScore ?? null,
    });
    if (error) throw new Error(`complete_game failed: ${error.message}`);
  }
}

/**
 * Both variables or neither. Half-configured is treated as unconfigured and
 * announced, because silently dropping every score is far worse than not
 * starting with persistence at all.
 */
export function createPersistence(env: NodeJS.ProcessEnv = process.env): Persistence {
  const url = env['SUPABASE_URL'];
  const key = env['SUPABASE_SERVICE_ROLE_KEY'];

  if (url && key) return new SupabasePersistence(url, key);

  if (url || key) {
    console.warn(
      'persistence: only one of SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is set — running without persistence',
    );
  } else {
    console.log('persistence: not configured, scores will not be saved');
  }
  return disabled;
}
