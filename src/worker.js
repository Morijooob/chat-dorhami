import { DurableObject } from 'cloudflare:workers';

const COOKIE = 'dorhami_session';
const ROOM = 'general';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_MESSAGE = 2000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ws' || url.pathname.startsWith('/api/')) {
      const id = env.DORHAMI.idFromName('main');
      return env.DORHAMI.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};

export class Dorhami extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;

    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          username TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS messages_room_id ON messages(room,id);
      `);

      // Cloudflare's Hibernation API keeps WebSocket clients connected while
      // the Durable Object can leave memory when idle.
      if (typeof ctx.setWebSocketAutoResponse === 'function') {
        ctx.setWebSocketAutoResponse(
          new WebSocketRequestResponsePair('ping', 'pong')
        );
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    try {
      switch (url.pathname) {
        case '/api/health':
          return json({ ok: true, service: 'dorhami-mon', version: '3' });
        case '/api/register':
          return request.method === 'POST'
            ? await this.register(request)
            : json({ error: 'Method not allowed' }, 405);
        case '/api/login':
          return request.method === 'POST'
            ? await this.login(request)
            : json({ error: 'Method not allowed' }, 405);
        case '/api/logout':
          return request.method === 'POST'
            ? await this.logout(request)
            : json({ error: 'Method not allowed' }, 405);
        case '/api/me':
          return await this.me(request);
        case '/api/rooms':
          return await this.rooms(request);
        case '/ws':
          return await this.websocket(request);
        default:
          return json({ error: 'Not found' }, 404);
      }
    } catch (error) {
      console.error('DORHAMI_ERROR', error);
      return json({ error: 'خطای داخلی سرور', code: 'SERVER_ERROR' }, 500);
    }
  }

  async register(request) {
    const data = await readJson(request);
    const name = cleanName(data.username);
    const password = String(data.password ?? '');

    if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(name)) {
      return json({ error: 'نام کاربری باید ۳ تا ۲۴ کاراکتر باشد.' }, 400);
    }
    if (password.length < 6) {
      return json({ error: 'رمز عبور باید حداقل ۶ کاراکتر باشد.' }, 400);
    }

    const existing = this.ctx.storage.sql
      .exec('SELECT id FROM users WHERE username=? LIMIT 1', name)
      .toArray()[0];

    if (existing) {
      return json({ error: 'این نام کاربری قبلاً ثبت شده است.' }, 409);
    }

    const salt = randomBytes(16);
    const passwordHash = await derive(password, salt);

    try {
      this.ctx.storage.sql.exec(
        'INSERT INTO users(username,password_hash,salt,created_at) VALUES(?,?,?,?)',
        name,
        passwordHash,
        b64(salt),
        Date.now()
      );
    } catch (error) {
      // A concurrent registration can win the UNIQUE race.
      const duplicate = this.ctx.storage.sql
        .exec('SELECT id FROM users WHERE username=? LIMIT 1', name)
        .toArray()[0];
      if (duplicate) {
        return json({ error: 'این نام کاربری قبلاً ثبت شده است.' }, 409);
      }
      throw error;
    }

    const user = this.ctx.storage.sql
      .exec('SELECT id,username FROM users WHERE username=? LIMIT 1', name)
      .toArray()[0];

    if (!user) {
      throw new Error('USER_CREATE_FAILED');
    }

    const token = await this.createSession(user.id);
    return withCookie(
      json({ ok: true, user }),
      token
    );
  }

  async login(request) {
    const data = await readJson(request);
    const name = cleanName(data.username);
    const password = String(data.password ?? '');

    if (!name || !password) {
      return json({ error: 'نام کاربری و رمز عبور را وارد کن.' }, 400);
    }

    const user = this.ctx.storage.sql
      .exec(
        'SELECT id,username,password_hash,salt FROM users WHERE username=? LIMIT 1',
        name
      )
      .toArray()[0];

    if (!user) {
      return json({ error: 'نام کاربری یا رمز عبور اشتباه است.' }, 401);
    }

    const passwordHash = await derive(password, fromB64(user.salt));
    if (!safeEqual(user.password_hash, passwordHash)) {
      return json({ error: 'نام کاربری یا رمز عبور اشتباه است.' }, 401);
    }

    const token = await this.createSession(user.id);
    return withCookie(
      json({ ok: true, user: { id: user.id, username: user.username } }),
      token
    );
  }

  async createSession(userId) {
    const token = b64(randomBytes(32));
    const tokenHash = await sha256(token);

    this.ctx.storage.sql.exec(
      'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',
      tokenHash,
      userId,
      Date.now() + SESSION_MS
    );

    return token;
  }

  async auth(request) {
    const token = getCookie(request, COOKIE);
    if (!token) return null;

    const row = this.ctx.storage.sql
      .exec(
        `SELECT u.id,u.username
         FROM sessions s
         JOIN users u ON u.id=s.user_id
         WHERE s.token_hash=? AND s.expires_at>?
         LIMIT 1`,
        await sha256(token),
        Date.now()
      )
      .toArray()[0];

    return row || null;
  }

  async me(request) {
    const user = await this.auth(request);
    return json({ authenticated: Boolean(user), user });
  }

  async logout(request) {
    const token = getCookie(request, COOKIE);
    if (token) {
      this.ctx.storage.sql.exec(
        'DELETE FROM sessions WHERE token_hash=?',
        await sha256(token)
      );
    }

    const response = json({ ok: true });
    const headers = new Headers(response.headers);
    headers.set(
      'Set-Cookie',
      `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    );
    return new Response(response.body, {
      status: response.status,
      headers
    });
  }

  async rooms(request) {
    const user = await this.auth(request);
    if (!user) return json({ error: 'ابتدا وارد حساب شو.' }, 401);

    const messages = this.readHistory();
    return json({
      rooms: [{
        id: ROOM,
        name: 'دورهمی عمومی',
        online: this.connectedUsers().length
      }],
      messages
    });
  }

  async websocket(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'WebSocket required' }, 426);
    }

    const user = await this.auth(request);
    if (!user) return json({ error: 'ابتدا وارد حساب شو.' }, 401);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // IMPORTANT: use the Hibernation API, not server.accept().
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      userId: user.id,
      username: user.username,
      room: ROOM
    });

    server.send(JSON.stringify({
      type: 'ready',
      user,
      room: ROOM,
      messages: this.readHistory()
    }));

    this.broadcastPresence();

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async webSocketMessage(ws, message) {
    try {
      const connection = ws.deserializeAttachment() || {};
      const user = this.userFromConnection(connection);
      if (!user) {
        ws.close(1008, 'Unauthorized');
        return;
      }

      const data = typeof message === 'string'
        ? safeJsonParse(message)
        : null;

      if (!data) return;

      if (data.type === 'history') {
        ws.send(JSON.stringify({
          type: 'history',
          messages: this.readHistory()
        }));
        return;
      }

      if (data.type === 'message') {
        await this.sendMessage(user, data.body);
        return;
      }

      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (error) {
      console.error('DORHAMI_WS_MESSAGE', error);
    }
  }

  webSocketClose(ws, code, reason) {
    try {
      ws.close(code, reason);
    } catch {}
    this.broadcastPresence();
  }

  webSocketError(ws, error) {
    console.error('DORHAMI_WS_ERROR', error);
    this.broadcastPresence();
  }

  userFromConnection(connection) {
    if (!connection?.userId || !connection?.username) return null;
    return {
      id: connection.userId,
      username: connection.username
    };
  }

  readHistory() {
    return this.ctx.storage.sql
      .exec(
        `SELECT id,username,body,created_at
         FROM messages
         WHERE room=?
         ORDER BY id DESC
         LIMIT 100`,
        ROOM
      )
      .toArray()
      .reverse();
  }

  async sendMessage(user, rawBody) {
    const body = String(rawBody ?? '').trim();
    if (!body || body.length > MAX_MESSAGE) return;

    const now = Date.now();
    this.ctx.storage.sql.exec(
      'INSERT INTO messages(room,user_id,username,body,created_at) VALUES(?,?,?,?,?)',
      ROOM,
      user.id,
      user.username,
      body,
      now
    );

    const message = this.ctx.storage.sql
      .exec(
        `SELECT id,username,body,created_at
         FROM messages
         WHERE room=?
         ORDER BY id DESC
         LIMIT 1`,
        ROOM
      )
      .toArray()[0];

    if (message) {
      this.broadcast({ type: 'message', message });
    }
  }

  broadcast(data) {
    const text = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(text);
      } catch (error) {
        console.error('DORHAMI_BROADCAST', error);
      }
    }
  }

  connectedUsers() {
    const users = [];
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const attachment = ws.deserializeAttachment();
        const user = this.userFromConnection(attachment);
        if (user) users.push(user);
      } catch {}
    }
    return users;
  }

  broadcastPresence() {
    const users = this.connectedUsers();
    this.broadcast({
      type: 'presence',
      count: users.length,
      users
    });
  }
}

// Keep the legacy export because the existing Cloudflare namespace depends on it.
export class ChatRoom extends Dorhami {}

function cleanName(value) {
  return String(value ?? '').trim().normalize('NFKC');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function readJson(request) {
  try {
    const data = await request.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function safeJsonParse(value) {
  try {
    const data = JSON.parse(value);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function b64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromB64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function derive(password, salt) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 120000,
      hash: 'SHA-256'
    },
    key,
    256
  );

  return b64(new Uint8Array(bits));
}

function safeEqual(left, right) {
  const a = String(left);
  const b = String(right);
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const parts = header.split(';');

  for (const part of parts) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;

    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }

  return null;
}

function withCookie(response, token) {
  const headers = new Headers(response.headers);
  headers.set(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_MS / 1000)}`
  );

  return new Response(response.body, {
    status: response.status,
    headers
  });
}
