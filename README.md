# zetamac-competitive

Competitive multiplayer math game with Monkeytype-style leaderboard and profile stats.

Gameplay matches zetamac exactly: 120 seconds, addition and subtraction over
2–100, multiplication and division over 2–12 by 2–100, and answers that submit
the instant they match — no Enter key.

## Status

**M1 — solo and 2–4 player multiplayer.** No accounts or leaderboards yet; see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and milestones.

## Running it

Requires Node 20+ (developed on 24). No external accounts needed.

```sh
npm install
npm run dev      # game server on :8787, web on http://localhost:5173
```

`npm run dev` uses **30-second rounds** so you are not waiting two minutes to
see a results screen. Production (`npm start`) is the real 120. Override with
`ROUND_SECONDS` / `VITE_ROUND_SECONDS`.

`npm run dev` starts both processes. Vite proxies `/ws` to the game server, so
the browser only ever talks to its own origin.

To try multiplayer locally, open two tabs and hit "Find a game" in both, or
create a private lobby and join with its 4-digit code.

## Playing with other people

```sh
npm start        # builds the client and serves everything on :8787
npm run tunnel   # in a second terminal — prints a public https URL to share
```

See [docs/DEPLOY.md](docs/DEPLOY.md) for the details and for real hosting.

Other commands:

```sh
npm test         # problem generator tests (determinism, ranges, mode keys)
npm run check    # svelte-check
npm run build    # production bundle
```

## Layout

```
packages/shared/   PRNG, problem generator, mode config, wire protocol
apps/server/       Fastify + ws game server — authoritative on scores and timing
apps/web/          Svelte client
```

`packages/shared` must stay identical on both sides of the wire: multiplayer
fairness and server-side score verification both depend on the client and
server deriving the same problems from the same seed. Change it carefully, and
keep its tests passing.
