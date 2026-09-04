import { DurableObject } from "cloudflare:workers";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*"
    }
  });

async function hashPassword(password) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ready = this.initialize();
  }

  async initialize() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_created_at ON messages(created_at);
    `);
  }

  async fetch(request) {
    try {
      await this.ready;
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        this.ctx.storage.sql.exec("SELECT 1").toArray();
        return json({ ok: true, server: true, database: true });
      }

      if (request.method === "POST" && url.pathname === "/register") {
        const body = await request.json();
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        if (!/^[\u0600-\u06FFa-zA-Z0-9_ ]{3,24}$/.test(username)) return json({ error: "نام کاربری ۳ تا ۲۴ کاراکتر باشد." }, 400);
        if (password.length < 6 || password.length > 72) return json({ error: "رمز عبور باید حداقل ۶ کاراکتر باشد." }, 400);
        const exists = this.ctx.storage.sql.exec("SELECT id FROM users WHERE username = ? LIMIT 1", username).toArray();
        if (exists.length) return json({ error: "این نام کاربری قبلاً ثبت شده است." }, 409);
        this.ctx.storage.sql.exec("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)", username, await hashPassword(password), Date.now());
        return json({ ok: true, username });
      }

      if (request.method === "POST" && url.pathname === "/login") {
        const body = await request.json();
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        const rows = this.ctx.storage.sql.exec("SELECT username, password_hash FROM users WHERE username = ? LIMIT 1", username).toArray();
        if (!rows.length || rows[0].password_hash !== await hashPassword(password)) return json({ error: "نام کاربری یا رمز عبور اشتباه است." }, 401);
        return json({ ok: true, username: rows[0].username });
      }

      if (url.pathname === "/messages" && request.method === "GET") {
        const rows = this.ctx.storage.sql.exec("SELECT id, username, text, created_at FROM messages ORDER BY id DESC LIMIT 100").toArray().reverse();
        return json({ ok: true, messages: rows });
      }

      if (url.pathname === "/messages" && request.method === "POST") {
        const body = await request.json();
        const username = String(body.username || "").trim();
        const text = String(body.text || "").trim();
        if (!username || !text || text.length > 1000) return json({ error: "پیام نامعتبر است." }, 400);
        const now = Date.now();
        this.ctx.storage.sql.exec("INSERT INTO messages (username, text, created_at) VALUES (?, ?, ?)", username, text, now);
        const row = this.ctx.storage.sql.exec("SELECT id, username, text, created_at FROM messages WHERE id = last_insert_rowid()").toArray()[0];
        return json({ ok: true, message: row });
      }

      return json({ error: "مسیر پیدا نشد." }, 404);
    } catch (error) {
      return json({ error: "خطای داخلی سرور", detail: String(error?.message || error) }, 500);
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const apiPaths = new Set(["/health", "/register", "/login", "/messages"]);
    if (apiPaths.has(url.pathname)) {
      try {
        const id = env.CHAT_ROOM.idFromName("public-room");
        return await env.CHAT_ROOM.get(id).fetch(request);
      } catch (error) {
        return json({ error: "اتصال سرور برقرار نشد.", detail: String(error?.message || error) }, 500);
      }
    }

    try {
      return await env.ASSETS.fetch(request);
    } catch (error) {
      return new Response("Chat Dorhami is starting...", { status: 503, headers: { "content-type": "text/plain; charset=UTF-8" } });
    }
  }
};
