const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.ready = this.init();
  }

  async init() {
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);

    if (url.pathname === "/health") return json({ ok: true });

    if (url.pathname === "/register" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body) return json({ ok: false, error: "درخواست نامعتبر است" }, 400);
      const username = String(body.username || "").trim();
      const passwordHash = String(body.passwordHash || "");
      if (!/^[\\p{L}\\p{N}_]{3,24}$/u.test(username)) {
        return json({ ok: false, error: "نام کاربری باید ۳ تا ۲۴ کاراکتر باشد" }, 400);
      }
      if (!/^[a-f0-9]{64}$/i.test(passwordHash)) {
        return json({ ok: false, error: "رمز عبور نامعتبر است" }, 400);
      }
      const exists = [...this.state.storage.sql.exec("SELECT id FROM users WHERE username = ?", username)];
      if (exists.length) return json({ ok: false, error: "این نام کاربری قبلاً ثبت شده است" }, 409);
      const result = this.state.storage.sql.exec(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)", username, passwordHash
      );
      const id = Number(result.lastInsertRowId);
      return json({ ok: true, user: { id, username } }, 201);
    }

    if (url.pathname === "/login" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body) return json({ ok: false, error: "درخواست نامعتبر است" }, 400);
      const username = String(body.username || "").trim();
      const passwordHash = String(body.passwordHash || "");
      const rows = [...this.state.storage.sql.exec(
        "SELECT id, username FROM users WHERE username = ? AND password_hash = ?",
        username, passwordHash
      )];
      if (!rows.length) return json({ ok: false, error: "نام کاربری یا رمز عبور اشتباه است" }, 401);
      return json({ ok: true, user: { id: rows[0].id, username: rows[0].username } });
    }

    if (url.pathname === "/messages" && request.method === "GET") {
      const rows = [...this.state.storage.sql.exec(
        "SELECT id, username, text, created_at FROM messages ORDER BY id DESC LIMIT 100"
      )].reverse();
      return json({ ok: true, messages: rows });
    }

    if (url.pathname === "/messages" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body) return json({ ok: false, error: "درخواست نامعتبر است" }, 400);
      const username = String(body.username || "").trim();
      const text = String(body.text || "").trim();
      if (!username || !text || text.length > 1000) return json({ ok: false, error: "پیام نامعتبر است" }, 400);
      this.state.storage.sql.exec("INSERT INTO messages (username, text) VALUES (?, ?)", username, text);
      return json({ ok: true });
    }

    return json({ ok: false, error: "مسیر پیدا نشد" }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const target = new URL(request.url);
      target.pathname = "/index.html";
      return env.ASSETS.fetch(new Request(target, request));
    }
    const id = env.CHAT_ROOM.idFromName("chat-dorhami-global");
    const room = env.CHAT_ROOM.get(id);
    return room.fetch(request);
  }
};
