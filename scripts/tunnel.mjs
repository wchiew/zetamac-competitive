/**
 * Starts a Cloudflare quick tunnel pointing at the local game server.
 *
 * Exists instead of a bare `cloudflared ...` npm script because the installer
 * adds cloudflared to PATH for *new* shells only — so the command reliably
 * fails in the terminal you installed it from. Checking the known install
 * locations first avoids that, and means an absolute path is spawned rather
 * than relying on PATH resolution at all.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = process.env.PORT ?? '8787';

const CANDIDATES = [
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
  '/opt/homebrew/bin/cloudflared',
  '/usr/local/bin/cloudflared',
  '/usr/bin/cloudflared',
];

const INSTALL_HELP = [
  'cloudflared was not found.',
  '  Windows:  winget install --id Cloudflare.cloudflared',
  '  macOS:    brew install cloudflared',
  '  Linux:    see https://github.com/cloudflare/cloudflared/releases',
].join('\n');

// Falls back to bare PATH resolution for installs in unusual locations; a
// missing binary then surfaces as an ENOENT on the 'error' handler below.
const bin = CANDIDATES.find(existsSync) ?? 'cloudflared';

// Not fatal — the tunnel can come up first and the server after — but a 502
// in the browser is a lot more confusing than a warning here.
try {
  const response = await fetch(`http://localhost:${PORT}/health`, {
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error(String(response.status));
} catch {
  console.warn(`! Nothing responding on http://localhost:${PORT} — run "npm start" first.\n`);
}

console.log(`Using ${bin}`);
console.log('Share the trycloudflare.com URL below. It changes every restart.\n');

const child = spawn(bin, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(error.code === 'ENOENT' ? INSTALL_HELP : error);
  process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 0));
