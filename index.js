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

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(hash)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);

    ctx.storage.sql.exec(`
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
          error: "رمز عبور نامعتبر است."
        }, 400);
      }

      const exists = ctx.storage.sql
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

      const id = crypto.randomUUID();

      ctx.storage.sql.exec(
        `INSERT INTO users
        (id, username, password_hash, created_at)
        VALUES (?, ?, ?, ?)`,
        id,
        username,
        passwordHash,
        Date.now
