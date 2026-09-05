import { DurableObject } from "cloudflare:workers";

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      ...extraHeaders
    }
  });

async function hashPassword(password) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function sessionCookie(token) {
  return `dorhami_session=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`;
}

function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  const item = header.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ready = this.initialize();
    this.typing = new Map();
  }

  async initialize() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        avatar TEXT NOT NULL DEFAULT '👤',
        role TEXT NOT NULL DEFAULT 'user',
        is_starred INTEGER NOT NULL DEFAULT 0,
        is_blocked INTEGER NOT NULL DEFAULT 0,
        is_crowned INTEGER NOT NULL DEFAULT 0,
        is_diamond INTEGER NOT NULL DEFAULT 0,
        is_vip INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS private_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL,
        recipient TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS private_reads (
        username TEXT NOT NULL,
        other_user TEXT NOT NULL,
        last_read_id INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (username, other_user)
      );
      CREATE TABLE IF NOT EXISTS presence (
        username TEXT PRIMARY KEY,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS message_reactions (
        message_key TEXT NOT NULL,
        username TEXT NOT NULL,
        emoji TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (message_key, username, emoji)
      );
      CREATE TABLE IF NOT EXISTS site_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_username ON sessions(username);
      CREATE INDEX IF NOT EXISTS messages_created_at ON messages(created_at);
      CREATE INDEX IF NOT EXISTS private_messages_pair ON private_messages(sender, recipient, id);
      CREATE INDEX IF NOT EXISTS private_messages_created_at ON private_messages(created_at);
      CREATE INDEX IF NOT EXISTS private_messages_recipient_id ON private_messages(recipient, id);
      CREATE INDEX IF NOT EXISTS presence_last_seen ON presence(last_seen);
      CREATE INDEX IF NOT EXISTS message_reactions_key ON message_reactions(message_key);
    `);
    try { this.ctx.storage.sql.exec("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT '👤'"); } catch (error) {}
    try { this.ctx.storage.sql.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"); } catch (error) {}
    try { this.ctx.storage.sql.exec("ALTER TABLE users ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0"); } catch (error) {}
    try { this.ctx.storage.sql.exec("ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0"); } catch (error) {}
    try { this.ctx.storage.sql.exec("ALTER TABLE users ADD COLUMN is_crowned INTEGER NOT NULL DEFAULT 0"); } catch (error) {}
    try { this.ctx.storage.sql.exec("ALTER TABLE users ADD COLUMN is_diamond INTEGER NOT NULL DEFAULT 0"); } catch (error) {}
    try { this.ctx.storage.sql.exec("ALTER TABLE users ADD COLUMN is_vip INTEGER NOT NULL DEFAULT 0"); } catch (error) {}
  }

  createSession(username) {
    const token = crypto.randomUUID();
    this.ctx.storage.sql.exec("INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)", token, username, Date.now());
    return token;
  }

  getSessionUsername(request) {
    const token = getCookie(request, "dorhami_session");
    if (!token) return "";
    const rows = this.ctx.storage.sql.exec("SELECT s.username FROM sessions s JOIN users u ON u.username = s.username WHERE s.token = ? AND u.is_blocked = 0 LIMIT 1", token).toArray();
    return rows.length ? String(rows[0].username || "").trim() : "";
  }

  getSessionUser(request) {
    const token = getCookie(request, "dorhami_session");
    if (!token) return null;
    const rows = this.ctx.storage.sql.exec(
      "SELECT u.username, u.role, u.is_blocked FROM sessions s JOIN users u ON u.username = s.username WHERE s.token = ? LIMIT 1",
      token
    ).toArray();
    if (!rows.length || Number(rows[0].is_blocked) === 1) return null;
    const username = String(rows[0].username || "").trim();
    return {
      username,
      role: username === "Morteza2026" ? "admin" : String(rows[0].role || "user").trim()
    };
  }

  getAdminUser(request) {
    const user = this.getSessionUser(request);
    return user && user.role === "admin" ? user : null;
  }

  isUserBlocked(username) {
    const name = String(username || "").trim();
    if (!name) return false;
    const rows = this.ctx.storage.sql.exec("SELECT is_blocked FROM users WHERE username = ? LIMIT 1", name).toArray();
    return rows.length && Number(rows[0].is_blocked) === 1;
  }

  async fetch(request) {
    try {
      await this.ready;
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        this.ctx.storage.sql.exec("SELECT 1").toArray();
        return json({ ok: true, server: true, database: true });
      }

      if (request.method === "GET" && url.pathname === "/announcement") {
        const fallback = "لطفاً در دورهمی به یکدیگر احترام بگذارید؛ هرگونه فحاشی و توهین باعث مسدود شدن کاربر خواهد شد. در صورت مشاهده تخلف، موضوع را به مدیریت گزارش کنید. ✦";
        const rows = this.ctx.storage.sql.exec("SELECT value FROM site_settings WHERE key = ? LIMIT 1", "announcement_text").toArray();
        const text = rows.length ? String(rows[0].value || "").trim() : "";
        return json({ ok: true, text: text || fallback });
      }

      if (request.method === "GET" && url.pathname === "/admin") {
        const user = this.getSessionUser(request);
        if (!user) return json({ error: "برای ورود به پنل مدیریت ابتدا وارد حساب شو." }, 401);
        if (user.role !== "admin") return json({ error: "دسترسی غیرمجاز." }, 403);
        return json({ ok: true, admin: user.username });
      }

      if (request.method === "GET" && url.pathname === "/admin/announcement") {
        const admin = this.getAdminUser(request);
        if (!admin) return json({ error: "دسترسی غیرمجاز." }, 403);
        const fallback = "لطفاً در دورهمی به یکدیگر احترام بگذارید؛ هرگونه فحاشی و توهین باعث مسدود شدن کاربر خواهد شد. در صورت مشاهده تخلف، موضوع را به مدیریت گزارش کنید. ✦";
        const rows = this.ctx.storage.sql.exec("SELECT value FROM site_settings WHERE key = ? LIMIT 1", "announcement_text").toArray();
        const text = rows.length ? String(rows[0].value || "").trim() : "";
        return json({ ok: true, text: text || fallback });
      }

      if (request.method === "POST" && url.pathname === "/admin/announcement") {
        const admin = this.getAdminUser(request);
        if (!admin) return json({ error: "دسترسی غیرمجاز." }, 403);
        const body = await request.json().catch(() => ({}));
        const text = String(body.text || "").trim();
        if (!text) return json({ error: "متن تابلو نمی‌تواند خالی باشد." }, 400);
        if (text.length > 1000) return json({ error: "متن تابلو حداکثر ۱۰۰۰ کاراکتر باشد." }, 400);
        this.ctx.storage.sql.exec(
          "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
          "announcement_text", text, Date.now()
        );
        return json({ ok: true, text });
      }

      if (request.method === "GET" && url.pathname === "/profile/me") {
        const username = this.getSessionUsername(request);
        if (!username) return json({ error: "برای دریافت هویت حساب باید وارد حساب خودت باشی." }, 401);
        const rows = this.ctx.storage.sql.exec("SELECT username, is_vip FROM users WHERE username = ? LIMIT 1", username).toArray();
        return json({ ok: true, username, is_vip: rows.length ? Number(rows[0].is_vip || 0) : 0 });
      }

      if (request.method === "GET" && url.pathname === "/vip/status") {
        const username = this.getSessionUsername(request);
        if (!username) return json({ error: "برای دریافت وضعیت VIP باید وارد حساب خودت باشی." }, 401);
        const rows = this.ctx.storage.sql.exec("SELECT is_vip FROM users WHERE username = ? LIMIT 1", username).toArray();
        return json({ ok: true, username, is_vip: rows.length ? Number(rows[0].is_vip || 0) : 0 });
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
        const token = this.createSession(username);
        return json({ ok: true, username, avatar: "👤" }, 200, { "set-cookie": sessionCookie(token) });
      }

      if (request.method === "POST" && url.pathname === "/login") {
        const body = await request.json();
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        const rows = this.ctx.storage.sql.exec("SELECT username, password_hash, avatar, is_blocked FROM users WHERE username = ? LIMIT 1", username).toArray();
        if (!rows.length || rows[0].password_hash !== await hashPassword(password)) return json({ error: "نام کاربری یا رمز عبور اشتباه است." }, 401);
        if (Number(rows[0].is_blocked) === 1) return json({ error: "این حساب توسط مدیریت مسدود شده است." }, 403);
        const token = this.createSession(rows[0].username);
        return json({ ok: true, username: rows[0].username, avatar: rows[0].avatar || "👤" }, 200, { "set-cookie": sessionCookie(token) });
      }

      if (request.method === "GET" && url.pathname === "/profile") {
        const username = String(url.searchParams.get("username") || "").trim();
        if (!username) return json({ error: "کاربر نامعتبر است." }, 400);
        const rows = this.ctx.storage.sql.exec("SELECT username, avatar, is_vip FROM users WHERE username = ? LIMIT 1", username).toArray();
        if (!rows.length) return json({ error: "کاربر پیدا نشد." }, 404);
        return json({ ok: true, profile: { username: rows[0].username, avatar: rows[0].avatar || "👤", is_vip: Number(rows[0].is_vip || 0) } });
      }

      if (request.method === "POST" && url.pathname === "/profile") {
        const body = await request.json();
        const avatar = String(body.avatar || "").trim();
        const sessionUsername = this.getSessionUsername(request);
        const allowed = new Set(["😀","😎","🥰","🤩","😇","🥳","🤓","😈","👻","🤖","🐱","🐼","🦊","🐸","🐯","🦁","🐵","🐨","🐰","🐙","🦄","🐲","🌙","⭐","🔥"]);
        if (!sessionUsername) return json({ error: "برای ویرایش پروفایل باید وارد حساب خودت باشی." }, 401);
        if (!allowed.has(avatar)) return json({ error: "آواتار انتخاب‌شده معتبر نیست." }, 400);
        const result = this.ctx.storage.sql.exec("UPDATE users SET avatar = ? WHERE username = ?", avatar, sessionUsername);
        if (!result) return json({ error: "ذخیره آواتار انجام نشد." }, 500);
        const rows = this.ctx.storage.sql.exec("SELECT username, avatar, is_vip FROM users WHERE username = ? LIMIT 1", sessionUsername).toArray();
        if (!rows.length) return json({ error: "کاربر پیدا نشد." }, 404);
        return json({ ok: true, profile: { username: rows[0].username, avatar: rows[0].avatar, is_vip: Number(rows[0].is_vip || 0) } });
      }

      if (request.method === "GET" && url.pathname === "/users") {
        const rows = this.ctx.storage.sql.exec("SELECT username, avatar, is_starred, is_blocked, is_crowned, is_diamond, is_vip FROM users ORDER BY username COLLATE NOCASE").toArray();
        return json({ ok: true, users: rows });
      }

      if (request.method === "POST" && url.pathname === "/admin/user-vip") {
        const admin = this.getAdminUser(request);
        if (!admin) return json({ error: "دسترسی غیرمجاز." }, 403);
        const body = await request.json().catch(() => ({}));
        const username = String(body.username || "").trim();
        const vip = Boolean(body.vip);
        if (!username || username.length > 24) return json({ error: "کاربر نامعتبر است." }, 400);
        if (username === "Morteza2026") return json({ error: "حساب مدیر نیازی به VIP ندارد." }, 400);
        const exists = this.ctx.storage.sql.exec("SELECT username FROM users WHERE username = ? LIMIT 1", username).toArray();
        if (!exists.length) return json({ error: "کاربر پیدا نشد." }, 404);
        this.ctx.storage.sql.exec("UPDATE users SET is_vip = ? WHERE username = ?", vip ? 1 : 0, username);
        return json({ ok: true, username, is_vip: vip ? 1 : 0 });
      }

      if (request.method === "POST" && url.pathname === "/admin/user-star") {
        const admin = this.getAdminUser(request);
        if (!admin) return json({ error: "دسترسی غیرمجاز." }, 403);
        const body = await request.json().catch(() => ({}));
        const username = String(body.username || "").trim();
        const starred = Boolean(body.starred);
        if (!username || username.length > 24) return json({ error: "کاربر نامعتبر است." }, 400);
        const exists = this.ctx.storage.sql.exec("SELECT username FROM users WHERE username = ? LIMIT 1", username).toArray();
        if (!exists.length) return json({ error: "کاربر پیدا نشد." }, 404);
        this.ctx.storage.sql.exec("UPDATE users SET is_starred = ? WHERE username = ?", starred ? 1 : 0, username);
        return json({ ok: true, username, is_starred: starred ? 1 : 0 });
      }

      if (request.method === "POST" && url.pathname === "/admin/user-crown") {
        const admin = this.getAdminUser(request);
        if (!admin) return json({ error: "دسترسی غیرمجاز." }, 403);
        const body = await request.json().catch(() => ({}));
        const username = String(body.username || "").trim();
        const crowned = Boolean(body.crowned);
        if (!username || username.length > 24) return json({ error: "کاربر نامعتبر است." }, 400);
        if (username === "Morteza2026") return json({ error: "حساب مدیر نیازی به تاج ندارد." }, 400);
        const exists = this.ctx.storage.sql.exec("SELECT username FROM users WHERE username = ? LIMIT 1", username).toArray();
        if (!exists.length) return json({ error: "کاربر پیدا نشد." }, 404);
        this.ctx.storage.sql.exec("UPDATE users SET is_crowned = ? WHERE username = ?", crowned ? 1 : 0, username);
        return json({ ok: true, username, is_crowned: crowned ? 1 : 0 });
      }

      if (request.method === "POST" && url.pathname === "/admin/user-diamond") {
        const admin = this.getAdminUser(request);
        if (!admin) return json({ error: "دسترسی غیرمجاز." }, 403);
        const body = await request.json().catch(() => ({}));
        const username = String(body.username || "").trim();
        const diamond = Boolean(body.diamond);
        if (!username || username.length > 24) return json({ error: "کاربر نامعتبر است." }, 400);
        if (username === "Morteza2026") return json({ error: "حساب مدیر برای رتبه‌بندی کاربری در نظر گرفته نشده است." }, 400);
        const exists = this.ctx.storage.sql.exec("SELECT username FROM users WHERE username = ? LIMIT 1", username).toArray();
        if (!exists.length) return json({ error: "کاربر پیدا نشد." }, 404);
        this.ctx.storage.sql.exec("UPDATE users SET is_diamond = ? WHERE username = ?", diamond ? 1 : 0, username);
        return json({ ok: true, username, is_diamond: diamond ? 1 : 0 });
      }

      if (request.method === "POST" && url.pathname === "/admin/user-block") {
        const admin = this.getAdminUser(request);
        if (!admin) return json({ error: "دسترسی غیرمجاز." }, 403);
        const body = await request.json().catch(() => ({}));
        const username = String(body.username || "").trim();
        const blocked = Boolean(body.blocked);
        if (!username || username.length > 24) return json({ error: "کاربر نامعتبر است." }, 400);
        if (username === "Morteza2026") return json({ error: "حساب مدیر قابل مسدود کردن نیست." }, 400);
        const exists = this.ctx.storage.sql.exec("SELECT username FROM users WHERE username = ? LIMIT 1", username).toArray();
        if (!exists.length) return json({ error: "کاربر پیدا نشد." }, 404);
        this.ctx.storage.sql.exec("UPDATE users SET is_blocked = ? WHERE username = ?", blocked ? 1 : 0, username);
        if (blocked) {
          this.ctx.storage.sql.exec("DELETE FROM sessions WHERE username = ?", username);
          this.ctx.storage.sql.exec("DELETE FROM presence WHERE username = ?", username);
          for (const key of [...this.typing.keys()]) if (key.endsWith(`|${username}`)) this.typing.delete(key);
        }
        return json({ ok: true, username, is_blocked: blocked ? 1 : 0 });
      }

      if (url.pathname === "/presence" && request.method === "POST") {
        const body = await request.json();
        const username = String(body.username || "").trim();
        if (!username || username.length > 24) return json({ error: "کاربر نامعتبر است." }, 400);
        if (this.isUserBlocked(username)) return json({ error: "این حساب توسط مدیریت مسدود شده است." }, 403);
        const now = Date.now();
        this.ctx.storage.sql.exec("INSERT INTO presence (username, last_seen) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET last_seen = excluded.last_seen", username, now);
        this.ctx.storage.sql.exec("DELETE FROM presence WHERE last_seen < ?", now - 30000);
        return json({ ok: true });
      }

      if (url.pathname === "/presence" && request.method === "GET") {
        const now = Date.now();
        this.ctx.storage.sql.exec("DELETE FROM presence WHERE last_seen < ?", now - 30000);
        const rows = this.ctx.storage.sql.exec("SELECT username, last_seen FROM presence ORDER BY username COLLATE NOCASE").toArray();
        return json({ ok: true, count: rows.length, users: rows });
      }

      if (url.pathname === "/presence" && request.method === "DELETE") {
        const body = await request.json().catch(() => ({}));
        const username = String(body.username || "").trim();
        if (username) this.ctx.storage.sql.exec("DELETE FROM presence WHERE username = ?", username);
        return json({ ok: true });
      }

      if (url.pathname === "/typing" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const username = String(body.username || "").trim();
        const context = String(body.context || "public").trim();
        const isTyping = Boolean(body.typing);
        if (!username || username.length > 24 || !context || context.length > 80) return json({ error: "اطلاعات تایپ نامعتبر است." }, 400);
        if (this.isUserBlocked(username)) return json({ error: "این حساب توسط مدیریت مسدود شده است." }, 403);
        const key = `${context}|${username}`;
        if (isTyping) this.typing.set(key, Date.now());
        else this.typing.delete(key);
        return json({ ok: true });
      }

      if (url.pathname === "/typing" && request.method === "GET") {
        const context = String(url.searchParams.get("context") || "public").trim();
        const me = String(url.searchParams.get("me") || "").trim();
        const now = Date.now();
        for (const [key, time] of this.typing) if (now - time > 5000) this.typing.delete(key);
        const prefix = `${context}|`;
        const users = [];
        for (const [key, time] of this.typing) {
          if (key.startsWith(prefix) && now - time <= 5000) {
            const name = key.slice(prefix.length);
            if (name && name !== me && !this.isUserBlocked(name)) users.push(name);
          }
        }
        return json({ ok: true, users: [...new Set(users)] });
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
        if (this.isUserBlocked(username)) return json({ error: "این حساب توسط مدیریت مسدود شده است." }, 403);
        const now = Date.now();
        this.ctx.storage.sql.exec("INSERT INTO messages (username, text, created_at) VALUES (?, ?, ?)", username, text, now);
        const row = this.ctx.storage.sql.exec("SELECT id, username, text, created_at FROM messages WHERE id = last_insert_rowid()").toArray()[0];
        return json({ ok: true, message: row });
      }

      if (url.pathname === "/reactions" && request.method === "GET") {
        const keys = [...new Set((url.searchParams.get("keys") || "").split(",").map(value => value.trim()).filter(Boolean))].slice(0, 100);
        if (!keys.length) return json({ ok: true, reactions: {} });
        const placeholders = keys.map(() => "?").join(",");
        const rows = this.ctx.storage.sql.exec(`SELECT message_key, emoji, COUNT(*) AS count FROM message_reactions WHERE message_key IN (${placeholders}) GROUP BY message_key, emoji ORDER BY message_key, emoji`, ...keys).toArray();
        const reactions = {};
        rows.forEach(row => {
          reactions[row.message_key] ||= {};
          reactions[row.message_key][row.emoji] = Number(row.count || 0);
        });
        return json({ ok: true, reactions });
      }

      if (url.pathname === "/reactions" && request.method === "POST") {
        const body = await request.json();
        const messageKey = String(body.messageKey || "").trim();
        const username = String(body.username || "").trim();
        const emoji = String(body.emoji || "").trim();
        const allowed = new Set(["❤️","😂","😍","👍","🔥"]);
        if (!messageKey || messageKey.length > 160 || !username || username.length > 24 || !allowed.has(emoji)) return json({ error: "واکنش نامعتبر است." }, 400);
        if (this.isUserBlocked(username)) return json({ error: "این حساب توسط مدیریت مسدود شده است." }, 403);
        const existing = this.ctx.storage.sql.exec("SELECT 1 FROM message_reactions WHERE message_key = ? AND username = ? AND emoji = ? LIMIT 1", messageKey, username, emoji).toArray();
        if (existing.length) {
          this.ctx.storage.sql.exec("DELETE FROM message_reactions WHERE message_key = ? AND username = ? AND emoji = ?", messageKey, username, emoji);
        } else {
          this.ctx.storage.sql.exec("INSERT INTO message_reactions (message_key, username, emoji, created_at) VALUES (?, ?, ?, ?)", messageKey, username, emoji, Date.now());
        }
        const rows = this.ctx.storage.sql.exec("SELECT emoji, COUNT(*) AS count FROM message_reactions WHERE message_key = ? GROUP BY emoji ORDER BY emoji", messageKey).toArray();
        const reactions = {};
        rows.forEach(row => { reactions[row.emoji] = Number(row.count || 0); });
        return json({ ok: true, reactions });
      }

      if (url.pathname === "/private-messages" && request.method === "GET") {
        const me = String(url.searchParams.get("me") || "").trim();
        const withUser = String(url.searchParams.get("with") || "").trim();
        if (!me || !withUser || me === withUser) return json({ error: "گفتگوی خصوصی نامعتبر است." }, 400);
        if (this.isUserBlocked(me)) return json({ error: "این حساب توسط مدیریت مسدود شده است." }, 403);
        const rows = this.ctx.storage.sql.exec("SELECT id, sender, recipient, text, created_at FROM private_messages WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?) ORDER BY id ASC LIMIT 200", me, withUser, withUser, me).toArray();
        return json({ ok: true, messages: rows });
      }

      if (url.pathname === "/private-messages" && request.method === "POST") {
        const body = await request.json();
        const sender = String(body.sender || "").trim();
        const recipient = String(body.recipient || "").trim();
        const text = String(body.text || "").trim();
        if (!sender || !recipient || sender === recipient || !text || text.length > 1000) return json({ error: "پیام خصوصی نامعتبر است." }, 400);
        if (this.isUserBlocked(sender)) return json({ error: "این حساب توسط مدیریت مسدود شده است." }, 403);
        if (this.isUserBlocked(recipient)) return json({ error: "این کاربر توسط مدیریت مسدود شده است." }, 403);
        const user = this.ctx.storage.sql.exec("SELECT username FROM users WHERE username = ? LIMIT 1", recipient).toArray();
        if (!user.length) return json({ error: "این کاربر پیدا نشد." }, 404);
        const now = Date.now();
        this.ctx.storage.sql.exec("INSERT INTO private_messages (sender, recipient, text, created_at) VALUES (?, ?, ?, ?)", sender, recipient, text, now);
        const row = this.ctx.storage.sql.exec("SELECT id, sender, recipient, text, created_at FROM private_messages WHERE id = last_insert_rowid()").toArray()[0];
        return json({ ok: true, message: row });
      }

      if (url.pathname === "/private-unread" && request.method === "GET") {
        const me = String(url.searchParams.get("me") || "").trim();
        if (!me) return json({ error: "کاربر نامعتبر است." }, 400);
        if (this.isUserBlocked(me)) return json({ error: "این حساب توسط مدیریت مسدود شده است." }, 403);
        const rows = this.ctx.storage.sql.exec(`SELECT pm.sender, COUNT(*) AS count, MAX(pm.id) AS latest_id FROM private_messages pm LEFT JOIN private_reads pr ON pr.username = ? AND pr.other_user = pm.sender WHERE pm.recipient = ? AND pm.id > COALESCE(pr.last_read_id, 0) GROUP BY pm.sender ORDER BY latest_id DESC`, me, me).toArray();
        const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
        return json({ ok: true, total, users: rows });
      }

      if (url.pathname === "/private-read" && request.method === "POST") {
        const body = await request.json();
        const username = String(body.username || "").trim();
        const otherUser = String(body.otherUser || "").trim();
        const lastReadId = Number(body.lastReadId || 0);
        if (!username || !otherUser || username === otherUser || !Number.isFinite(lastReadId) || lastReadId < 0) return json({ error: "اطلاعات خواندن نامعتبر است." }, 400);
        if (this.isUserBlocked(username)) return json({ error: "این حساب توسط مدیریت مسدود شده است." }, 403);
        this.ctx.storage.sql.exec(`INSERT INTO private_reads (username, other_user, last_read_id) VALUES (?, ?, ?) ON CONFLICT(username, other_user) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`, username, otherUser, Math.floor(lastReadId));
        return json({ ok: true });
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
    const apiPaths = new Set(["/health", "/announcement", "/register", "/login", "/profile", "/profile/me", "/vip/status", "/users", "/presence", "/typing", "/messages", "/reactions", "/private-messages", "/private-unread", "/private-read", "/admin", "/admin/announcement", "/admin/user-vip", "/admin/user-star", "/admin/user-crown", "/admin/user-diamond", "/admin/user-block"]);
    if (apiPaths.has(url.pathname)) {
      try {
        const id = env.CHAT_ROOM.idFromName("public-room");
        return await env.CHAT_ROOM.get(id).fetch(request);
      } catch (error) {
        return json({ error: "اتصال سرور برقرار نشد.", detail: String(error?.message || error) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};