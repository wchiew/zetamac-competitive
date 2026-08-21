-- Game history, per-round aggregates, and the denormalized counters that
-- profile pages and leaderboards read.

create type public.game_mode as enum ('solo', 'multiplayer');
create type public.operation as enum ('add', 'sub', 'mul', 'div');

/*
 * One row per round *started*, not per round finished.
 *
 * Rows are inserted when the clock starts and updated when it runs out, so an
 * abandoned round leaves `completed = false` behind. Writing only on
 * completion would make "games started" unknowable — a rage-quit would simply
 * never exist — and inflate every average, because only the rounds worth
 * finishing would be recorded.
 */
create table public.games (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,

  -- Scores only compare within an identical ruleset. A 30s dev round carries a
  -- different key and can never be mistaken for a real one.
  mode_key        text not null,
  game_mode       public.game_mode not null,
  duration_s      integer not null check (duration_s > 0),

  /*
   * Whether the score came from the authoritative server rather than the
   * browser. Separate from game_mode even though they coincide today: M3 moves
   * ranked solo into a server room, at which point a solo round is verified
   * too. Leaderboards filter on this, so it must never be inferred.
   */
  server_verified boolean not null,

  started_at      timestamptz not null default now(),
  completed       boolean not null default false,
  completed_at    timestamptz,
  score           integer not null default 0 check (score >= 0),

  -- Multiplayer context; null for solo. Placement is shared on ties.
  lobby_size      smallint check (lobby_size between 2 and 4),
  placement       smallint check (placement >= 1),
  winning_score   integer check (winning_score >= 0),

  constraint completion_is_timestamped
    check (completed = (completed_at is not null)),
  constraint multiplayer_context_matches_mode
    check (
      (game_mode = 'multiplayer' and lobby_size is not null)
      or (game_mode = 'solo' and lobby_size is null and placement is null
          and winning_score is null)
    )
);

-- Profile history, newest first.
create index games_by_user on public.games (user_id, started_at desc);

/*
 * Per-operation timing, one row per operation that appeared.
 *
 * A separate table rather than eight columns on `games`: it keeps the parent
 * row about the round, and "how has my division trended this month" becomes a
 * plain group-by instead of picking a column by name.
 */
create table public.game_operation_stats (
  game_id         uuid not null references public.games (id) on delete cascade,
  op              public.operation not null,
  solved          integer not null check (solved >= 0),
  -- Median, not mean: one tab-away mid-round makes a mean meaningless.
  -- Null when nothing of this operation was solved.
  median_solve_ms integer check (median_solve_ms >= 0),

  primary key (game_id, op)
);

/*
 * Denormalized counters, updated in the same transaction as the game row.
 *
 * Averages and win rates are read on every profile page and leaderboard;
 * recomputing them from `games` each time is a scan that only grows. Keyed by
 * game mode as well as ruleset because solo and multiplayer completion rates
 * are not comparable — a solo round is abandoned by choice, a multiplayer one
 * can end because the lobby emptied.
 */
create table public.profile_stats (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  mode_key   text not null,
  game_mode  public.game_mode not null,

  started    integer not null default 0,
  completed  integer not null default 0,
  high_score integer not null default 0,
  -- Sum rather than a stored average, so the mean stays exact as it grows.
  score_sum  bigint  not null default 0,
  -- Multiplayer only. Ties count as a win for everyone tied.
  wins       integer not null default 0,

  primary key (user_id, mode_key, game_mode)
);

-- All-time leaderboard: one row per player already, which is what a board
-- wants — a player's best, not fifty entries from their best day.
create index profile_stats_leaderboard
  on public.profile_stats (mode_key, game_mode, high_score desc);

/*
 * Daily leaderboard (M3), kept as best-per-player-per-day.
 *
 * Upserted with GREATEST rather than aggregated at read time, which turns the
 * daily board into a single index scan instead of a time-window group-by.
 * `day` is the UTC date — a fixed boundary everyone shares, at the cost of
 * resetting mid-afternoon for some players.
 */
create table public.daily_best (
  day      date not null,
  mode_key text not null,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  score    integer not null check (score >= 0),
  game_id  uuid references public.games (id) on delete set null,

  primary key (day, mode_key, user_id)
);

create index daily_best_leaderboard on public.daily_best (day, mode_key, score desc);

alter table public.games                enable row level security;
alter table public.game_operation_stats enable row level security;
alter table public.profile_stats        enable row level security;
alter table public.daily_best           enable row level security;

/*
 * No insert or update policies anywhere in this file. Every write goes through
 * the game server's service-role key, which bypasses RLS. A browser that can
 * insert its own score row makes every leaderboard meaningless, and no
 * client-side check can prevent that.
 */

-- Your own history is yours; aggregates below are what the world sees.
create policy "own games are readable"
  on public.games for select
  using ((select auth.uid()) = user_id);

create policy "own game operation stats are readable"
  on public.game_operation_stats for select
  using (
    exists (
      select 1 from public.games g
      where g.id = game_operation_stats.game_id
        and g.user_id = (select auth.uid())
    )
  );

create policy "profile stats are publicly readable"
  on public.profile_stats for select
  using (true);

create policy "daily leaderboard is publicly readable"
  on public.daily_best for select
  using (true);
