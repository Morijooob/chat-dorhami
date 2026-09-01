import { DurableObject } from "cloudflare:workers";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store"
    }
  });
}

function clean(value, max = 2000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);
}

function id() {
  return crypto.randomUUID();
}

async function hashPassword(password) {
  const bytes = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hash))
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

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  async fetch(request) {
    const url = new URL(request.url);

    // ثبت نام
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

      const existing = this.ctx.storage.sql
        .exec(
          `SELECT id FROM users WHERE username = ? LIMIT 1`,
          username
        )
        .toArray();

      if (existing.length) {
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

    // ورود
    if (url.pathname === "/login" && request.method === "POST") {
      const data = await request.json();

      const username = clean(data.username, 24).toLowerCase();
      const passwordHash = clean(data.passwordHash, 128);

      const users = this.ctx.storage.sql
        .exec(
          `SELECT id, username
           FROM users
           WHERE username = ? AND password_hash = ?
           LIMIT 1`,
          username,
          passwordHash
        )
        .toArray();

      if (!users.length) {
        return json({
          ok: false,
          error: "نام کاربری یا رمز عبور اشتباه است."
        }, 401);
      }

      return json({
        ok: true,
        user: users[0]
      });
    }

    // WebSocket
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket required", {
          status: 426
        });
      }

      const username =
        clean(url.searchParams.get("username"), 24) || "مهمان";

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      this.ctx.acceptWebSocket(server);

      server.serializeAttachment({
        username
      });

      const messages = this.ctx.storage.sql
        .exec(`
          SELECT id, username, body, created_at
          FROM messages
          ORDER BY created_at DESC
          LIMIT 100
        `)
        .toArray()
        .reverse();

      server.send(JSON.stringify({
        type: "history",
        messages
      }));

      this.broadcast({
        type: "presence",
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
          : JSON.parse(new TextDecoder().decode(message));
    } catch {
      ws.send(JSON.stringify({
        type: "error",
        message: "پیام نامعتبر است."
      }));
      return;
    }

    const attachment = ws.deserializeAttachment() || {};
    const username = clean(attachment.username, 24) || "مهمان";

    if (data.type === "message") {
      const body = clean(data.body, 2000);

      if (!body) return;

      const messageId = id();
      const createdAt = Date.now();

      this.ctx.storage.sql.exec(
        `INSERT INTO messages
        (id, username, body, created_at)
        VALUES (?, ?, ?, ?)`,
        messageId,
        username,
        body,
        createdAt
      );

      this.broadcast({
        type: "message",
        message: {
          id: messageId,
          username,
          body,
          created_at: createdAt
        }
      });

      return;
    }

    if (data.type === "ping") {
      ws.send(JSON.stringify({
        type: "pong",
        time: Date.now()
      }));
    }
  }

  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment() || {};
    const username = clean(attachment.username, 24);

    if (username) {
      this.broadcast({
        type: "presence",
        username,
        online: false
      }, ws);
    }
  }

  async webSocketError(ws) {
    try {
      ws.close();
    } catch {}
  }

  broadcast(data, except = null) {
    const text = JSON.stringify(data);

    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;

      try {
        ws.send(text);
      } catch {}
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // تست آنلاین بودن سرور
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        app: "Chat Dorhami",
        version: "3.0"
      });
    }

    // ثبت نام
    if (url.pathname === "/api/register" && request.method === "POST") {
      const data = await request.json();

      const username = clean(data.username, 24).toLowerCase();
      const password = String(data.password || "");

      if (password.length < 8) {
        return json({
          ok: false,
          error: "رمز عبور باید حداقل ۸ کاراکتر باشد."
        }, 400);
      }

      const passwordHash = await hashPassword(password);

      const room = env.CHAT_ROOM.get(
        env.CHAT_ROOM.idFromName("global")
      );

      return room.fetch(
        new Request("https://chat/register", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            username,
            passwordHash
          })
        })
      );
    }

    // ورود
    if (url.pathname === "/api/login" && request.method === "POST") {
      const data = await request.json();

      const username = clean(data.username, 24).toLowerCase();
      const password = String(data.password || "");

      const passwordHash = await hashPassword(password);

      const room = env.CHAT_ROOM.get(
        env.CHAT_ROOM.idFromName("global")
      );

      return room.fetch(
        new Request("https://chat/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            username,
            passwordHash
          })
        })
      );
    }

    // اتصال چت
    if (url.pathname === "/ws") {
      const room = env.CHAT_ROOM.get(
        env.CHAT_ROOM.idFromName("global")
      );

      return room.fetch(request);
    }

    // فایل‌های سایت
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Chat Dorhami is online.");
  }
};
