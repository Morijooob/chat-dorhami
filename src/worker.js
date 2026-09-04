import { DurableObject } from 'cloudflare:workers';

const COOKIE = 'dorhami_session';
const ROOM = 'general';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/ws') {
      const id = env.DORHAMI.idFromName('main');
      return env.DORHAMI.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};

export class Dorhami extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.clients = new Map();
    state.blockConcurrencyWhile(async () => {
      state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
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
        CREATE INDEX IF NOT EXISTS messages_room_id ON messages(room, id);
      `);
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') return this.websocket(request);
    if (url.pathname === '/api/health') return json({ ok: true, service: 'dorhami-mon' });
    if (url.pathname === '/api/register' && request.method === 'POST') return this.register(request);
    if (url.pathname === '/api/login' && request.method === 'POST') return this.login(request);
    if (url.pathname === '/api/logout' && request.method === 'POST') return this.logout(request);
    if (url.pathname === '/api/me') return this.me(request);
    if (url.pathname === '/api/rooms') return this.rooms(request);
    return json({ error: 'Not found' }, 404);
  }

  async register(request) {
    const body = await readJson(request);
    const username = cleanName(body.username);
    const password = String(body.password || '');
    if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(username)) return json({ error: 'نام کاربری باید ۳ تا ۲۴ کاراکتر باشد.' }, 400);
    if (password.length < 6 || password.length > 128) return json({ error: 'رمز عبور باید حداقل ۶ کاراکتر باشد.' }, 400);
    const exists = this.state.storage.sql.exec('SELECT id FROM users WHERE username = ?', username).one();
    if (exists) return json({ error: 'این نام کاربری قبلاً ثبت شده است.' }, 409);
    const salt = bytes(16);
    const hash = await derive(password, salt);
    const now = Date.now();
    this.state.storage.sql.exec('INSERT INTO users(username,password_hash,salt,created_at) VALUES(?,?,?,?)', username, hash, b64(salt), now);
    const user = this.state.storage.sql.exec('SELECT id,username,role FROM users WHERE username=?', username).one();
    const token = await this.createSession(user.id);
    return withCookie(json({ ok: true, user }), token);
  }

  async login(request) {
    const body = await readJson(request);
    const username = cleanName(body.username);
    const password = String(body.password || '');
    if (!username || !password) return json({ error: 'نام کاربری و رمز عبور را وارد کن.' }, 400);
    const user = this.state.storage.sql.exec('SELECT id,username,role,password_hash,salt FROM users WHERE username=?', username).one();
    if (!user) return json({ error: 'نام کاربری یا رمز عبور اشتباه است.' }, 401);
    const candidate = await derive(password, fromB64(user.salt));
    if (!safeEqual(user.password_hash, candidate)) return json({ error: 'نام کاربری یا رمز عبور اشتباه است.' }, 401);
    const token = await this.createSession(user.id);
    return withCookie(json({ ok: true, user: { id: user.id, username: user.username, role: user.role } }), token);
  }

  async createSession(userId) {
    const token = b64(bytes(32));
    const tokenHash = await sha256(token);
    this.state.storage.sql.exec('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', tokenHash, userId, Date.now() + 1000 * 60 * 60 * 24 * 30);
    return token;
  }

  async auth(request) {
    const token = cookie(request, COOKIE);
    if (!token) return null;
    const tokenHash = await sha256(token);
    const row = this.state.storage.sql.exec(
      'SELECT u.id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',
      tokenHash, Date.now()
    ).one();
    return row || null;
  }

  async logout(request) {
    const token = cookie(request, COOKIE);
    if (token) this.state.storage.sql.exec('DELETE FROM sessions WHERE token_hash=?', await sha256(token));
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': clearCookie() }
    });
  }

  async me(request) {
    const user = await this.auth(request);
    return json({ authenticated: !!user, user: user || null });
  }

  async rooms(request) {
    const user = await this.auth(request);
    if (!user) return json({ error: 'وارد حساب شو.' }, 401);
    const messages = this.state.storage.sql.exec(
      'SELECT id,username,body,created_at FROM messages WHERE room=? ORDER BY id DESC LIMIT 80', ROOM
    ).toArray().reverse();
    return json({ rooms: [{ id: ROOM, name: 'عمومی', icon: '💬', online: this.clients.size }], messages });
  }

  async websocket(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket required' }, 426);
    const user = await this.auth(request);
    if (!user) return json({ error: 'ابتدا وارد حساب شو.' }, 401);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const key = crypto.randomUUID();
    this.clients.set(key, { ws: server, user });
    const remove = () => {
      if (!this.clients.delete(key)) return;
      this.broadcastPresence();
    };
    server.addEventListener('message', async e => {
      try {
        const msg = JSON.parse(String(e.data));
        if (msg.type === 'history') return this.sendHistory(server);
        if (msg.type === 'ping') return server.send(JSON.stringify({ type: 'pong' }));
        if (msg.type === 'message') await this.broadcastMessage(user, msg.body);
      } catch {}
    });
    server.addEventListener('close', remove);
    server.addEventListener('error', remove);
    server.send(JSON.stringify({ type: 'ready', user: { id: user.id, username: user.username, role: user.role } }));
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async sendHistory(ws) {
    const messages = this.state.storage.sql.exec(
      'SELECT id,username,body,created_at FROM messages WHERE room=? ORDER BY id DESC LIMIT 80', ROOM
    ).toArray().reverse();
    ws.send(JSON.stringify({ type: 'history', messages }));
  }

  async broadcastMessage(user, raw) {
    const body = String(raw || '').trim();
    if (!body || body.length > 2000) return;
    const now = Date.now();
    this.state.storage.sql.exec(
      'INSERT INTO messages(room,user_id,username,body,created_at) VALUES(?,?,?,?,?)', ROOM, user.id, user.username, body, now
    );
    const row = this.state.storage.sql.exec(
      'SELECT id,username,body,created_at FROM messages WHERE room=? ORDER BY id DESC LIMIT 1', ROOM
    ).one();
    this.broadcast({ type: 'message', message: row });
  }

  broadcast(data) {
    const text = JSON.stringify(data);
    for (const [key, c] of this.clients) {
      try { c.ws.send(text); } catch { this.clients.delete(key); }
    }
  }

  broadcastPresence() {
    this.broadcast({
      type: 'presence',
      count: this.clients.size,
      users: [...this.clients.values()].map(x => ({ id: x.user.id, username: x.user.username, role: x.user.role }))
    });
  }
}

// Keep the previous Durable Object class export so Cloudflare can continue
// deploying the existing ChatRoom namespace without requiring a destructive migration.
export class ChatRoom extends Dorhami {}

function cleanName(v) { return String(v || '').trim().normalize('NFKC'); }
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
async function readJson(r) { try { return await r.json(); } catch { return {}; } }
function bytes(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
function b64(a) { let s = ''; for (const x of a) s += String.fromCharCode(x); return btoa(s); }
function fromB64(s) { const raw = atob(s); return Uint8Array.from(raw, c => c.charCodeAt(0)); }
async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function derive(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, key, 256);
  return b64(new Uint8Array(bits));
}
function safeEqual(a, b) {
  const x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
function cookie(r, name) {
  const h = r.headers.get('Cookie') || '';
  const m = h.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function withCookie(response, token) {
  const h = new Headers(response.headers);
  h.set('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);
  return new Response(response.body, { status: response.status, headers: h });
}
function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }
