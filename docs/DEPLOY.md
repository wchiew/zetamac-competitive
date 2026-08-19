# Hosting it

The server serves the built client from its own process, so there is one
service on one origin. The client connects to `wss://${location.host}/ws`,
which means **no URL to configure anywhere** — it works on localhost, through a
tunnel, and on a real host without changing a line.

## Playing with other people via Cloudflare Tunnel

Free, needs no Cloudflare account, and takes about a minute. The game runs on
your machine; `cloudflared` gives it a public HTTPS address.

**1. Install cloudflared** (once):

```sh
winget install --id Cloudflare.cloudflared   # macOS: brew install cloudflared
```

**2. Start the game server:**

```sh
npm start
```

That builds the client and serves everything on <http://localhost:8787>.

**3. In a second terminal, open the tunnel:**

```sh
npm run tunnel
```

`cloudflared` prints a URL like `https://random-words-here.trycloudflare.com`.
Share it. That is the whole thing.

`npm run tunnel` goes through `scripts/tunnel.mjs`, which looks for cloudflared
in its usual install locations before falling back to PATH. The installer only
adds itself to the PATH of *new* shells, so a bare `cloudflared` command tends
to fail in the terminal you installed from — this sidesteps that. It also warns
if nothing is listening on the port yet, since a 502 in the browser is a much
more confusing way to discover you forgot `npm start`.

### What to know

- **The URL changes every time** you restart the tunnel. Quick tunnels are
  throwaway. For a stable address you need a Cloudflare account and a domain,
  then a named tunnel (`cloudflared tunnel create`).
- **It is only up while your machine is on** and both commands are running.
- **Restarting the server kills every game in progress.** State is in memory
  and there is no reconnect, so don't redeploy mid-session.
- Players on the tunnel URL get real HTTPS, so the client upgrades to `wss://`
  by itself.

## Moving to a real host later

Two things are already handled: the server binds `0.0.0.0` (configurable via
`HOST`) and reads `PORT`, and it pings every connection every 25s — below the
idle timeout of every proxy this is likely to sit behind, and doubling as
dead-connection detection.

**Run exactly one instance.** Rooms live in an in-process `Map`, so a second
replica is a second, invisible pool of lobbies: a player who creates code
`1234` on instance A cannot be found by someone joining on instance B, and
matchmaking silently splits people apart. No error, just an empty lobby. This
rules out serverless entirely, and means any autoscaling must be pinned to 1.

Reasonable targets, given that:

| Host | Cost | Notes |
|---|---|---|
| Oracle Cloud Always Free | free | Real always-on VM; ARM capacity is often unavailable |
| Fly.io | ~$3/mo | Set `auto_stop_machines = false`, `min_machines_running = 1` |
| AWS Lightsail | $5/mo | A VPS; the only sane AWS option at this size |
| Render free tier | free | Sleeps after 15min idle with a ~1min cold start |
