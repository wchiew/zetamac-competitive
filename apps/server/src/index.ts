import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  MAX_PLAYERS,
  isJoinCode,
  sanitizeName,
  type ClientMessage,
  type ServerMessage,
} from '@zmc/shared';
import { createPersistence } from './persistence.js';
import { RoomRegistry, type Room } from './rooms.js';

const PORT = Number(process.env['PORT'] ?? 8787);
/** 0.0.0.0 so the process is reachable from outside its own container/host. */
const HOST = process.env['HOST'] ?? '0.0.0.0';

/**
 * Kept below the idle timeout of every proxy this is likely to sit behind.
 * Without it, a player waiting alone in a lobby sends and receives nothing and
 * gets silently disconnected. Doubles as dead-connection detection: a client
 * that vanishes without closing cleanly is terminated on the next sweep
 * instead of lingering in the roster.
 */
const HEARTBEAT_MS = 25_000;

const CLIENT_DIST = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist');

const app = Fastify({ logger: false });
const registry = new RoomRegistry();
// Not yet wired to rounds: recording a game needs a user to attribute it to,
// which arrives with auth. Constructed here so a misconfiguration is announced
// at boot rather than discovered when the first score fails to save.
const persistence = createPersistence();

// `rooms` is here so leak regressions are observable from outside the process.
app.get('/health', async () => ({
  ok: true,
  rooms: registry.size,
  persistence: persistence.enabled,
}));

// Serving the built client from this same process keeps everything on one
// origin, so the client's `wss://${location.host}/ws` works untouched — no
// CORS, and no backend URL to configure. Absent in dev, where Vite serves it.
if (existsSync(CLIENT_DIST)) {
  await app.register(fastifyStatic, { root: CLIENT_DIST });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/ws') || request.url.startsWith('/health')) {
      return reply.code(404).send({ error: 'not found' });
    }
    return reply.sendFile('index.html');
  });
}

await app.ready();

const wss = new WebSocketServer({ server: app.server, path: '/ws' });

interface Session {
  room: Room | null;
  playerId: string;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function fail(socket: WebSocket, message: string): void {
  send(socket, { t: 'error', message });
}

function enter(socket: WebSocket, session: Session, room: Room, name: string): void {
  const player = room.add(sanitizeName(name), socket);
  session.room = room;
  session.playerId = player.id;
  // Read the state after add(), since a join that fills a public lobby starts
  // the round immediately and the newcomer needs the post-start view.
  send(socket, { t: 'joined', code: room.code, playerId: player.id, ...room.state() });
  room.broadcastLobby();
}

function handle(socket: WebSocket, session: Session, message: ClientMessage): void {
  switch (message.t) {
    case 'ping':
      // Replied to immediately and without any other work, so the round trip
      // measures the network rather than this handler.
      send(socket, { t: 'pong', clientTime: message.clientTime, serverTime: Date.now() });
      return;

    case 'create': {
      if (session.room) return fail(socket, 'Already in a lobby.');
      enter(socket, session, registry.create(false), message.name);
      return;
    }

    case 'matchmake': {
      if (session.room) return fail(socket, 'Already in a lobby.');
      // Selection and join happen in this one synchronous stretch, which is
      // what makes taking the last slot atomic. Do not add an await here.
      enter(socket, session, registry.findOrCreate(), message.name);
      return;
    }

    case 'join': {
      if (session.room) return fail(socket, 'Already in a lobby.');
      if (!isJoinCode(message.code)) return fail(socket, 'Join codes are 4 digits.');
      const room = registry.get(message.code);
      if (!room) return fail(socket, 'No lobby with that code.');
      if (room.isFull) return fail(socket, `Lobby is full (${MAX_PLAYERS} players).`);
      if (!room.acceptsJoins) return fail(socket, 'That game is already in progress.');
      enter(socket, session, room, message.name);
      return;
    }

    case 'start': {
      if (!session.room) return fail(socket, 'Not in a lobby.');
      const reason = session.room.canStart(session.playerId);
      if (reason) return fail(socket, reason);
      session.room.startRound();
      return;
    }

    case 'progress': {
      session.room?.reportProgress(session.playerId, message.solvedThrough);
      return;
    }
  }
}

/** Sockets that have answered the most recent ping. */
const alive = new WeakMap<WebSocket, boolean>();

wss.on('connection', (socket) => {
  const session: Session = { room: null, playerId: '' };
  alive.set(socket, true);
  socket.on('pong', () => alive.set(socket, true));

  socket.on('message', (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return fail(socket, 'Malformed message.');
    }
    // A thrown handler must not take down the process along with every other
    // lobby currently mid-game.
    try {
      handle(socket, session, message);
    } catch (error) {
      app.log.error(error);
      fail(socket, 'Server error.');
    }
  });

  socket.on('close', () => {
    if (!session.room) return;
    // remove() reaps the room itself once its last connected player is gone.
    session.room.remove(session.playerId);
    session.room = null;
  });
});

registry.startReaper();

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    // No pong since the last sweep means the peer is gone; terminate() fires
    // 'close', which removes them from their room and reaps it if empty.
    if (alive.get(socket) === false) {
      socket.terminate();
      continue;
    }
    alive.set(socket, false);
    socket.ping();
  }
}, HEARTBEAT_MS);
heartbeat.unref();

await app.listen({ port: PORT, host: HOST });
console.log(`zetamac-competitive listening on http://localhost:${PORT}`);
