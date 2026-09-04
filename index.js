import { DurableObject } from "cloudflare:workers";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.ready = this.init();
  }

  async init() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  async fetch(request) {
    try {
      await this.ready;
      const url = new URL(request.url);
      const body = await request.json().catch(() => null);

      if (url.pathname === "/health" && request.method === "GET") {
        const result = this.ctx.storage.sql.exec("SELECT 1 AS ok").one();
        return json({ ok: result.ok === 1, durableObject: true, sqlite: true });
      }

      if ((url.pathname === "/register" || url.pathname === "/login") && request.method === "POST") {
        if (!body) return json({ ok: false, error: "درخواست نامعتبر است" }, 400);

        const username = String(body.username || "").trim();
        const passwordHash = String(body.passwordHash || "");

        if (!/^[\p{L}\p{N}_]{3,24}$/u.test(username) || !/^[a-f0-9]{64}$/i.test(passwordHash)) {
          return json({ ok: false, error: "نام کاربری یا رمز عبور نامعتبر است" }, 400);
        }

        if (url.pathname === "/register") {
          const existing = this.ctx.storage.sql.exec(
            "SELECT id FROM users WHERE username = ?",
            username
          ).toArray();
          if (existing.length) return json({ ok: false, error: "این نام کاربری قبلاً ثبت شده است" }, 409);

          this.ctx.storage.sql.exec(
            "INSERT INTO users(username, password_hash) VALUES(?, ?)",
            username,
            passwordHash
          );

          const user = this.ctx.storage.sql.exec(
            "SELECT id, username FROM users WHERE username = ?",
            username
          ).toArray()[0];

          return json({ ok: true, user }, 201);
        }

        const users = this.ctx.storage.sql.exec(
          "SELECT id, username FROM users WHERE username = ? AND password_hash = ?",
          username,
          passwordHash
        ).toArray();

        return users.length
          ? json({ ok: true, user: users[0] })
          : json({ ok: false, error: "نام کاربری یا رمز عبور اشتباه است" }, 401);
      }

      if (url.pathname === "/messages" && request.method === "GET") {
        const messages = this.ctx.storage.sql.exec(
          "SELECT id, username, text, created_at FROM messages ORDER BY id DESC LIMIT 100"
        ).toArray().reverse();
        return json({ ok: true, messages });
      }

      if (url.pathname === "/messages" && request.method === "POST") {
        if (!body) return json({ ok: false, error: "درخواست نامعتبر است" }, 400);
        const username = String(body.username || "").trim();
        const text = String(body.text || "").trim();
        if (!username || !text) return json({ ok: false, error: "پیام نامعتبر است" }, 400);

        this.ctx.storage.sql.exec(
          "INSERT INTO messages(username, text) VALUES(?, ?)",
          username,
          text
        );
        return json({ ok: true });
      }

      return json({ ok: false, error: "Not found" }, 404);
    } catch (error) {
      console.error("ChatRoom error", error);
      return json({
        ok: false,
        error: "خطای داخلی سرور",
        detail: String(error?.message || error)
      }, 500);
    }
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (["/login", "/register", "/messages", "/health"].includes(url.pathname)) {
        const id = env.CHAT_ROOM.idFromName("chat-dorhami-global");
        return env.CHAT_ROOM.get(id).fetch(request);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Worker error", error);
      return json({
        ok: false,
        error: "خطای داخلی Worker",
        detail: String(error?.message || error)
      }, 500);
    }
  },
};
