-- Profiles: one row per account, created automatically on signup.

create extension if not exists citext;

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  -- citext so "Alice" and "alice" cannot both exist. Leaderboards show this.
  username   citext not null unique,
  -- Presentation settings, mirrored from localStorage. Free-form on purpose:
  -- adding a theme option should not need a migration.
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,16}$')
);

/*
 * Every account gets a profile immediately, with a generated handle.
 *
 * The alternative — a nullable username filled in during onboarding — means
 * every join to profiles has to cope with a half-built row, and a user who
 * abandons onboarding is invisible to their own game history. A generated
 * handle keeps the column NOT NULL and every profile leaderboard-eligible
 * from the first second; the user renames it whenever they like.
 */
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, 'player_' || substr(replace(new.id::text, '-', ''), 1, 8));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

-- Usernames are public: they appear on leaderboards next to scores.
create policy "profiles are publicly readable"
  on public.profiles for select
  using (true);

-- Renaming yourself and changing your settings is the only self-service write.
create policy "own profile is updatable"
  on public.profiles for update
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
