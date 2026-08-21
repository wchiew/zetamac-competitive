/*
 * The two write entry points. Both are called by the game server with the
 * service-role key and are revoked from browser roles below.
 *
 * They exist as functions rather than as a handful of statements issued from
 * Node because the aggregates must move with the game row or not at all. Four
 * separate round trips can fail after the second, leaving `completed` counting
 * a round whose score was never stored — and a denormalized counter that has
 * drifted has no way to notice.
 */

create function public.start_game(
  p_user_id         uuid,
  p_mode_key        text,
  p_game_mode       public.game_mode,
  p_duration_s      integer,
  p_server_verified boolean,
  p_lobby_size      smallint default null
)
returns uuid
language plpgsql
as $$
declare
  v_game_id uuid;
begin
  insert into public.games (
    user_id, mode_key, game_mode, duration_s, server_verified, lobby_size
  )
  values (
    p_user_id, p_mode_key, p_game_mode, p_duration_s, p_server_verified, p_lobby_size
  )
  returning id into v_game_id;

  insert into public.profile_stats (user_id, mode_key, game_mode, started)
  values (p_user_id, p_mode_key, p_game_mode, 1)
  on conflict (user_id, mode_key, game_mode) do update
    set started = public.profile_stats.started + 1;

  return v_game_id;
end;
$$;

/*
 * p_op_stats is [{"op":"add","solved":12,"median_solve_ms":900}, ...] —
 * operations that never appeared are simply absent.
 */
create function public.complete_game(
  p_game_id       uuid,
  p_score         integer,
  p_op_stats      jsonb default '[]'::jsonb,
  p_placement     smallint default null,
  p_winning_score integer default null
)
returns void
language plpgsql
as $$
declare
  v_game public.games;
begin
  /*
   * `and not completed` makes this idempotent: a retried call after a network
   * blip updates nothing and returns, rather than counting the round twice.
   */
  update public.games
     set completed     = true,
         completed_at  = now(),
         score         = p_score,
         placement     = p_placement,
         winning_score = p_winning_score
   where id = p_game_id
     and not completed
  returning * into v_game;

  if not found then
    return;
  end if;

  insert into public.game_operation_stats (game_id, op, solved, median_solve_ms)
  select
    p_game_id,
    (entry ->> 'op')::public.operation,
    (entry ->> 'solved')::integer,
    (entry ->> 'median_solve_ms')::integer
  from jsonb_array_elements(p_op_stats) as entry
  on conflict (game_id, op) do nothing;

  insert into public.profile_stats (
    user_id, mode_key, game_mode, started, completed, high_score, score_sum, wins
  )
  values (
    v_game.user_id, v_game.mode_key, v_game.game_mode,
    0, 1, p_score, p_score,
    case when p_placement = 1 then 1 else 0 end
  )
  on conflict (user_id, mode_key, game_mode) do update
    set completed  = public.profile_stats.completed + 1,
        high_score = greatest(public.profile_stats.high_score, excluded.high_score),
        score_sum  = public.profile_stats.score_sum + excluded.score_sum,
        wins       = public.profile_stats.wins + excluded.wins;

  /*
   * Only verified scores reach a leaderboard. Today that means multiplayer
   * only — a solo score is computed entirely in the browser, so publishing it
   * beside verified ones would make the board indefensible. M3 fixes this by
   * routing ranked solo through a server room, at which point those rounds
   * arrive here already verified and nothing below has to change.
   */
  if v_game.server_verified then
    insert into public.daily_best (day, mode_key, user_id, score, game_id)
    values ((v_game.completed_at at time zone 'utc')::date, v_game.mode_key,
            v_game.user_id, p_score, p_game_id)
    on conflict (day, mode_key, user_id) do update
      set score   = greatest(public.daily_best.score, excluded.score),
          game_id = case
                      when excluded.score > public.daily_best.score then excluded.game_id
                      else public.daily_best.game_id
                    end;
  end if;
end;
$$;

-- Browsers must never reach these; the service role bypasses the revoke.
revoke execute on function public.start_game(uuid, text, public.game_mode, integer, boolean, smallint)
  from anon, authenticated;
revoke execute on function public.complete_game(uuid, integer, jsonb, smallint, integer)
  from anon, authenticated;
