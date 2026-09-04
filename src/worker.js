import { DurableObject } from 'cloudflare:workers';

const COOKIE = 'dorhami_session';
const ROOM = 'general';

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
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.sockets = new Map();
    state.blockConcurrencyWhile(async () => {
      state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
        CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, user_id INTEGER NOT NULL, username TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS messages_room_id ON messages(room,id);
      `);
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health') return json({ ok: true, service: 'dorhami-mon' });
      if (url.pathname === '/api/register' && request.method === 'POST') return this.register(request);
      if (url.pathname === '/api/login' && request.method === 'POST') return this.login(request);
      if (url.pathname === '/api/logout' && request.method === 'POST') return this.logout(request);
      if (url.pathname === '/api/me') return json({ authenticated: !!(await this.auth(request)), user: await this.auth(request) });
      if (url.pathname === '/api/rooms') return this.rooms(request);
      if (url.pathname === '/ws') return this.websocket(request);
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      console.error('DORHAMI', e);
      return json({ error: 'خطای داخلی سرور', code: 'SERVER_ERROR' }, 500);
    }
  }

  async register(request) {
    const { username, password } = await readJson(request);
    const name = cleanName(username);
    if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(name)) return json({ error: 'نام کاربری باید ۳ تا ۲۴ کاراکتر باشد.' }, 400);
    if (String(password || '').length < 6) return json({ error: 'رمز عبور باید حداقل ۶ کاراکتر باشد.' }, 400);
    if (this.state.storage.sql.exec('SELECT id FROM users WHERE username=?', name).one()) return json({ error: 'این نام کاربری قبلاً ثبت شده است.' }, 409);
    const salt = randomBytes(16);
    const hash = await derive(String(password), salt);
    this.state.storage.sql.exec('INSERT INTO users(username,password_hash,salt,created_at) VALUES(?,?,?,?)', name, hash, b64(salt), Date.now());
    const user = this.state.storage.sql.exec('SELECT id,username FROM users WHERE username=?', name).one();
    return withCookie(json({ ok: true, user }), await this.session(user.id));
  }

  async login(request) {
    const { username, password } = await readJson(request);
    const name = cleanName(username);
    if (!name || !password) return json({ error: 'نام کاربری و رمز عبور را وارد کن.' }, 400);
    const user = this.state.storage.sql.exec('SELECT id,username,password_hash,salt FROM users WHERE username=?', name).one();
    if (!user) return json({ error: 'نام کاربری یا رمز عبور اشتباه است.' }, 401);
    if (!safeEqual(user.password_hash, await derive(String(password), fromB64(user.salt)))) return json({ error: 'نام کاربری یا رمز عبور اشتباه است.' }, 401);
    return withCookie(json({ ok: true, user: { id: user.id, username: user.username } }), await this.session(user.id));
  }

  async session(userId) {
    const token = b64(randomBytes(32));
    this.state.storage.sql.exec('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', await sha256(token), userId, Date.now() + 2592000000);
    return token;
  }

  async auth(request) {
    const token = cookie(request, COOKIE);
    if (!token) return null;
    return this.state.storage.sql.exec('SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?', await sha256(token), Date.now()).one() || null;
  }

  async logout(request) {
    const token = cookie(request, COOKIE);
    if (token) this.state.storage.sql.exec('DELETE FROM sessions WHERE token_hash=?', await sha256(token));
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type':'application/json', 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
  }

  async rooms(request) {
    const user = await this.auth(request);
    if (!user) return json({ error: 'ابتدا وارد حساب شو.' }, 401);
    const messages = this.state.storage.sql.exec('SELECT id,username,body,created_at FROM messages WHERE room=? ORDER BY id DESC LIMIT 100', ROOM).toArray().reverse();
    return json({ rooms: [{ id: ROOM, name: 'دورهمی عمومی', online: this.sockets.size }], messages });
  }

  async websocket(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket required' }, 426);
    const user = await this.auth(request);
    if (!user) return json({ error: 'ابتدا وارد حساب شو.' }, 401);
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();
    const id = crypto.randomUUID();
    this.sockets.set(id, { ws: server, user });
    const remove = () => { this.sockets.delete(id); this.presence(); };
    server.addEventListener('close', remove);
    server.addEventListener('error', remove);
    server.addEventListener('message', async event => {
      try {
        const m = JSON.parse(String(event.data));
        if (m.type === 'history') return this.history(server);
        if (m.type === 'message') return this.sendMessage(user, m.body);
        if (m.type === 'ping') server.send(JSON.stringify({ type:'pong' }));
      } catch (e) { console.error('WS', e); }
    });
    server.send(JSON.stringify({ type:'ready', user }));
    this.presence();
    return new Response(null, { status: 101, webSocket: client });
  }

  history(ws) {
    const messages = this.state.storage.sql.exec('SELECT id,username,body,created_at FROM messages WHERE room=? ORDER BY id DESC LIMIT 100', ROOM).toArray().reverse();
    ws.send(JSON.stringify({ type:'history', messages }));
  }

  sendMessage(user, raw) {
    const body = String(raw || '').trim();
    if (!body || body.length > 2000) return;
    const now = Date.now();
    this.state.storage.sql.exec('INSERT INTO messages(room,user_id,username,body,created_at) VALUES(?,?,?,?,?)', ROOM, user.id, user.username, body, now);
    const message = this.state.storage.sql.exec('SELECT id,username,body,created_at FROM messages ORDER BY id DESC LIMIT 1').one();
    this.broadcast({ type:'message', message });
  }

  broadcast(data) {
    const text = JSON.stringify(data);
    for (const [id, c] of this.sockets) { try { c.ws.send(text); } catch { this.sockets.delete(id); } }
  }

  presence() {
    this.broadcast({ type:'presence', count:this.sockets.size, users:[...this.sockets.values()].map(x=>x.user) });
  }
}

// Preserve the legacy export required by the existing Cloudflare Durable Object namespace.
export class ChatRoom extends Dorhami {}

function cleanName(v){return String(v||'').trim().normalize('NFKC');}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
async function readJson(r){try{return await r.json();}catch{return {};}}
function randomBytes(n){const a=new Uint8Array(n);crypto.getRandomValues(a);return a;}
function b64(a){let s='';for(const x of a)s+=String.fromCharCode(x);return btoa(s);}
function fromB64(s){const r=atob(s);return Uint8Array.from(r,c=>c.charCodeAt(0));}
async function sha256(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function derive(password,salt){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:120000,hash:'SHA-256'},k,256);return b64(new Uint8Array(bits));}
function safeEqual(a,b){const x=String(a),y=String(b);if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x.charCodeAt(i)^y.charCodeAt(i);return d===0;}
function cookie(r,name){const h=r.headers.get('Cookie')||'';const m=h.match(new RegExp('(?:^|;\\s*)'+name+'=([^;]+)'));return m?decodeURIComponent(m[1]):null;}
function withCookie(response,token){const h=new Headers(response.headers);h.set('Set-Cookie',`${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`);return new Response(response.body,{status:response.status,headers:h});}
