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
  const bytes = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export class ChatRoom extends DurableObject {
  constructor(ctx) {
    super(ctx);
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

    /* REGISTER */
    if (url.pathname === "/register" && request.method === "POST") {
      try {
        const data = await request.json();

        const username = clean(data.username, 24).toLowerCase();
        const passwordHash = clean(data.passwordHash, 128);

        if (!/^[\p{L}\p{N}_]{3,24}$/u.test(username)) {
          return json({
            ok: false,
            error:
              "نام کاربری باید بین ۳ تا ۲۴ کاراکتر باشد."
          }, 400);
        }

        if (!passwordHash) {
          return json({
            ok: false,
            error: "رمز عبور دریافت نشد."
          }, 400);
        }

        const existing = this.ctx.storage.sql
          .exec(
            "SELECT id FROM users WHERE username = ? LIMIT 1",
            username
          )
          .toArray();

        if (existing.length > 0) {
          return json({
            ok: false,
            error: "این نام کاربری قبلاً ثبت شده است."
          }, 409);
        }

        const id = crypto.randomUUID();

        this.ctx.storage.sql.exec(
          `INSERT INTO users
           (id, username, password_hash, created_at)
           VALUES (?, ?, ?, ?)`,
          id,
          username,
          passwordHash,
          Date.now()
        );

        return json({
          ok: true,
          user: {
            id,
            username
          }
        });

      } catch (error) {
        console.error("REGISTER ERROR:", error);

        return json({
          ok: false,
          error:
            "خطای سرور هنگام ثبت‌نام: " +
            String(error?.message || error)
        }, 500);
      }
    }

    /* LOGIN */
    if (url.pathname === "/login" && request.method === "POST") {
      try {
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

      } catch (error) {
        console.error("LOGIN ERROR:", error);

        return json({
          ok: false,
          error:
            "خطای سرور هنگام ورود: " +
            String(error?.message || error)
        }, 500);
      }
    }

    /* MESSAGES */
    if (url.pathname === "/messages") {
      try {
        const messages = this.ctx.storage.sql
          .exec(`
            SELECT id, username, body, created_at
            FROM messages
            ORDER BY created_at ASC
            LIMIT 100
          `)
          .toArray();

        return json({
          ok: true,
          messages
        });

      } catch (error) {
        return json({
          ok: false,
          error: "دریافت پیام‌ها ناموفق بود."
        }, 500);
      }
    }

    /* SEND */
    if (url.pathname === "/send" && request.method === "POST") {
      try {
        const data = await request.json();

        const username = clean(data.username, 24);
        const body = clean(data.body, 2000);

        if (!username || !body) {
          return json({
            ok: false,
            error: "پیام خالی است."
          }, 400);
        }

        const message = {
          id: crypto.randomUUID(),
          username,
          body,
          created_at: Date.now()
        };

        this.ctx.storage.sql.exec(
          `INSERT INTO messages
           (id, username, body, created_at)
           VALUES (?, ?, ?, ?)`,
          message.id,
          message.username,
          message.body,
          message.created_at
        );

        this.broadcast({
          type: "message",
          message
        });

        return json({
          ok: true,
          message
        });

      } catch (error) {
        return json({
          ok: false,
          error:
            "خطا در ارسال پیام: " +
            String(error?.message || error)
        }, 500);
      }
    }

    /* WEBSOCKET */
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
          ORDER BY created_at ASC
          LIMIT 100
        `)
        .toArray();

      server.send(
        JSON.stringify({
          type: "history",
          messages
        })
      );

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
          : JSON.parse(
              new TextDecoder().decode(message)
            );
    } catch {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "پیام نامعتبر است."
        })
      );

      return;
    }

    const attachment =
      ws.deserializeAttachment() || {};

    const username =
      clean(attachment.username, 24) ||
      "مهمان";

    if (data.type === "message") {
      const body = clean(data.body, 2000);

      if (!body) return;

      const messageData = {
        id: crypto.randomUUID(),
        username,
        body,
        created_at: Date.now()
      };

      this.ctx.storage.sql.exec(
        `INSERT INTO messages
         (id, username, body, created_at)
         VALUES (?, ?, ?, ?)`,
        messageData.id,
        messageData.username,
        messageData.body,
        messageData.created_at
      );

      this.broadcast({
        type: "message",
        message: messageData
      });
    }
  }

  async webSocketClose(ws) {
    const attachment =
      ws.deserializeAttachment() || {};

    const username =
      clean(attachment.username, 24);

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

    /* HEALTH */
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        app: "Chat Dorhami",
        version: "4.2"
      });
    }

    /* REGISTER */
    if (
      url.pathname === "/api/register" &&
      request.method === "POST"
    ) {
      try {
        const data = await request.json();

        const username =
          clean(data.username, 24).toLowerCase();

        const password =
          String(data.password || "");

        if (password.length < 8) {
          return json({
            ok: false,
            error:
              "رمز عبور باید حداقل ۸ کاراکتر باشد."
          }, 400);
        }

        const room =
          env.CHAT_ROOM.get(
            env.CHAT_ROOM.idFromName("global")
          );

        return room.fetch(
          new Request(
            "https://chat/register",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json"
              },
              body: JSON.stringify({
                username,
                passwordHash:
                  await hashPassword(password)
              })
            }
          )
        );

      } catch (error) {
        return json({
          ok: false,
          error:
            "خطای ثبت‌نام: " +
            String(error?.message || error)
        }, 500);
      }
    }

    /* LOGIN */
    if (
      url.pathname === "/api/login" &&
      request.method === "POST"
    ) {
      try {
        const data = await request.json();

        const room =
          env.CHAT_ROOM.get(
            env.CHAT_ROOM.idFromName("global")
          );

        return room.fetch(
          new Request(
            "https://chat/login",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json"
              },
              body: JSON.stringify({
                username:
                  clean(
                    data.username,
                    24
                  ).toLowerCase(),

                passwordHash:
                  await hashPassword(
                    String(
                      data.password || ""
                    )
                  )
              })
            }
          )
        );

      } catch (error) {
        return json({
          ok: false,
          error:
            "خطای ورود: " +
            String(error?.message || error)
        }, 500);
      }
    }

    /* GET MESSAGES */
    if (url.pathname === "/api/messages") {
      const room =
        env.CHAT_ROOM.get(
          env.CHAT_ROOM.idFromName("global")
        );

      return room.fetch(
        new Request(
          "https://chat/messages"
        )
      );
    }

    /* SEND MESSAGE */
    if (
      url.pathname === "/api/send" &&
      request.method === "POST"
    ) {
      const data = await request.json();

      const room =
        env.CHAT_ROOM.get(
          env.CHAT_ROOM.idFromName("global")
        );

      return room.fetch(
        new Request(
          "https://chat/send",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify(data)
          }
        )
      );
    }

    /* WEBSOCKET */
    if (url.pathname === "/ws") {
      const room =
        env.CHAT_ROOM.get(
          env.CHAT_ROOM.idFromName("global")
        );

      return room.fetch(request);
    }

    /* STATIC WEBSITE */
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(
      "Chat Dorhami is online."
    );
  }
};
