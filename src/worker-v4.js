import { DurableObject } from 'cloudflare:workers';

const COOKIE = 'dorhami_session';
const ROOM = 'general';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_MESSAGE = 2000;
const PBKDF2_ITERATIONS = 100000;
const REACTION_EMOJIS = ['❤️','😂','👍','😍','😢','😡','🎉'];

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
    super(ctx, env); this.ctx = ctx; this.env = env;
    ctx.blockConcurrencyWhile(async () => {
      this.ensureSchema();
      if (typeof ctx.setWebSocketAutoResponse === 'function') ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
    });
  }
  ensureSchema() {
    const sql=this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL)`);
    sql.exec('CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id)');
    sql.exec(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, user_id INTEGER NOT NULL, username TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    sql.exec('CREATE INDEX IF NOT EXISTS messages_room_id ON messages(room,id)');
    sql.exec(`CREATE TABLE IF NOT EXISTS reactions (message_id INTEGER NOT NULL, user_id INTEGER NOT NULL, emoji TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(message_id,user_id,emoji))`);
    sql.exec('CREATE INDEX IF NOT EXISTS reactions_message_id ON reactions(message_id)');
  }
  async fetch(request) {
    const url=new URL(request.url);
    try {
      if(url.pathname==='/api/health') return this.health();
      if(url.pathname==='/api/diagnostic') return this.diagnostic();
      if(url.pathname==='/api/register') return request.method==='POST'?this.register(request):methodNotAllowed();
      if(url.pathname==='/api/login') return request.method==='POST'?this.login(request):methodNotAllowed();
      if(url.pathname==='/api/logout') return request.method==='POST'?this.logout(request):methodNotAllowed();
      if(url.pathname==='/api/me') return this.me(request);
      if(url.pathname==='/api/rooms') return this.rooms(request);
      if(url.pathname==='/ws') return this.websocket(request);
      return json({error:'Not found',code:'NOT_FOUND'},404);
    } catch(error){ const requestId=crypto.randomUUID(); console.error('DORHAMI_ERROR',requestId,error?.stack||error); return json({error:'خطای داخلی سرور',code:'SERVER_ERROR',requestId},500); }
  }
  health(){try{this.ctx.storage.sql.exec('SELECT 1').toArray();return json({ok:true,version:'4.1',storage:'sqlite',websocket:'hibernation',pbkdf2Iterations:PBKDF2_ITERATIONS});}catch(error){console.error('DORHAMI_HEALTH',error?.stack||error);return json({ok:false,code:'STORAGE_UNAVAILABLE'},500);}}
  diagnostic(){try{const tables=this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").toArray().map(x=>x.name);return json({ok:true,version:'4.1',tables,counts:{users:this.countRows('users'),sessions:this.countRows('sessions'),messages:this.countRows('messages'),reactions:this.countRows('reactions')}});}catch(error){console.error('DORHAMI_DIAGNOSTIC',error?.stack||error);return json({ok:false,code:'DIAGNOSTIC_FAILED'},500);}}
  countRows(table){if(!['users','sessions','messages','reactions'].includes(table))throw new Error('INVALID_TABLE');return this.ctx.storage.sql.exec(`SELECT COUNT(*) AS count FROM ${table}`).toArray()[0]?.count??0;}
  async register(request){const data=await readJson(request),username=cleanName(data.username),password=String(data.password??'');if(!/^[\p{L}\p{N}_-]{3,24}$/u.test(username))return json({error:'نام کاربری باید ۳ تا ۲۴ کاراکتر باشد.',code:'INVALID_USERNAME'},400);if(password.length<6)return json({error:'رمز عبور باید حداقل ۶ کاراکتر باشد.',code:'INVALID_PASSWORD'},400);let salt,passwordHash;try{salt=crypto.getRandomValues(new Uint8Array(16));passwordHash=await hashPassword(password,salt);}catch(error){console.error('DORHAMI_REGISTER_HASH',error?.stack||error);return json({error:'خطا در آماده‌سازی حساب.',code:'REGISTER_HASH_FAILED'},500);}try{this.ctx.storage.sql.exec('INSERT INTO users(username,password_hash,salt,created_at) VALUES(?,?,?,?)',username,passwordHash,b64(salt),Date.now());}catch(error){const existing=this.ctx.storage.sql.exec('SELECT id FROM users WHERE username=? LIMIT 1',username).toArray()[0];if(existing)return json({error:'این نام کاربری قبلاً ثبت شده است.',code:'USERNAME_TAKEN'},409);console.error('DORHAMI_REGISTER_INSERT',error?.stack||error);return json({error:'ثبت حساب انجام نشد.',code:'REGISTER_DB_INSERT_FAILED'},500);}const user=this.ctx.storage.sql.exec('SELECT id,username FROM users WHERE username=? LIMIT 1',username).toArray()[0];if(!user)return json({error:'حساب ساخته نشد.',code:'REGISTER_VERIFY_FAILED'},500);try{const token=await this.createSession(user.id);return withCookie(json({ok:true,user}),token);}catch(error){console.error('DORHAMI_REGISTER_SESSION',error?.stack||error);return json({error:'حساب ساخته شد اما ورود خودکار انجام نشد.',code:'REGISTER_SESSION_FAILED'},500);}}
  async login(request){const data=await readJson(request),username=cleanName(data.username),password=String(data.password??'');if(!username||!password)return json({error:'نام کاربری و رمز عبور را وارد کن.',code:'MISSING_CREDENTIALS'},400);const user=this.ctx.storage.sql.exec('SELECT id,username,password_hash,salt FROM users WHERE username=? LIMIT 1',username).toArray()[0];if(!user)return json({error:'نام کاربری یا رمز عبور اشتباه است.',code:'INVALID_CREDENTIALS'},401);try{const computed=await hashPassword(password,fromB64(user.salt));if(!safeEqual(user.password_hash,computed))return json({error:'نام کاربری یا رمز عبور اشتباه است.',code:'INVALID_CREDENTIALS'},401);}catch(error){console.error('DORHAMI_LOGIN_HASH',error?.stack||error);return json({error:'خطا در بررسی رمز عبور.',code:'LOGIN_HASH_FAILED'},500);}try{return withCookie(json({ok:true,user:{id:user.id,username:user.username}}),await this.createSession(user.id));}catch(error){console.error('DORHAMI_LOGIN_SESSION',error?.stack||error);return json({error:'ورود انجام نشد.',code:'LOGIN_SESSION_FAILED'},500);}}
  async createSession(userId){const tokenBytes=crypto.getRandomValues(new Uint8Array(32)),token=b64(tokenBytes),tokenHash=await sha256(token);this.ctx.storage.sql.exec('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',tokenHash,userId,Date.now()+SESSION_MS);return token;}
  async auth(request){const token=getCookie(request,COOKIE);if(!token)return null;const row=this.ctx.storage.sql.exec(`SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? LIMIT 1`,await sha256(token),Date.now()).toArray()[0];return row||null;}
  async me(request){try{const user=await this.auth(request);return json({authenticated:Boolean(user),user});}catch(error){console.error('DORHAMI_ME',error?.stack||error);return json({error:'خطا در بررسی نشست.',code:'SESSION_CHECK_FAILED'},500);}}
  async logout(request){const token=getCookie(request,COOKIE);if(token)this.ctx.storage.sql.exec('DELETE FROM sessions WHERE token_hash=?',await sha256(token));const response=json({ok:true}),headers=new Headers(response.headers);headers.set('Set-Cookie',clearCookie());return new Response(response.body,{status:response.status,headers});}
  async rooms(request){const user=await this.auth(request);if(!user)return json({error:'ابتدا وارد حساب شو.',code:'AUTH_REQUIRED'},401);return json({rooms:[{id:ROOM,name:'دورهمی عمومی',online:this.connectedUsers().length}],messages:this.readHistory()});}
  async websocket(request){if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'WebSocket required',code:'WEBSOCKET_REQUIRED'},426);const user=await this.auth(request);if(!user)return json({error:'ابتدا وارد حساب شو.',code:'AUTH_REQUIRED'},401);const pair=new WebSocketPair(),client=pair[0],server=pair[1];this.ctx.acceptWebSocket(server);server.serializeAttachment({userId:user.id,username:user.username,room:ROOM});server.send(JSON.stringify({type:'ready',user,room:ROOM,messages:this.readHistory()}));this.broadcastPresence();return new Response(null,{status:101,webSocket:client});}
  async webSocketMessage(ws,message){try{const connection=ws.deserializeAttachment()||{},user=this.userFromConnection(connection);if(!user)return ws.close(1008,'Unauthorized');const data=typeof message==='string'?safeJsonParse(message):null;if(!data)return;if(data.type==='history')return ws.send(JSON.stringify({type:'history',messages:this.readHistory()}));if(data.type==='open_private')return this.openPrivate(ws,user,Number(data.targetId));if(data.type==='private_history')return this.sendPrivateHistory(ws,user,Number(data.targetId));if(data.type==='typing')return this.sendTyping(user,Number(data.targetId),Boolean(data.typing));if(data.type==='message')return this.sendMessage(user,data.body);if(data.type==='private_message')return this.sendPrivateMessage(user,Number(data.targetId),data.body);if(data.type==='reaction')return this.toggleReaction(ws,user,Number(data.messageId),String(data.emoji||''));if(data.type==='ping')ws.send(JSON.stringify({type:'pong'}));}catch(error){console.error('DORHAMI_WS_MESSAGE',error?.stack||error);}}
  webSocketClose(ws,code,reason){try{ws.close(code,reason);}catch{}this.broadcastPresence();}
  webSocketError(ws,error){console.error('DORHAMI_WS_ERROR',error?.stack||error);this.broadcastPresence();}
  userFromConnection(connection){if(!connection?.userId||!connection?.username)return null;return{id:connection.userId,username:connection.username};}
  readHistory(){return this.addReactions(this.ctx.storage.sql.exec(`SELECT id,user_id,username,body,created_at FROM messages WHERE room=? ORDER BY id DESC LIMIT 100`,ROOM).toArray().reverse());}
  privateRoom(a,b){const x=Number(a),y=Number(b);return x<y?`private:${x}:${y}`:`private:${y}:${x}`;}
  privateHistory(a,b){const room=this.privateRoom(a,b);return this.addReactions(this.ctx.storage.sql.exec(`SELECT id,user_id,username,body,created_at FROM messages WHERE room=? ORDER BY id DESC LIMIT 100`,room).toArray().reverse());}
  addReactions(messages){return messages.map(m=>({...m,reactions:this.getReactions(m.id)}));}
  getReactions(messageId){return this.ctx.storage.sql.exec(`SELECT emoji,COUNT(*) AS count FROM reactions WHERE message_id=? GROUP BY emoji ORDER BY emoji`,messageId).toArray().map(r=>({emoji:r.emoji,count:Number(r.count)||0}));}
  findOpenSocket(userId){for(const ws of this.ctx.getWebSockets()){try{const c=ws.deserializeAttachment()||{};if(Number(c.userId)===Number(userId))return ws;}catch{}}return null;}
  async openPrivate(ws,user,targetId){if(!Number.isInteger(targetId)||targetId<=0||targetId===Number(user.id))return ws.send(JSON.stringify({type:'private_error',error:'کاربر نامعتبر است.'}));const target=this.ctx.storage.sql.exec('SELECT id,username FROM users WHERE id=? LIMIT 1',targetId).toArray()[0];if(!target)return ws.send(JSON.stringify({type:'private_error',error:'این کاربر پیدا نشد.'}));ws.serializeAttachment({userId:user.id,username:user.username,room:this.privateRoom(user.id,target.id)});ws.send(JSON.stringify({type:'private_opened',user:target,messages:this.privateHistory(user.id,target.id)}));}
  async sendPrivateHistory(ws,user,targetId){if(!Number.isInteger(targetId)||targetId<=0||targetId===Number(user.id))return;const target=this.ctx.storage.sql.exec('SELECT id,username FROM users WHERE id=? LIMIT 1',targetId).toArray()[0];if(!target)return;ws.send(JSON.stringify({type:'private_history',user:target,messages:this.privateHistory(user.id,target.id)}));}
  async sendTyping(user,targetId,typing){if(!Number.isInteger(targetId)||targetId<=0||targetId===Number(user.id))return;const target=this.ctx.storage.sql.exec('SELECT id,username FROM users WHERE id=? LIMIT 1',targetId).toArray()[0];if(!target)return;const targetWs=this.findOpenSocket(target.id);try{if(targetWs&&targetWs.readyState===WebSocket.OPEN)targetWs.send(JSON.stringify({type:'typing',user:{id:user.id,username:user.username},typing:Boolean(typing)}));}catch(error){console.error('DORHAMI_TYPING_BROADCAST',error);}}
  async sendMessage(user,rawBody){const body=String(rawBody??'').trim();if(!body||body.length>MAX_MESSAGE)return;const now=Date.now();this.ctx.storage.sql.exec('INSERT INTO messages(room,user_id,username,body,created_at) VALUES(?,?,?,?,?)',ROOM,user.id,user.username,body,now);const message=this.ctx.storage.sql.exec(`SELECT id,user_id,username,body,created_at FROM messages WHERE room=? ORDER BY id DESC LIMIT 1`,ROOM).toArray()[0];if(message)this.broadcast({type:'message',message:{...message,reactions:[]}});}
  async sendPrivateMessage(user,targetId,rawBody){const body=String(rawBody??'').trim();if(!Number.isInteger(targetId)||targetId<=0||targetId===Number(user.id)||!body||body.length>MAX_MESSAGE)return;const target=this.ctx.storage.sql.exec('SELECT id,username FROM users WHERE id=? LIMIT 1',targetId).toArray()[0];if(!target)return;const room=this.privateRoom(user.id,target.id),now=Date.now();this.ctx.storage.sql.exec('INSERT INTO messages(room,user_id,username,body,created_at) VALUES(?,?,?,?,?)',room,user.id,user.username,body,now);const message=this.ctx.storage.sql.exec(`SELECT id,user_id,username,body,created_at FROM messages WHERE room=? ORDER BY id DESC LIMIT 1`,room).toArray()[0];if(!message)return;const payload={type:'private_message',message:{...message,reactions:[]},from:{id:user.id,username:user.username},to:{id:target.id,username:target.username}};const senderWs=this.findOpenSocket(user.id),targetWs=this.findOpenSocket(target.id);for(const ws of [senderWs,targetWs]){try{if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(payload));}catch(error){console.error('DORHAMI_PRIVATE_BROADCAST',error);}}}
  async toggleReaction(ws,user,messageId,emoji){if(!Number.isInteger(messageId)||messageId<=0||!REACTION_EMOJIS.includes(emoji))return;const connection=ws.deserializeAttachment()||{},room=String(connection.room||'');if(!room)return;const message=this.ctx.storage.sql.exec('SELECT id FROM messages WHERE id=? AND room=? LIMIT 1',messageId,room).toArray()[0];if(!message)return;const existing=this.ctx.storage.sql.exec('SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND emoji=? LIMIT 1',messageId,user.id,emoji).toArray()[0];if(existing)this.ctx.storage.sql.exec('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?',messageId,user.id,emoji);else this.ctx.storage.sql.exec('INSERT INTO reactions(message_id,user_id,emoji,created_at) VALUES(?,?,?,?)',messageId,user.id,emoji,Date.now());const payload={type:'reaction_update',messageId,reactions:this.getReactions(messageId)};if(room===ROOM)this.broadcast(payload);else{const ids=room.split(':').slice(1).map(Number);for(const id of ids){const targetWs=this.findOpenSocket(id);try{if(targetWs&&targetWs.readyState===WebSocket.OPEN)targetWs.send(JSON.stringify(payload));}catch(error){console.error('DORHAMI_REACTION_BROADCAST',error);}}}}
  broadcast(data){const text=JSON.stringify(data);for(const ws of this.ctx.getWebSockets()){try{if(ws.readyState===WebSocket.OPEN)ws.send(text);}catch(error){console.error('DORHAMI_BROADCAST',error);}}}
  connectedUsers(){const users=[];for(const ws of this.ctx.getWebSockets()){try{const user=this.userFromConnection(ws.deserializeAttachment());if(user)users.push(user);}catch{}}return users;}
  broadcastPresence(){const users=this.connectedUsers();this.broadcast({type:'presence',count:users.length,users});}
}
export class ChatRoom extends Dorhami {}
const encoder=new TextEncoder();
async function hashPassword(password,salt){const keyMaterial=await crypto.subtle.importKey('raw',encoder.encode(password),{name:'PBKDF2'},false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:PBKDF2_ITERATIONS,hash:'SHA-256'},keyMaterial,256);return b64(new Uint8Array(bits));}
async function sha256(value){const digest=await crypto.subtle.digest('SHA-256',encoder.encode(value));return[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function safeEqual(a,b){a=String(a);b=String(b);if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function cleanName(value){return String(value??'').trim().normalize('NFKC');}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});}
function methodNotAllowed(){return json({error:'Method not allowed',code:'METHOD_NOT_ALLOWED'},405);}
async function readJson(request){try{const data=await request.json();return data&&typeof data==='object'?data:{};}catch{return{};}}
function safeJsonParse(value){try{const data=JSON.parse(value);return data&&typeof data==='object'?data:null;}catch{return null;}}
function b64(bytes){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);}
function fromB64(value){const binary=atob(value);return Uint8Array.from(binary,c=>c.charCodeAt(0));}
function getCookie(request,name){const header=request.headers.get('Cookie')||'';for(const part of header.split(';')){const i=part.indexOf('=');if(i<0)continue;if(part.slice(0,i).trim()===name)return decodeURIComponent(part.slice(i+1).trim());}return null;}
function withCookie(response,token){const headers=new Headers(response.headers);headers.set('Set-Cookie',`${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MS/1000}`);return new Response(response.body,{status:response.status,headers});}
function clearCookie(){return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;}
