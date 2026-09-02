import { DurableObject } from "cloudflare:workers";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" } });
const clean = (value, max = 2000) => String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
const normalizeUsername = value => String(value ?? "").normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/[\u00A0\u202F]/g, "").trim().toLowerCase();
const id = () => crypto.randomUUID();

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.ctx = ctx;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, avatar TEXT, vip INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, receiver_id TEXT, room_id TEXT, body TEXT, message_type TEXT NOT NULL DEFAULT 'text', media TEXT, created_at INTEGER NOT NULL);
      INSERT OR IGNORE INTO rooms (id,name,description,created_at) VALUES ('global','اتاق دورهمی','گفتگوی عمومی همه کاربران',strftime('%s','now') * 1000);
    `);
    try { this.ctx.storage.sql.exec("ALTER TABLE users ADD COLUMN avatar TEXT"); } catch {}
    try { this.ctx.storage.sql.exec("ALTER TABLE users ADD COLUMN vip INTEGER NOT NULL DEFAULT 0"); } catch {}
    try { this.ctx.storage.sql.exec("ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'"); } catch {}
    try { this.ctx.storage.sql.exec("ALTER TABLE messages ADD COLUMN media TEXT"); } catch {}
  }
  user(id) { return this.ctx.storage.sql.exec("SELECT id,username,created_at,avatar,vip FROM users WHERE id=? LIMIT 1", id).toArray()[0] || null; }
  msgSelect() { return "SELECT m.id,m.sender_id,m.receiver_id,m.room_id,m.body,m.message_type,m.media,m.created_at,u.username,u.avatar FROM messages m LEFT JOIN users u ON u.id=m.sender_id"; }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/register" && request.method === "POST") {
      let data; try { data = await request.json(); } catch { return json({ok:false,error:"اطلاعات ثبت‌نام نامعتبر است."},400); }
      const username=normalizeUsername(data.username), passwordHash=clean(data.passwordHash,128);
      if (!/^[\p{L}\p{N}_]{3,24}$/u.test(username)) return json({ok:false,error:"نام کاربری باید ۳ تا ۲۴ کاراکتر باشد و فاصله نداشته باشد."},400);
      if (!/^[a-f0-9]{64}$/i.test(passwordHash)) return json({ok:false,error:"رمز عبور معتبر نیست."},400);
      if (this.ctx.storage.sql.exec("SELECT id FROM users WHERE username=? LIMIT 1",username).toArray().length) return json({ok:false,error:"این نام کاربری قبلاً ثبت شده است."},409);
      const userId=id(); this.ctx.storage.sql.exec("INSERT INTO users (id,username,password_hash,created_at,avatar,vip) VALUES (?,?,?,?,?,0)",userId,username,passwordHash,Date.now(),null);
      return json({ok:true,user:this.user(userId)},201);
    }
    if (url.pathname === "/login" && request.method === "POST") {
      let data; try { data=await request.json(); } catch { return json({ok:false,error:"اطلاعات ورود نامعتبر است."},400); }
      const username=normalizeUsername(data.username), passwordHash=clean(data.passwordHash,128);
      const result=this.ctx.storage.sql.exec("SELECT id,username,created_at,avatar,vip FROM users WHERE username=? AND password_hash=? LIMIT 1",username,passwordHash).toArray();
      if (!result.length) return json({ok:false,error:"نام کاربری یا رمز عبور اشتباه است."},401); return json({ok:true,user:result[0]});
    }
    if (url.pathname === "/profile" && request.method === "GET") { const u=this.user(clean(url.searchParams.get("userId"),100)); if(!u)return json({ok:false,error:"کاربر پیدا نشد."},404); return json({ok:true,user:u}); }
    if (url.pathname === "/avatar" && request.method === "POST") {
      let data; try{data=await request.json()}catch{return json({ok:false,error:"اطلاعات تصویر نامعتبر است."},400)}
      const userId=clean(data.userId,100), avatar=String(data.avatar||''); if(!this.user(userId))return json({ok:false,error:"کاربر معتبر نیست."},401);
      if(avatar && (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(avatar) || avatar.length>700000)) return json({ok:false,error:"تصویر باید JPG، PNG یا WEBP و حداکثر حدود 500KB باشد."},400);
      this.ctx.storage.sql.exec("UPDATE users SET avatar=? WHERE id=?",avatar||null,userId); return json({ok:true,user:this.user(userId)});
    }
    if (url.pathname === "/users") { const q=normalizeUsername(url.searchParams.get("q")); return json({users:this.ctx.storage.sql.exec("SELECT id,username,created_at,avatar,vip FROM users WHERE username LIKE ? ORDER BY username LIMIT 50",`%${q}%`).toArray()}); }
    if (url.pathname === "/rooms") return json({rooms:this.ctx.storage.sql.exec("SELECT id,name,description,created_at FROM rooms ORDER BY created_at DESC").toArray()});
    if (url.pathname === "/create-room" && request.method === "POST") {
      let data; try { data=await request.json(); } catch { return json({ok:false,error:"اطلاعات اتاق نامعتبر است."},400); }
      const name=clean(data.name,40), description=clean(data.description,120), creatorId=clean(data.creatorId,100);
      if (!creatorId || !this.user(creatorId)) return json({ok:false,error:"کاربر معتبر نیست."},401);
      if (name.length<2) return json({ok:false,error:"نام اتاق کوتاه است."},400);
      if (this.ctx.storage.sql.exec("SELECT id FROM rooms WHERE name=?",name).toArray().length) return json({ok:false,error:"این نام اتاق قبلاً استفاده شده است."},409);
      const room={id:id(),name,description:description||"اتاق جدید دورهمی",created_at:Date.now()};
      this.ctx.storage.sql.exec("INSERT INTO rooms (id,name,description,created_at) VALUES (?,?,?,?)",room.id,room.name,room.description,room.created_at); return json({ok:true,room},201);
    }
    if (url.pathname === "/room-messages") { const roomId=clean(url.searchParams.get("roomId"),100)||"global"; return json({messages:this.ctx.storage.sql.exec(`${this.msgSelect()} WHERE m.room_id=? ORDER BY m.created_at DESC LIMIT 100`,roomId).toArray().reverse()}); }
    if (url.pathname === "/private-messages") { const userId=clean(url.searchParams.get("userId"),100), otherId=clean(url.searchParams.get("otherId"),100); return json({messages:this.ctx.storage.sql.exec(`${this.msgSelect()} WHERE m.room_id IS NULL AND ((m.sender_id=? AND m.receiver_id=?) OR (m.sender_id=? AND m.receiver_id=?)) ORDER BY m.created_at LIMIT 100`,userId,otherId,otherId,userId).toArray()}); }
    if (url.pathname === "/recent-chats") {
      const userId=clean(url.searchParams.get("userId"),100); const rows=this.ctx.storage.sql.exec(`SELECT x.other_id,u.username,u.avatar,u.vip,x.body,x.message_type,x.created_at FROM (SELECT CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END other_id,body,message_type,created_at,ROW_NUMBER() OVER (PARTITION BY CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END ORDER BY created_at DESC) rn FROM messages WHERE room_id IS NULL AND (sender_id=? OR receiver_id=?)) x LEFT JOIN users u ON u.id=x.other_id WHERE x.rn=1 ORDER BY x.created_at DESC LIMIT 30`,userId,userId,userId,userId).toArray(); return json({chats:rows});
    }
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket required",{status:426});
      const username=normalizeUsername(url.searchParams.get("username"))||"مهمان", userId=clean(url.searchParams.get("userId"),100), roomId=clean(url.searchParams.get("roomId"),100)||"global";
      const u=this.user(userId); if(!u || u.username!==username) return json({ok:false,error:"نشست کاربر معتبر نیست."},401);
      const pair=new WebSocketPair(), client=pair[0], server=pair[1]; this.ctx.acceptWebSocket(server); server.serializeAttachment({username,userId,roomId,vip:!!u.vip,avatar:u.avatar||null});
      const messages=this.ctx.storage.sql.exec(`${this.msgSelect()} WHERE m.room_id=? ORDER BY m.created_at DESC LIMIT 100`,roomId).toArray().reverse(); server.send(JSON.stringify({type:"history",roomId,messages})); this.broadcastPresence(userId,username,true,server); return new Response(null,{status:101,webSocket:client});
    }
    return new Response("ChatRoom OK");
  }
  async webSocketMessage(ws,message){
    let data; try{data=typeof message==="string"?JSON.parse(message):JSON.parse(new TextDecoder().decode(message));}catch{ws.send(JSON.stringify({type:"error",message:"پیام نامعتبر است."}));return;}
    const a=ws.deserializeAttachment()||{},userId=clean(a.userId,100),username=normalizeUsername(a.username)||"مهمان",roomId=clean(a.roomId,100)||"global";
    if(data.type==="voice_message"){
      if(!a.vip){ws.send(JSON.stringify({type:"error",message:"ارسال ویس فقط برای اعضای VIP فعال است ⭐"}));return;}
      const media=String(data.media||''); if(!/^data:audio\/(webm|mp4|mpeg|ogg|wav);base64,/i.test(media)||media.length>700000){ws.send(JSON.stringify({type:"error",message:"فایل صوتی نامعتبر یا بزرگ است. حداکثر حدود 500KB."}));return;}
      const receiverId=clean(data.receiverId,100), targetRoom=clean(data.roomId,100)||roomId, isPrivate=!!receiverId;
      const m={id:id(),sender_id:userId,receiver_id:isPrivate?receiverId:null,room_id:isPrivate?null:targetRoom,body:'🎙️ پیام صوتی',message_type:'voice',media,created_at:Date.now(),username,avatar:a.avatar||null};
      this.ctx.storage.sql.exec("INSERT INTO messages (id,sender_id,receiver_id,room_id,body,message_type,media,created_at) VALUES (?,?,?,?,?,?,?,?)",m.id,m.sender_id,m.receiver_id,m.room_id,m.body,m.message_type,m.media,m.created_at);
      const payload=JSON.stringify({type:'private_message',message:m}); if(isPrivate){for(const s of this.ctx.getWebSockets()){const sa=s.deserializeAttachment()||{};if(String(sa.userId)===String(userId)||String(sa.userId)===String(receiverId)){try{s.send(payload)}catch{}}}} else this.broadcastToRoom({type:'room_message',message:m},targetRoom); return;
    }
    const body=clean(data.body,2000); if(!body)return;
    if(data.type==="room_message"){const targetRoom=clean(data.roomId,100)||roomId;if(targetRoom!==roomId){ws.send(JSON.stringify({type:"error",message:"اتاق نامعتبر است."}));return;}const m={id:id(),sender_id:userId,receiver_id:null,room_id:targetRoom,body,message_type:'text',media:null,created_at:Date.now(),username,avatar:a.avatar||null};this.ctx.storage.sql.exec("INSERT INTO messages (id,sender_id,receiver_id,room_id,body,message_type,media,created_at) VALUES (?,?,?,?,?,?,?,?)",m.id,userId,null,targetRoom,body,m.message_type,null,m.created_at);this.broadcastToRoom({type:"room_message",message:m},targetRoom);return;}
    if(data.type==="private_message"){const receiverId=clean(data.receiverId,100);if(!receiverId||receiverId===userId){ws.send(JSON.stringify({type:"error",message:"گیرنده پیام معتبر نیست."}));return;}const m={id:id(),sender_id:userId,receiver_id:receiverId,room_id:null,body,message_type:'text',media:null,created_at:Date.now(),username,avatar:a.avatar||null};this.ctx.storage.sql.exec("INSERT INTO messages (id,sender_id,receiver_id,room_id,body,message_type,media,created_at) VALUES (?,?,?,?,?,?,?,?)",m.id,userId,receiverId,null,body,m.message_type,null,m.created_at);const payload=JSON.stringify({type:"private_message",message:m});for(const socket of this.ctx.getWebSockets()){const sa=socket.deserializeAttachment()||{};if(String(sa.userId)===String(userId)||String(sa.userId)===String(receiverId)){try{socket.send(payload)}catch{}}}}
  }
  async webSocketClose(ws){const a=ws.deserializeAttachment()||{};this.broadcastPresence(a.userId,a.username,false,ws);}
  broadcastToRoom(data,roomId){const text=JSON.stringify(data);for(const socket of this.ctx.getWebSockets()){const a=socket.deserializeAttachment()||{};if(a.roomId===roomId){try{socket.send(text)}catch{}}}}
  broadcastPresence(userId,username,online,exclude){const text=JSON.stringify({type:"presence",userId,username,online});for(const socket of this.ctx.getWebSockets()){if(socket===exclude)continue;try{socket.send(text)}catch{}}}
}