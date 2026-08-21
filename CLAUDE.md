# CLAUDE.md

Conventions and hazards specific to this repo. `docs/ARCHITECTURE.md` carries the
long-form reasoning; this file is the short list of things that are easy to get
wrong without being told. Ensure that CLAUDE.md never exceeds 250 lines. 

## Toolchain

Node 20+ (developed on 24). Package manager is **npm workspaces (npm 11), not
pnpm** — deliberately, so contributors need one less global install.

| Command | Does |
|---|---|
| `npm run dev` | Server on :8787 + Vite on :5173, **30-second rounds** |
| `npm test` | `@zmc/shared` generator tests + `@zmc/server` PGlite schema tests |
| `npm run check` | `svelte-check` and `tsc --noEmit` across both apps |
| `npm start` | Builds the client and serves everything from the server on :8787 |
| `npm run tunnel` | Public HTTPS URL via cloudflared (needs `npm start` running) |

## Things that break silently

**`packages/shared` must stay byte-identical on both sides of the wire.** Client
and server derive the same problem sequence from the same seed; that is what
makes a lobby fair and a score verifiable. Never reimplement the PRNG or the
generator per-app, and never "clean up" `mulberry32`.

**Changing `DEFAULT_MODE_KEY`'s format is a migration, not an edit.** It splits
every leaderboard in two. A test pins it, built from `SHIPPED_ROUND_SECONDS`
rather than the live default so the dev override can't make the guard vacuous.

**Never `await` between `findOrCreate()` and `add()`** (`apps/server/src/rooms.ts`).
That synchronous stretch is the only thing making "take the last slot" atomic.
If async work is ever needed, do it *before* selection and re-validate after.

**Never clamp a player's claim on arrival.** The server stores raw `claimed` and
recomputes `score = min(claimed, ceiling)` on every broadcast, because an honest
opening burst legitimately exceeds the ceiling at that instant — and a client
whose total hasn't changed never sends again, so a clamp destroys those answers
permanently.

**No client-side database writes, ever.** No table in `supabase/migrations/` has
an insert or update policy; everything goes through the server's service-role
key. A browser that can insert its own score row makes every leaderboard
meaningless. If a feature seems to need a client write, it needs a server
endpoint instead.

**Run exactly one server instance.** Rooms live in an in-process `Map`, so a
second replica is a second invisible pool of lobbies — join code `1234` on
instance A is unreachable from instance B, with no error. Rules out serverless;
pin any autoscaling to 1.

**In multiplayer the client takes `durationSeconds` from the server**, never from
its own `DEFAULT_MODE`. The server owns the deadline.

## Client performance rules (game screen only)

The game screen is held to a stricter standard than the rest of the app:

- The answer field is **uncontrolled**. The keystroke handler reads
  `input.value` and writes reactive state only on a correct answer.
- `apps/web/src/lib/metrics.ts` writes **plain objects, never `$state`** — it runs
  on the keystroke path, where a reactive write puts a render between a key and
  the screen.
- **rAF is display only.** Browsers pause it in a hidden tab, so round start and
  the deadline run on `setTimeout`. Recompute every painted value from the
  clock rather than accumulating, so a backgrounded tab self-corrects.

## Code conventions

- **Svelte 5 runes** (`$state`, `$derived`), no stores. Reactive modules are
  named `*.svelte.ts`.
- **Relative imports carry `.js`** in `apps/server` and `packages/shared`
  (`./rooms.js` from a `.ts` file). The web app omits extensions.
- Private class members use `#field`, not TS `private`.
- TS is `strict` with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`, so
  env access is bracketed: `process.env['PORT']`.
- **Comments explain *why*, and usually name the rejected alternative.** That is
  the house style throughout — match its density rather than stripping it or
  adding restatements of what the code does.
- Commit messages are terse and lowercase: `multiplayer added`, `game metrics added`.

## Tests

`apps/server/test/schema.test.ts` applies the **real migration files unmodified**
to PGlite (in-process WASM Postgres — no Docker, no Supabase project). If you
change a migration, keep the test running it verbatim; never fork a copy into
the test. RLS *enforcement* is not covered there — PGlite runs as superuser and
bypasses row security, so policies are checked for validity, not effect.

## Current state

M0/M1 shipped. **M2 is in progress and uncommitted**: the three migrations,
`apps/server/src/persistence.ts`, and the schema test.

`createPersistence()` is constructed at boot and reported on `/health`, but is
**not yet wired to rounds** — `games.user_id` is `not null references profiles`,
so there is no row to write until auth exists. It has a no-op default so the
game stays fully playable with no Supabase project configured; keep it that way.

Remaining M2, in order: Supabase auth → wire multiplayer (the server already
owns the round lifecycle) → an authenticated HTTP endpoint for solo, which
currently bypasses the server entirely. Note that `complete_game()`'s
`p_op_stats` needs per-operation medians that today exist only in the browser,
so wiring multiplayer requires a new message in `packages/shared/src/protocol.ts`.
