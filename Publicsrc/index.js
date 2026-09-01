import { DurableObject } from "cloudflare:workers";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });

const clean = (value, max = 2000) =>
  String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);

const id = () => crypto.randomUUID();

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(hash)]
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

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

      INSERT OR IGNORE INTO rooms
      (id, name, description, created_at)
      VALUES
      ('global', 'دورهمی', 'اتاق عمومی چت دورهمی', strftime('%s','now') * 1000);
    `);
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/register" && request.method === "POST") {
      const data = await request.json();

      const username = clean(data.username, 24).toLowerCase();
      const passwordHash = clean(data.passwordHash, 128);

      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        return json({
          ok: false,
          error: "نام کاربری باید ۳ تا ۲۴ کاراکتر انگلیسی، عدد یا _ باشد."
        }, 400);
      }

      if (!passwordHash) {
        return json({
          ok: false,
          error: "رمز عبور وارد نشده است."
        }, 400);
      }

      const exists = this.ctx.storage.sql
        .exec(
          "SELECT id FROM users WHERE username = ? LIMIT 1",
          username
        )
        .toArray();

      if (exists.length) {
        return json({
          ok: false,
          error: "این نام کاربری قبلاً ثبت شده است."
        }, 409);
      }

      const userId = id();

      this.ctx.storage.sql.exec(
        `INSERT INTO users
        (id, username, password_hash, created_at)
        VALUES (?, ?, ?, ?)`,
        userId,
        username,
        passwordHash,
        Date.now()
      );

      return json({
        ok: true,
        user: {
          id: userId,
          username
        }
      });
    }

    if (url.pathname === "/login" && request.method === "POST") {
      const data = await request.json();

      const username = clean(data.username, 24).toLowerCase();
      const passwordHash = clean(data.passwordHash, 128);

      const result = this.ctx.storage.sql
        .exec(
          `SELECT id, username
           FROM users
           WHERE username = ?
           AND password_hash = ?
           LIMIT 1`,
          username,
          passwordHash
        )
        .toArray();

      if (!result.length) {
        return json({
          ok: false,
          error: "نام کاربری یا رمز عبور اشتباه است."
        }, 401);
      }

      return json({
        ok: true,
        user: result[0]
      });
    }

    if (url.pathname === "/users") {
      const q = clean(
        url.searchParams.get("q"),
        24
      ).toLowerCase();

      const users = this.ctx.storage.sql
        .exec(
          `SELECT id, username, created_at
           FROM users
           WHERE username LIKE ?
           ORDER BY username
           LIMIT 50`,
          `%${q}%`
        )
        .toArray();

      return json({ users });
    }

    if (url.pathname === "/rooms") {
      const rooms = this.ctx.storage.sql
        .exec(
          `SELECT id, name, description, created_at
           FROM rooms
           ORDER BY created_at`
        )
        .toArray();

      return json({ rooms });
    }

    if (url.pathname === "/room-messages") {
      const messages = this.ctx.storage.sql
        .exec(
          `SELECT
             id,
             sender_id,
             room_id,
             body,
             created_at
           FROM messages
           WHERE room_id = 'global'
           ORDER BY created_at DESC
           LIMIT 100`
        )
        .toArray()
        .reverse();

      return json({ messages });
    }

    if (url.pathname === "/private-messages") {
      const userId = clean(
        url.searchParams.get("userId"),
        100
      );

      const otherId = clean(
        url.searchParams.get("otherId"),
        100
      );

      const messages = this.ctx.storage.sql
        .exec(
          `SELECT
             id,
             sender_id,
             receiver_id,
             body,
             created_at
           FROM messages
           WHERE room_id IS NULL
           AND (
             (sender_id = ? AND receiver_id = ?)
             OR
             (sender_id = ? AND receiver_id = ?)
           )
           ORDER BY created_at
           LIMIT 100`,
          userId,
          otherId,
          otherId,
          userId
        )
        .toArray();

      return json({ messages });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket required", {
          status: 426
        });
      }

      const username =
        clean(
          url.searchParams.get("username"),
          24
        ) || "مهمان";

      const userId =
        clean(
          url.searchParams.get("userId"),
          100
        );

      const pair = new WebSocketPair();

      const client = pair[0];
      const server = pair[1];

      this.ctx.acceptWebSocket(server);

      server.serializeAttachment({
        username,
        userId
      });

      const messages = this.ctx.storage.sql
        .exec(
          `SELECT
             id,
             sender_id,
             receiver_id,
             room_id,
             body,
             created_at
           FROM messages
           WHERE room_id = 'global'
           ORDER BY created_at DESC
           LIMIT 100`
        )
        .toArray()
        .reverse();

      server.send(JSON.stringify({
        type: "history",
        messages
      }));

      this.broadcast({
        type: "presence",
        userId,
        username,
        online: true
      }, server);

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    return new Response("ChatRoom OK");
  }

  async webSocketMessage(ws, message) {
    let data;

    try {
      data =
        typeof message === "string"
          ? JSON.parse(message)
          : JSON.parse(
              new TextDecoder().
