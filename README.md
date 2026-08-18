# zetamac-competitive

Competitive multiplayer math game with Monkeytype-style leaderboard and profile stats.

Gameplay matches zetamac exactly: 120 seconds, addition and subtraction over
2–100, multiplication and division over 2–12 by 2–100, and answers that submit
the instant they match — no Enter key.

## Status

**M0 — playable solo.** No backend and no accounts yet; see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and milestones.

## Running it

Requires Node 20+ (developed on 24).

```sh
npm install
npm run dev      # http://localhost:5173
```

Other commands:

```sh
npm test         # problem generator tests (determinism, ranges, mode keys)
npm run check    # svelte-check
npm run build    # production bundle
```

## Layout

```
packages/shared/   PRNG, problem generator, mode config  — shared by client and server
apps/web/          Svelte client
```

`packages/shared` must stay identical on both sides of the wire: multiplayer
fairness and server-side score verification both depend on the client and
server deriving the same problems from the same seed. Change it carefully, and
keep its tests passing.
