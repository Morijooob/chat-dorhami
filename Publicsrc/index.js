import { DurableObject } from "cloudflare:workers";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=UTF-8",
    "Cache-Control": "no-store"
  }
});

const clean = (value, max = 2000) => String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
const id = () => crypto.randomUUID();

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        receiver_id TEXT,
        room_id TEXT,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO rooms (id,name,description,created_at)
      VALUES ('global','دورهمی','اتاق عمومی چت دورهمی',strftime('%s','now') * 1000);
    `);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/register" && request.method === "POST") {
      let data;
      try { data = await request.json(); } catch { return json({ ok:false, error:"اطلاعات ثبت‌نام نامعتبر است." },400); }
      const username = clean(data.username, 24).toLowerCase();
      const passwordHash = clean(data.passwordHash, 128);
      if (!/^[\\p{L}\\p{N}_]{3,24}$/u.test(username)) {
        return json({ ok:false, error:"نام کاربری باید ۳ تا ۲۴ کاراکتر باشد و فاصله نداشته باشد." },400);
      }
      if (!/^[a-f0-9]{64}$/i.test(passwordHash)) {
        return json({ ok:false, error:"رمز عبور معتبر نیست. دوباره تلاش کن." },400);
      }
      const exists = this.ctx.storage.sql.exec("SELECT id FROM users WHERE username = ? LIMIT 1", username).toArray();
      if (exists.length) return json({ ok:false, error:"این نام کاربری قبلاً ثبت شده است." },409);
      const userId = id();
      this.ctx.storage.sql.exec("INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)", userId, username, passwordHash, Date.now());
      return json({ ok:true, user:{ id:userId, username } },201);
    }

    if (url.pathname === "/login" && request.method === "POST") {
      let data;
      try { data = await request.json(); } catch { return json({ ok:false, error:"اطلاعات ورود نامعتبر است." },400); }
      const username = clean(data.username,24).toLowerCase();
      const passwordHash = clean(data.passwordHash,128);
      const result = this.ctx.storage.sql.exec(`SELECT id,username FROM users WHERE username=? AND password_hash=? LIMIT 1`, username, passwordHash).toArray();
      if (!result.length) return json({ ok:false, error:"نام کاربری یا رمز عبور اشتباه است." },401);
      return json({ ok:true, user:result[0] });
    }

    if (url.pathname === "/users") {
      const q = clean(url.searchParams.get("q"),24).toLowerCase();
      const users = this.ctx.storage.sql.exec(`SELECT id,username,created_at FROM users WHERE username LIKE ? ORDER BY username LIMIT 50`, `%${q}%`).toArray();
      return json({ users });
    }

    if (url.pathname === "/rooms") {
      const rooms = this.ctx.storage.sql.exec(`SELECT id,name,description,created_at FROM rooms ORDER BY created_at`).toArray();
      return json({ rooms });
    }

    if (url.pathname === "/room-messages") {
      const roomId = clean(url.searchParams.get("roomId"),100) || "global";
      const messages = this.ctx.storage.sql.exec(`
        SELECT m.id,m.sender_id,m.receiver_id,m.room_id,m.body,m.created_at,u.username
        FROM messages m LEFT JOIN users u ON u.id=m.sender_id
        WHERE m.room_id=? ORDER BY m.created_at DESC LIMIT 100`, roomId).toArray().reverse();
      return json({ messages });
    }

    if (url.pathname === "/private-messages") {
      const userId = clean(url.searchParams.get("userId"),100);
      const otherId = clean(url.searchParams.get("otherId"),100);
      const messages = this.ctx.storage.sql.exec(`
        SELECT m.id,m.sender_id,m.receiver_id,m.room_id,m.body,m.created_at,u.username
        FROM messages m LEFT JOIN users u ON u.id=m.sender_id
        WHERE m.room_id IS NULL AND ((m.sender_id=? AND m.receiver_id=?) OR (m.sender_id=? AND m.receiver_id=?))
        ORDER BY m.created_at LIMIT 100`, userId,otherId,otherId,userId).toArray();
      return json({ messages });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket required",{status:426});
      const username = clean(url.searchParams.get("username"),24) || "مهمان";
      const userId = clean(url.searchParams.get("userId"),100);
      const roomId = clean(url.searchParams.get("roomId"),100) || "global";
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ username,userId,roomId });
      const messages = this.ctx.storage.sql.exec(`
        SELECT m.id,m.sender_id,m.receiver_id,m.room_id,m.body,m.created_at,u.username
        FROM messages m LEFT JOIN users u ON u.id=m.sender_id
        WHERE m.room_id=? ORDER BY m.created_at DESC LIMIT 100`, roomId).toArray().reverse();
      server.send(JSON.stringify({type:"history",roomId,messages}));
      this.broadcastPresence(userId,username,true,server);
      return new Response(null,{status:101,webSocket:client});
    }

    return new Response("ChatRoom OK");
  }

  async webSocketMessage(ws, message) {
    let data;
    try { data = typeof message === "string" ? JSON.parse(message) : JSON.parse(new TextDecoder().decode(message)); }
    catch { ws.send(JSON.stringify({type:"error",message:"پیام نامعتبر است."})); return; }

    const attachment = ws.deserializeAttachment() || {};
    const userId = clean(attachment.userId,100);
    const username = clean(attachment.username,24) || "مهمان";
    const roomId = clean(attachment.roomId,100) || "global";
    const body = clean(data.body,2000);
    if (!body) return;

    if (data.type === "room_message") {
      const targetRoom = clean(data.roomId,100) || roomId;
      if (targetRoom !== roomId) { ws.send(JSON.stringify({type:"error",message:"اتاق نامعتبر است."})); return; }
      const messageId = id();
      const createdAt = Date.now();
      this.ctx.storage.sql.exec(`INSERT INTO messages (id,sender_id,receiver_id,room_id,body,created_at) VALUES (?,?,?,?,?,?)`,messageId,userId,null,targetRoom,body,createdAt);
      this.broadcastToRoom({type:"room_message",message:{id:messageId,sender_id:userId,receiver_id:null,room_id:targetRoom,body,created_at:createdAt,username}},targetRoom);
      return;
    }

    if (data.type === "private_message") {
      const receiverId = clean(data.receiverId,100);
      if (!receiverId || receiverId === userId) { ws.send(JSON.stringify({type:"error",message:"گیرنده پیام معتبر نیست."})); return; }
      const messageId = id();
      const createdAt = Date.now();
      this.ctx.storage.sql.exec(`INSERT INTO messages (id,sender_id,receiver_id,room_id,body,created_at) VALUES (?,?,?,?,?,?)`,messageId,userId,receiverId,null,body,createdAt);
      const payload = {type:"private_message",message:{id:messageId,sender_id:userId,receiver_id:receiverId,room_id:null,body,created_at:createdAt,username}};
      for (const socket of this.ctx.getWebSockets()) {
        const a = socket.deserializeAttachment() || {};
        if (String(a.userId) === String(userId) || String(a.userId) === String(receiverId)) {
          try { socket.send(JSON.stringify(payload)); } catch {}
        }
      }
    }
  }

  async webSocketClose(ws) {
    const a = ws.deserializeAttachment() || {};
    this.broadcastPresence(a.userId,a.username,false,ws);
  }

  broadcastToRoom(data, roomId) {
    const text = JSON.stringify(data);
    for (const socket of this.ctx.getWebSockets()) {
      const a = socket.deserializeAttachment() || {};
      if (a.roomId === roomId) { try { socket.send(text); } catch {} }
    }
  }

  broadcastPresence(userId,username,online,exclude) {
    const text = JSON.stringify({type:"presence",userId,username,online});
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === exclude) continue;
      try { socket.send(text); } catch {}
    }
  }
}