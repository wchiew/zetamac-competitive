/**
 * Runs the real migration files against a real Postgres (PGlite, an in-process
 * WASM build) so the schema is exercised before it ever reaches a Supabase
 * project. Without this the SQL is only ever "read carefully" — and the
 * aggregate bookkeeping in complete_game() is exactly the kind of logic that
 * looks right and counts wrong.
 *
 * What this cannot cover: RLS enforcement. PGlite runs as superuser, which
 * bypasses row security, so the policies are checked for validity here but
 * their effect is not. Same for the service-role key bypass.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { beforeEach, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '../../../supabase/migrations');

const shim = readFileSync(join(here, 'supabase-shim.sql'), 'utf8');
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), 'utf8') }));

let db: PGlite;

async function newUser(email: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    'insert into auth.users (email) values ($1) returning id',
    [email],
  );
  return result.rows[0]!.id;
}

async function stats(userId: string, gameMode = 'multiplayer') {
  const result = await db.query<Record<string, number>>(
    `select started, completed, high_score, score_sum::int as score_sum, wins
       from profile_stats where user_id = $1 and game_mode = $2`,
    [userId, gameMode],
  );
  return result.rows[0];
}

beforeEach(async () => {
  db = new PGlite({ extensions: { citext } });
  await db.exec(shim);
  for (const migration of migrations) {
    try {
      await db.exec(migration.sql);
    } catch (error) {
      throw new Error(`${migration.name} failed: ${(error as Error).message}`);
    }
  }
});

describe('migrations', () => {
  it('applies every migration file cleanly', () => {
    // Guards against an empty glob silently making this suite vacuous.
    expect(migrations.map((m) => m.name)).toEqual([
      '0001_profiles.sql',
      '0002_games.sql',
      '0003_record_game.sql',
    ]);
  });

  it('creates a profile automatically for a new account', async () => {
    const userId = await newUser('a@example.com');
    const result = await db.query<{ username: string }>(
      'select username from profiles where id = $1',
      [userId],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.username).toMatch(/^player_[0-9a-f]{8}$/);
  });

  it('removes the profile when the account is deleted', async () => {
    const userId = await newUser('b@example.com');
    await db.query('delete from auth.users where id = $1', [userId]);
    const result = await db.query('select 1 from profiles where id = $1', [userId]);
    expect(result.rows).toHaveLength(0);
  });

  it('treats usernames case-insensitively', async () => {
    const first = await newUser('c@example.com');
    const second = await newUser('d@example.com');
    await db.query('update profiles set username = $1 where id = $2', ['Alice', first]);
    // Named explicitly: a bare toThrow() would also pass on a typo'd column.
    await expect(
      db.query('update profiles set username = $1 where id = $2', ['alice', second]),
    ).rejects.toThrow(/profiles_username_key/);
  });

  it('rejects usernames outside the allowed format', async () => {
    const userId = await newUser('e@example.com');
    for (const bad of ['ab', 'has space', 'way_too_long_username', 'punc!']) {
      await expect(
        db.query('update profiles set username = $1 where id = $2', [bad, userId]),
      ).rejects.toThrow(/username_format/);
    }
  });
});

describe('games constraints', () => {
  it('refuses multiplayer context on a solo row', async () => {
    const userId = await newUser('f@example.com');
    await expect(
      db.query(
        `insert into games (user_id, mode_key, game_mode, duration_s, server_verified, lobby_size)
         values ($1, 'd120', 'solo', 120, false, 3)`,
        [userId],
      ),
    ).rejects.toThrow(/multiplayer_context_matches_mode/);
  });

  it('requires a lobby size on a multiplayer row', async () => {
    const userId = await newUser('g@example.com');
    await expect(
      db.query(
        `insert into games (user_id, mode_key, game_mode, duration_s, server_verified)
         values ($1, 'd120', 'multiplayer', 120, true)`,
        [userId],
      ),
    ).rejects.toThrow(/multiplayer_context_matches_mode/);
  });

  it('refuses a completed row without a completion timestamp', async () => {
    const userId = await newUser('h@example.com');
    await expect(
      db.query(
        `insert into games (user_id, mode_key, game_mode, duration_s, server_verified, completed)
         values ($1, 'd120', 'solo', 120, false, true)`,
        [userId],
      ),
    ).rejects.toThrow(/completion_is_timestamped/);
  });
});

describe('start_game / complete_game', () => {
  const MODE = 'd120|a|s|2-100x2-100|m|v|2-12x2-100';

  async function start(userId: string, verified = true, mode = 'multiplayer') {
    const result = await db.query<{ start_game: string }>(
      'select start_game($1, $2, $3, 120, $4, $5) as start_game',
      [userId, MODE, mode, verified, mode === 'multiplayer' ? 3 : null],
    );
    return result.rows[0]!.start_game;
  }

  it('counts a start before any completion', async () => {
    const userId = await newUser('i@example.com');
    await start(userId);
    expect(await stats(userId)).toMatchObject({ started: 1, completed: 0, high_score: 0 });
  });

  it('records a completion with its operation stats', async () => {
    const userId = await newUser('j@example.com');
    const gameId = await start(userId);
    await db.query('select complete_game($1, $2, $3::jsonb, $4, $5)', [
      gameId,
      42,
      JSON.stringify([
        { op: 'add', solved: 20, median_solve_ms: 800 },
        { op: 'div', solved: 22, median_solve_ms: 1500 },
      ]),
      1,
      42,
    ]);

    expect(await stats(userId)).toMatchObject({
      started: 1,
      completed: 1,
      high_score: 42,
      score_sum: 42,
      wins: 1,
    });

    const ops = await db.query<{ op: string; solved: number; median_solve_ms: number }>(
      'select op, solved, median_solve_ms from game_operation_stats where game_id = $1 order by op',
      [gameId],
    );
    expect(ops.rows).toEqual([
      { op: 'add', solved: 20, median_solve_ms: 800 },
      { op: 'div', solved: 22, median_solve_ms: 1500 },
    ]);
  });

  it('is idempotent — a retried completion cannot count twice', async () => {
    const userId = await newUser('k@example.com');
    const gameId = await start(userId);
    const args = [gameId, 30, JSON.stringify([]), 1, 30];
    await db.query('select complete_game($1, $2, $3::jsonb, $4, $5)', args);
    await db.query('select complete_game($1, $2, $3::jsonb, $4, $5)', args);

    expect(await stats(userId)).toMatchObject({ completed: 1, score_sum: 30, wins: 1 });
  });

  it('keeps the best score and sums the rest', async () => {
    const userId = await newUser('l@example.com');
    for (const score of [30, 55, 40]) {
      const gameId = await start(userId);
      await db.query('select complete_game($1, $2, $3::jsonb, $4, $5)', [
        gameId,
        score,
        JSON.stringify([]),
        2,
        99,
      ]);
    }
    expect(await stats(userId)).toMatchObject({
      started: 3,
      completed: 3,
      high_score: 55,
      score_sum: 125,
      wins: 0,
    });
  });

  it('keeps solo and multiplayer counters apart', async () => {
    const userId = await newUser('m@example.com');
    const soloGame = await start(userId, false, 'solo');
    await db.query('select complete_game($1, $2, $3::jsonb, $4, $5)', [
      soloGame,
      10,
      JSON.stringify([]),
      null,
      null,
    ]);
    await start(userId, true, 'multiplayer');

    expect(await stats(userId, 'solo')).toMatchObject({ started: 1, completed: 1 });
    expect(await stats(userId, 'multiplayer')).toMatchObject({ started: 1, completed: 0 });
  });
});

describe('daily leaderboard', () => {
  const MODE = 'd120|ranked';

  async function play(userId: string, score: number, verified: boolean) {
    const started = await db.query<{ start_game: string }>(
      'select start_game($1, $2, $3, 120, $4, $5) as start_game',
      [userId, MODE, 'multiplayer', verified, 2],
    );
    const gameId = started.rows[0]!.start_game;
    await db.query('select complete_game($1, $2, $3::jsonb, $4, $5)', [
      gameId,
      score,
      JSON.stringify([]),
      1,
      score,
    ]);
    return gameId;
  }

  it('keeps only a player’s best score for the day', async () => {
    const userId = await newUser('n@example.com');
    await play(userId, 40, true);
    await play(userId, 61, true);
    await play(userId, 55, true);

    const rows = await db.query<{ score: number }>(
      'select score from daily_best where user_id = $1',
      [userId],
    );
    expect(rows.rows).toEqual([{ score: 61 }]);
  });

  it('excludes unverified scores entirely', async () => {
    const userId = await newUser('o@example.com');
    await play(userId, 500, false);

    const rows = await db.query('select 1 from daily_best where user_id = $1', [userId]);
    expect(rows.rows).toHaveLength(0);
  });

  it('points at the game that set the best score', async () => {
    const userId = await newUser('p@example.com');
    await play(userId, 20, true);
    const bestGame = await play(userId, 70, true);
    await play(userId, 35, true);

    const rows = await db.query<{ game_id: string }>(
      'select game_id from daily_best where user_id = $1',
      [userId],
    );
    expect(rows.rows[0]!.game_id).toBe(bestGame);
  });
});
