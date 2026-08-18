# Architecture

Competitive multiplayer zetamac. 2–4 player lobbies, live opponent scores,
accounts with lifetime stats, and all-time + daily global leaderboards.

Everything runs locally except the database and auth provider.

## Stack

| Layer | Choice | Rationale |
|---|---|---|
| Client | Svelte 5 + Vite + TypeScript | ~15KB runtime, no VDOM. Currently 19KB gzipped for the whole app. |
| Realtime | Node + `ws`, hand-rolled rooms | 2–4 players per room needs a room map, not a framework. |
| HTTP API | Fastify, sharing the `ws` HTTP server | One process, one port in local dev. |
| Shared logic | `packages/shared` | Imported by both client and server. |
| DB + Auth | Supabase (Postgres + Auth) | Email/password and Google OAuth without building session handling. |

Package manager is **npm workspaces** (npm 11), not pnpm — one less global
install for contributors.

## Layout

```
packages/shared/   PRNG, problem generator, mode config, protocol types
apps/web/          Svelte client
apps/server/       Fastify + ws game server            (M1)
```

`packages/shared` is load-bearing. The seeded PRNG and problem generator must
be byte-identical on client and server or the fairness and verification models
both collapse. It is never duplicated per-app, and it is the only package with
its own test suite.

## Fairness: seeded and server-authoritative

Every player in a lobby solves the **identical problem sequence**.

1. Server generates a seed and broadcasts `{seed, startAtEpochMs}` ~3s ahead.
2. Each client derives problems locally via `ProblemGenerator(config, seed)`.
3. The server derives the same sequence and owns the authoritative score.

Supporting details:

- **Clock sync** — one round-trip offset measurement on join. Clients render
  their countdown from the synced clock; the server independently enforces the
  deadline and rejects late answers. Client timing is never trusted.
- **Score reporting** — clients send `{solvedThrough: N}` deltas at ~4Hz. The
  server timestamps arrival and enforces monotonicity plus a plausibility cap
  (>8 answers/sec is physically impossible).
- **Broadcast** — a scores snapshot to the room at ~4Hz. JSON over WS; this is
  a few hundred bytes per second and does not warrant a binary protocol.
- **Solo runs use the same server room.** If solo scores bypassed the server,
  the leaderboard would be spoofable with a single HTTP request.

**Known limit:** because answers are derivable client-side, real-time
submission checks defeat replay and end-of-round dumping, but not a determined
bot. Full anti-cheat is out of scope.

## Mode keys

Scores are only comparable within an identical config — 60 correct on
multiplication 2–5 is not 60 correct on the default ranges. Every persisted
score carries a `modeKey` (see `packages/shared/src/modes.ts`), and only
`DEFAULT_MODE_KEY` feeds the global leaderboards. Custom configs are unranked.

The default key is pinned by a test. Changing its format silently splits the
leaderboard in two, so it is a migration, not an edit.

## Schema (M2)

```
profiles       (id → auth.users, username citext unique, settings jsonb, created_at)
games          (id, mode_key, seed, duration_s, started_at, lobby_size)
game_players   (game_id, user_id, score, placement)        -- composite PK
profile_stats  (user_id, mode_key, games_played, wins, high_score, score_sum)
daily_best     (day, mode_key, user_id, score)             -- composite PK
```

- Average score and win rate are **incremental counters** in `profile_stats`,
  updated in the same transaction as the game insert. Never a scan over history.
- `daily_best` is upserted with `GREATEST(score, excluded.score)`, making the
  daily board a single index scan rather than a time-window aggregate.
- **RLS**: clients are read-only. All writes go through the server using the
  service-role key. The browser must never be able to insert a score row.

## Settings

Local-first. `localStorage` is the source of truth for first paint (applied by
an inline script in `index.html` so a custom background never flashes), syncing
to `profiles.settings` jsonb when logged in, last-write-wins.

Every setting maps onto a CSS custom property, so changes apply without a
re-render and without a network round trip.

## Client performance

The game screen is held to a stricter standard than the rest of the app:

- The answer field is **uncontrolled**. The keystroke handler reads
  `input.value` directly and writes reactive state only when the answer is
  correct — roughly once per second, not once per keystroke.
- The countdown runs on `requestAnimationFrame` but only assigns `secondsLeft`
  when the displayed integer changes, so ~59 of every 60 frames cost nothing.
- The problem row is a three-column grid with the `=` pinned to centre, so the
  answer field never moves between problems regardless of expression width.

## Hosting (later)

WebSocket connections are long-lived and stateful, so the game server **cannot
run on Vercel/Netlify serverless**. Target Fly.io, Railway, or Render, with the
static client on Cloudflare Pages.

## External services

| Service | Needed by | Purpose |
|---|---|---|
| Supabase | M2 | Postgres, email/password auth, Google provider |
| Google Cloud Console | M2 | OAuth 2.0 client ID + redirect URI |
| Resend (or Postmark) | before real users | Custom SMTP — Supabase's built-in mailer is rate-limited to a few messages/hour |

M0 and M1 require no accounts and run entirely on localhost.

## Milestones

- **M0 — done.** Monorepo, shared problem generator, solo game loop, settings
  page on localStorage.
- **M1** — `apps/server`, WS lobbies with 4-char join codes, live opponent scores.
- **M2** — Supabase auth, profiles, game persistence, stats counters.
- **M3** — all-time and daily leaderboards.
