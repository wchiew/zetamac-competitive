/*
 * The parts of a Supabase project the migrations depend on, recreated so the
 * schema can be exercised against a real Postgres without a Supabase project.
 *
 * Only what the migrations actually touch: the auth.users table they reference,
 * the auth.uid() that RLS policies call, and the two roles the RPC grants are
 * revoked from. Everything else in this directory is the real migration files,
 * run unmodified — the point is to test what ships, not a copy of it.
 */

create schema if not exists auth;

create table auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

/*
 * Stands in for Supabase's request-scoped claim lookup. Returns the value of
 * `request.jwt.claim.sub` when a test sets it, so policies can be exercised as
 * a specific user, and null otherwise (an anonymous request).
 */
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create role anon;
create role authenticated;
create role service_role;
