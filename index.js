import { DurableObject } from "cloudflare:workers";

/* =========================================================
   CHAT DORHAMI
   Cloudflare Worker + Durable Object SQLite
   Backend v6.0

   امکانات:
   - ثبت نام / ورود
   - Session
   - اتاق های عمومی
   - اتاق VIP
   - اتاق خصوصی
   - اتاق اشتراکی
   - مالک اتاق
   - انقضای اتاق
   - اشتراک VIP
   - قیمت قابل تنظیم از پنل مدیریت
   - لینک پرداخت قابل تنظیم از پنل مدیریت
   - ثبت سفارش
   - تایید سفارش توسط مدیر
   - WebSocket
   - پیام realtime
========================================================= */


/* =========================================================
   HELPERS
========================================================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Admin-Token",
      "Access-Control-Allow-Methods":
        "GET, POST, PUT, DELETE, OPTIONS"
    }
  });
}

function clean(value, max = 2000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);
}

function now() {
  return Date.now();
}

function uuid() {
  return crypto.randomUUID();
}


/* =========================================================
   HASH PASSWORD
========================================================= */

async function sha256(text) {
  const bytes =
    new TextEncoder().encode(text);

  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      bytes
    );

  return Array.from(
    new Uint8Array(hash)
  )
    .map(
      b =>
        b.toString(16).padStart(2, "0")
    )
    .join("");
}

function bytesToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);

  return Uint8Array.from(
    binary,
    c => c.charCodeAt(0)
  );
}

async function hashPassword(password) {

  const salt =
    crypto.getRandomValues(
      new Uint8Array(16)
    );

  const key =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

  const bits =
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations: 120000,
        hash: "SHA-256"
      },
      key,
      256
    );

  return (
    "pbkdf2$120000$" +
    bytesToBase64(salt) +
    "$" +
    bytesToBase64(
      new Uint8Array(bits)
    )
  );
}

async function verifyPassword(
  password,
  stored
) {

  if (!stored) {
    return false;
  }

  /* سازگاری با نسخه قبلی */

  if (!stored.startsWith("pbkdf2$")) {
    return (
      await sha256(password)
    ) === stored;
  }

  const parts =
    stored.split("$");

  if (parts.length !== 4) {
    return false;
  }

  const iterations =
    Number(parts[1]);

  try {

    const salt =
      base64ToBytes(parts[2]);

    const expected =
      base64ToBytes(parts[3]);

    const key =
      await crypto.subtle.importKey(
        "raw",
        new TextEncoder()
          .encode(password),
        "PBKDF2",
        false,
        ["deriveBits"]
      );

    const bits =
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt,
          iterations,
          hash: "SHA-256"
        },
        key,
        256
      );

    const actual =
      new Uint8Array(bits);

    if (
      actual.length !==
      expected.length
    ) {
      return false;
    }

    let difference = 0;

    for (
      let i = 0;
      i < actual.length;
      i++
    ) {
      difference |=
        actual[i] ^ expected[i];
    }

    return difference === 0;

  } catch {
    return false;
  }
}


/* =========================================================
   DURABLE OBJECT
========================================================= */

export class ChatRoom
  extends DurableObject {

  constructor(ctx, env) {

    super(ctx, env);

    this.ctx = ctx;
    this.env = env;

    this.initDatabase();
  }


  /* =======================================================
     DATABASE
  ======================================================= */

  initDatabase() {

    const db =
      this.ctx.storage.sql;

    db.exec(`
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

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'public',
        owner_id TEXT,
        price INTEGER NOT NULL DEFAULT 0,
        duration_days INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS room_members (
        room_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY(room_id,user_id)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS purchases (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount INTEGER NOT NULL DEFAULT 0,
        payment_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        approved_at INTEGER,
        metadata TEXT NOT NULL DEFAULT ''
      );
    `);


    /* -----------------------------------------------------
       Migration columns
    ----------------------------------------------------- */

    try {
      db.exec(`
        ALTER TABLE messages
        ADD COLUMN room_id TEXT
      `);
    } catch {}


    try {
      db.exec(`
        ALTER TABLE users
        ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0
      `);
    } catch {}


    try {
      db.exec(`
        ALTER TABLE users
        ADD COLUMN vip_until INTEGER NOT NULL DEFAULT 0
      `);
    } catch {}


    try {
      db.exec(`
        ALTER TABLE users
        ADD COLUMN private_room_credits
        INTEGER NOT NULL DEFAULT 0
      `);
    } catch {}


    try {
      db.exec(`
        ALTER TABLE users
        ADD COLUMN shared_room_credits
        INTEGER NOT NULL DEFAULT 0
      `);
    } catch {}


    /* -----------------------------------------------------
       Default settings
    ----------------------------------------------------- */

    const defaults = {

      vip_price:
        "50000",

      vip_duration_days:
        "30",

      vip_payment_url:
        "",


      private_room_price:
        "20000",

      private_room_duration_days:
        "30",

      private_room_payment_url:
        "",


      shared_room_price:
        "10000",

      shared_room_duration_days:
        "30",

      shared_room_payment_url:
        ""
    };


    for (
      const [key, value]
      of Object.entries(defaults)
    ) {

      const exists =
        db.exec(
          `
          SELECT key
          FROM settings
          WHERE key = ?
          LIMIT 1
          `,
          key
        ).toArray();

      if (!exists.length) {

        db.exec(
          `
          INSERT INTO settings
          (key,value)
          VALUES (?,?)
          `,
          key,
          value
        );
      }
    }


    /* -----------------------------------------------------
       Default rooms
    ----------------------------------------------------- */

    this.createDefaultRoom(
      "public-main",
      "دورهمی",
      "اتاق عمومی چت دورهمی",
      "public"
    );

    this.createDefaultRoom(
      "public-games",
      "گیم",
      "گفتگو درباره بازی",
      "public"
    );

    this.createDefaultRoom(
      "public-music",
      "موزیک",
      "گفتگو درباره موسیقی",
      "public"
    );

    this.createDefaultRoom(
      "public-sport",
      "ورزش",
      "گفتگو درباره ورزش",
      "public"
    );

    this.createDefaultRoom(
      "public-fun",
      "سرگرمی",
      "گپ و گفت و سرگرمی",
      "public"
    );

    this.createDefaultRoom(
      "vip-room",
      "اتاق VIP",
      "ویژه کاربران دارای اشتراک VIP",
      "vip"
    );
  }


  createDefaultRoom(
    roomId,
    name,
    description,
    type
  ) {

    const exists =
      this.ctx.storage.sql
        .exec(
          `
          SELECT id
          FROM rooms
          WHERE id = ?
          LIMIT 1
          `,
          roomId
        )
        .toArray();

    if (!exists.length) {

      this.ctx.storage.sql.exec(
        `
        INSERT INTO rooms
        (
          id,
          name,
          description,
          type,
          owner_id,
          price,
          duration_days,
          expires_at,
          created_at,
          is_active
        )
        VALUES
        (?, ?, ?, ?, NULL, 0, 0, NULL, ?, 1)
        `,
        roomId,
        name,
        description,
        type,
        now()
      );
    }
  }


  /* =======================================================
     SETTINGS
  ======================================================= */

  getSetting(
    key,
    fallback = ""
  ) {

    const result =
      this.ctx.storage.sql
        .exec(
          `
          SELECT value
          FROM settings
          WHERE key = ?
          LIMIT 1
          `,
          key
        )
        .toArray();

    return result.length
      ? result[0].value
      : fallback;
  }


  setSetting(
    key,
    value
  ) {

    this.ctx.storage.sql.exec(
      `
      INSERT INTO settings
      (key,value)
      VALUES (?,?)
      ON CONFLICT(key)
      DO UPDATE SET
      value = excluded.value
      `,
      key,
      String(value)
    );
  }


  getPublicSettings() {

    return {

      vip: {
        price:
          Number(
            this.getSetting(
              "vip_price",
              "0"
            )
          ),

        durationDays:
          Number(
            this.getSetting(
              "vip_duration_days",
              "30"
            )
          ),

        paymentUrl:
          this.getSetting(
            "vip_payment_url",
            ""
          )
      },


      privateRoom: {

        price:
          Number(
            this.getSetting(
              "private_room_price",
              "0"
            )
          ),

        durationDays:
          Number(
            this.getSetting(
              "private_room_duration_days",
              "30"
            )
          ),

        paymentUrl:
          this.getSetting(
            "private_room_payment_url",
            ""
          )
      },


      sharedRoom: {

        price:
          Number(
            this.getSetting(
              "shared_room_price",
              "0"
            )
          ),

        durationDays:
          Number(
            this.getSetting(
              "shared_room_duration_days",
              "30"
            )
          ),

        paymentUrl:
          this.getSetting(
            "shared_room_payment_url",
            ""
          )
      }
    };
  }


  /* =======================================================
     USERS
  ======================================================= */

  getUserByUsername(
    username
  ) {

    const result =
      this.ctx.storage.sql
        .exec(
          `
          SELECT *
          FROM users
          WHERE username = ?
          LIMIT 1
          `,
          username
        )
        .toArray();

    return result.length
      ? result[0]
      : null;
  }


  getUserById(
    userId
  ) {

    const result =
      this.ctx.storage.sql
        .exec(
          `
          SELECT
            id,
            username,
            is_admin,
            vip_until,
            private_room_credits,
            shared_room_credits,
            created_at
          FROM users
          WHERE id = ?
          LIMIT 1
          `,
          userId
        )
        .toArray();

    if (!result.length) {
      return null;
    }

    const user =
      result[0];

    return {
      id: user.id,

      username:
        user.username,

      isAdmin:
        Boolean(user.is_admin),

      vipUntil:
        Number(
          user.vip_until || 0
        ),

      isVip:
        Number(
          user.vip_until || 0
        ) > now(),

      privateRoomCredits:
        Number(
          user.private_room_credits || 0
        ),

      sharedRoomCredits:
        Number(
          user.shared_room_credits || 0
        ),

      createdAt:
        Number(
          user.created_at
        )
    };
  }


  /* =======================================================
     SESSION
  ======================================================= */

  createSession(
    userId
  ) {

    const token =
      uuid() +
      "-" +
      uuid();

    const createdAt =
      now();

    const expiresAt =
      createdAt +
      30 *
      24 *
      60 *
      60 *
      1000;

    this.ctx.storage.sql.exec(
      `
      INSERT INTO sessions
      (
        token,
        user_id,
        created_at,
        expires_at
      )
      VALUES (?,?,?,?)
      `,
      token,
      userId,
      createdAt,
      expiresAt
    );

    return {
      token,
      expiresAt
    };
  }


  getBearerToken(
    request
  ) {

    const value =
      request.headers.get(
        "Authorization"
      ) || "";

    if (
      !value.startsWith(
        "Bearer "
      )
    ) {
      return "";
    }

    return value
      .slice(7)
      .trim();
  }


  getUserFromToken(
    token
  ) {

    if (!token) {
      return null;
    }

    const result =
      this.ctx.storage.sql
        .exec(
          `
          SELECT u.*
          FROM sessions s
          JOIN users u
          ON u.id = s.user_id
          WHERE s.token = ?
          AND s.expires_at > ?
          LIMIT 1
          `,
          token,
          now()
        )
        .toArray();

    if (!result.length) {
      return null;
    }

    const u =
      result[0];

    return u;
  }


  requireUser(
    request
  ) {

    const token =
      this.getBearerToken(
        request
      );

    return this.getUserFromToken(
      token
    );
  }


  /* =======================================================
     ROOMS
  ======================================================= */

  getRoom(
    roomId
  ) {

    const result =
      this.ctx.storage.sql
        .exec(
          `
          SELECT
            r.*,
            u.username AS owner_username
          FROM rooms r
          LEFT JOIN users u
          ON u.id = r.owner_id
          WHERE r.id = ?
          LIMIT 1
          `,
          roomId
        )
        .toArray();

    return result.length
      ? result[0]
      : null;
  }


  listRooms() {

    return this.ctx.storage.sql
      .exec(
        `
        SELECT
          r.id,
          r.name,
          r.description,
          r.type,
          r.owner_id,
          r.price,
          r.duration_days,
          r.expires_at,
          r.created_at,
          r.is_active,
          u.username AS owner_username
        FROM rooms r
        LEFT JOIN users u
        ON u.id = r.owner_id
        WHERE r.is_active = 1
        AND (
          r.expires_at IS NULL
          OR r.expires_at > ?
        )
        ORDER BY
          CASE r.type
            WHEN 'public' THEN 1
            WHEN 'vip' THEN 2
            WHEN 'shared' THEN 3
            WHEN 'private' THEN 4
            ELSE 5
          END,
          r.created_at ASC
        `,
        now()
      )
      .toArray();
  }


  isRoomMember(
    roomId,
    userId
  ) {

    return (
      this.ctx.storage.sql
        .exec(
          `
          SELECT room_id
          FROM room_members
          WHERE room_id = ?
          AND user_id = ?
          LIMIT 1
          `,
          roomId,
          userId
        )
        .toArray()
        .length > 0
    );
  }


  addRoomMember(
    roomId,
    userId
  ) {

    this.ctx.storage.sql.exec(
      `
      INSERT OR IGNORE INTO
      room_members
      (
        room_id,
        user_id,
        joined_at
      )
      VALUES (?,?,?)
      `,
      roomId,
      userId,
      now()
    );
  }


  canAccessRoom(
    room,
    user
  ) {

    if (!room || !user) {
      return false;
    }

    if (
      !Number(room.is_active)
    ) {
      return false;
    }

    if (
      room.expires_at &&
      Number(room.expires_at)
        <= now()
    ) {
      return false;
    }


    /* عمومی */

    if (
      room.type === "public"
    ) {
      return true;
    }


    /* VIP */

    if (
      room.type === "vip"
    ) {

      return (
        Number(
          user.vip_until || 0
        ) > now()
      );
    }


    /* خصوصی */

    if (
      room.type === "private"
    ) {

      return (
        room.owner_id === user.id ||
        this.isRoomMember(
          room.id,
          user.id
        )
      );
    }


    /* اشتراکی */

    if (
      room.type === "shared"
    ) {

      return (
        room.owner_id === user.id ||
        this.isRoomMember(
          room.id,
          user.id
        )
      );
    }

    return false;
  }


  /* =======================================================
     PURCHASE
  ======================================================= */

  createPurchase(
    userId,
    type
  ) {

    let amount = 0;
    let paymentUrl = "";


    if (
      type === "vip"
    ) {

      amount =
        Number(
          this.getSetting(
            "vip_price",
            "0"
          )
        );

      paymentUrl =
        this.getSetting(
          "vip_payment_url",
          ""
        );
    }


    else if (
      type === "private_room"
    ) {

      amount =
        Number(
          this.getSetting(
            "private_room_price",
            "0"
          )
        );

      paymentUrl =
        this.getSetting(
          "private_room_payment_url",
          ""
        );
    }


    else if (
      type === "shared_room"
    ) {

      amount =
        Number(
          this.getSetting(
            "shared_room_price",
            "0"
          )
        );

      paymentUrl =
        this.getSetting(
          "shared_room_payment_url",
          ""
        );
    }


    else {

      throw new Error(
        "نوع خرید نامعتبر است."
      );
    }


    const purchaseId =
      uuid();

    this.ctx.storage.sql.exec(
      `
      INSERT INTO purchases
      (
        id,
        user_id,
        type,
        amount,
        payment_url,
        status,
        created_at,
        approved_at,
        metadata
      )
      VALUES
      (?,?,?,?,?,'pending',?,NULL,'')
      `,
      purchaseId,
      userId,
      type,
      amount,
      paymentUrl,
      now()
    );


    return {
      id:
        purchaseId,

      type,

      amount,

      paymentUrl,

      status:
        "pending"
    };
  }


  /* =======================================================
     MESSAGES
  ======================================================= */

  getMessages(
    roomId
  ) {

    return this.ctx.storage.sql
      .exec(
        `
        SELECT
          id,
          username,
          body,
          created_at,
          room_id
        FROM messages
        WHERE room_id = ?
        ORDER BY created_at ASC
        LIMIT 200
        `,
        roomId
      )
      .toArray();
  }


  saveMessage(
    roomId,
    username,
    body
  ) {

    const message = {

      id:
        uuid(),

      username,

      body,

      created_at:
        now(),

      room_id:
        roomId
    };


    this.ctx.storage.sql.exec(
      `
      INSERT INTO messages
      (
        id,
        username,
        body,
        created_at,
        room_id
      )
      VALUES (?,?,?,?,?)
      `,
      message.id,
      message.username,
      message.body,
      message.created_at,
      message.room_id
    );


    return message;
  }


  /* =======================================================
     WEBSOCKET BROADCAST
  ======================================================= */

  broadcast(
    data,
    roomId = null,
    except = null
  ) {

    const text =
      JSON.stringify(data);

    for (
      const ws
      of this.ctx.getWebSockets()
    ) {

      if (
        ws === except
      ) {
        continue;
      }

      const attachment =
        ws.deserializeAttachment() ||
        {};

      if (
        roomId &&
        attachment.roomId !== roomId
      ) {
        continue;
      }

      try {
        ws.send(text);
      } catch {}
    }
  }


  /* =======================================================
     DURABLE OBJECT FETCH
  ======================================================= */

  async fetch(
    request
  ) {

    const url =
      new URL(request.url);


    /* -----------------------------------------------------
       REGISTER
    ----------------------------------------------------- */

    if (
      url.pathname === "/register" &&
      request.method === "POST"
    ) {

      try {

        const data =
          await request.json();

        const username =
          clean(
            data.username,
            24
          ).toLowerCase();

        const password =
          String(
            data.password || ""
          );


        if (
          !/^[a-z0-9_]{3,24}$/
            .test(username)
        ) {

          return json({
            ok: false,
            error:
              "نام کاربری باید ۳ تا ۲۴ کاراکتر انگلیسی، عدد یا _ باشد."
          }, 400);
        }


        if (
          password.length < 8
        ) {

          return json({
            ok: false,
            error:
              "رمز عبور باید حداقل ۸ کاراکتر باشد."
          }, 400);
        }


        if (
          this.getUserByUsername(
            username
          )
        ) {

          return json({
            ok: false,
            error:
              "این نام کاربری قبلاً ثبت شده است."
          }, 409);
        }


        const userId =
          uuid();

        const passwordHash =
          await hashPassword(
            password
          );


        this.ctx.storage.sql.exec(
          `
          INSERT INTO users
          (
            id,
            username,
            password_hash,
            created_at,
            is_admin,
            vip_until,
            private_room_credits,
            shared_room_credits
          )
          VALUES
          (?, ?, ?, ?, 0, 0, 0, 0)
          `,
          userId,
          username,
          passwordHash,
          now()
        );


        this.addRoomMember(
          "public-main",
          userId
        );


        const session =
          this.createSession(
            userId
          );


        return json({
          ok: true,

          user:
            this.getUserById(
              userId
            ),

          token:
            session.token,

          expiresAt:
            session.expiresAt
        });

      } catch {

        return json({
          ok: false,
          error:
            "خطا در ثبت نام."
        }, 500);
      }
    }


    /* -----------------------------------------------------
       LOGIN
    ----------------------------------------------------- */

    if (
      url.pathname === "/login" &&
      request.method === "POST"
    ) {

      try {

        const data =
          await request.json();

        const username =
          clean(
            data.username,
            24
          ).toLowerCase();

        const password =
          String(
            data.password || ""
          );


        const user =
          this.getUserByUsername(
            username
          );


        if (!user) {

          return json({
            ok: false,
            error:
              "نام کاربری یا رمز عبور اشتباه است."
          }, 401);
        }


        const valid =
          await verifyPassword(
            password,
            user.password_hash
          );


        if (!valid) {

          return json({
            ok: false,
            error:
              "نام کاربری یا رمز عبور اشتباه است."
          }, 401);
        }


        const session =
          this.createSession(
            user.id
          );


        return json({

          ok: true,

          user:
            this.getUserById(
              user.id
            ),

          token:
            session.token,

          expiresAt:
            session.expiresAt
        });

      } catch {

        return json({
          ok: false,
          error:
            "خطا در ورود."
        }, 500);
      }
    }


    /* -----------------------------------------------------
       ME
    ----------------------------------------------------- */

    if (
      url.pathname === "/me" &&
      request.method === "GET"
    ) {

      const user =
        this.requireUser(
          request
        );


      if (!user) {

        return json({
          ok: false,
          error:
            "نیاز به ورود دارید."
        }, 401);
      }


      return json({
        ok: true,

        user:
          this.getUserById(
            user.id
          )
      });
    }


    /* -----------------------------------------------------
       PUBLIC SETTINGS
    ----------------------------------------------------- */

    if (
      url.pathname === "/settings" &&
      request.method === "GET"
    ) {

      return json({
        ok: true,

        settings:
          this.getPublicSettings()
      });
    }


    /* -----------------------------------------------------
       ROOMS
    ----------------------------------------------------- */

    if (
      url.pathname === "/rooms" &&
      request.method === "GET"
    ) {

      return json({
        ok: true,

        rooms:
          this.listRooms()
      });
    }


    /* -----------------------------------------------------
       ROOM JOIN
    ----------------------------------------------------- */

    if (
      url.pathname.startsWith(
        "/rooms/"
      ) &&
      url.pathname.endsWith(
        "/join"
      ) &&
      request.method === "POST"
    ) {

      const user =
        this.requireUser(
          request
        );


      if (!user) {

        return json({
          ok: false,
          error:
            "ابتدا وارد حساب شوید."
        }, 401);
      }


      const roomId =
        clean(
          url.pathname
            .replace(
              "/rooms/",
              ""
            )
            .replace(
              "/join",
              ""
            ),
          100
        );


      const room =
        this.getRoom(
          roomId
        );


      if (!room) {

        return json({
          ok: false,
          error:
            "اتاق پیدا نشد."
        }, 404);
      }


      if (
        !this.canAccessRoom(
          room,
          user
        )
      ) {

        if (
          room.type === "vip"
        ) {

          return json({
            ok: false,
            code:
              "VIP_REQUIRED",
            error:
              "برای ورود به این اتاق اشتراک VIP لازم است."
          }, 403);
        }


        return json({
          ok: false,
          code:
            "PRIVATE_ROOM",
          error:
            "این اتاق خصوصی است."
        }, 403);
      }


      this.addRoomMember(
        room.id,
        user.id
      );


      return json({
        ok: true,
        joined: true,
        room
      });
    }


    /* -----------------------------------------------------
       ROOM MESSAGES
    ----------------------------------------------------- */

    if (
      url.pathname.startsWith(
        "/rooms/"
      ) &&
      url.pathname.endsWith(
        "/messages"
      ) &&
      request.method === "GET"
    ) {

      const user =
        this.requireUser(
          request
        );


      if (!user) {

        return json({
          ok: false,
          error:
            "ابتدا وارد حساب شوید."
        }, 401);
      }


      const roomId =
        clean(
          url.pathname
            .replace(
              "/rooms/",
              ""
            )
            .replace(
              "/messages",
              ""
            ),
          100
        );


      const room =
        this.getRoom(
          roomId
        );


      if (
        !this.canAccessRoom(
          room,
          user
        )
      ) {

        return json({
          ok: false,
          error:
            "دسترسی به این اتاق ندارید."
        }, 403);
      }


      return json({
        ok: true,

        messages:
          this.getMessages(
            roomId
          )
      });
    }


    /* =====================================================
       CREATE ROOM
    ===================================================== */

    if (
      url.pathname ===
        "/rooms/create" &&
      request.method === "POST"
    ) {

      const user =
        this.requireUser(
          request
        );


      if (!user) {

        return json({
          ok: false,
          error:
            "ابتدا وارد حساب شوید."
        }, 401);
      }


      const data =
        await request.json();


      const roomType =
        clean(
          data.type,
          20
        );


      if (
        roomType !== "private" &&
        roomType !== "shared"
      ) {

        return json({
          ok: false,
          error:
            "نوع اتاق نامعتبر است."
        }, 400);
      }


      const freshUser =
        this.getUserById(
          user.id
        );


      let credits = 0;


      if (
        roomType === "private"
      ) {

        credits =
          freshUser.privateRoomCredits;
      }


      if (
        roomType === "shared"
      ) {

        credits =
          freshUser.sharedRoomCredits;
      }


      if (
        credits <= 0
      ) {

        return json({
          ok: false,

          code:
            roomType === "private"
              ? "PRIVATE_ROOM_PAYMENT_REQUIRED"
              : "SHARED_ROOM_PAYMENT_REQUIRED",

          error:
            "برای ایجاد این نوع اتاق ابتدا باید هزینه آن پرداخت شود."
        }, 402);
      }


      const name =
        clean(
          data.name,
          60
        );


      const description =
        clean(
          data.description,
          300
        );


      if (
        name.length < 2
      ) {

        return json({
          ok: false,
          error:
            "نام اتاق حداقل ۲ کاراکتر باشد."
        }, 400);
      }


      /* جلوگیری از نام تکراری */

      const sameName =
        this.ctx.storage.sql
          .exec(
            `
            SELECT id
            FROM rooms
            WHERE name = ?
            LIMIT 1
            `,
            name
          )
          .toArray();


      if (
        sameName.length
      ) {

        return json({
          ok: false,
          error:
            "این نام اتاق قبلاً استفاده شده است."
        }, 409);
      }


      let durationDays;


      if (
        roomType === "private"
      ) {

        durationDays =
          Number(
            this.getSetting(
              "private_room_duration_days",
              "30"
            )
          );
      } else {

        durationDays =
          Number(
            this.getSetting(
              "shared_room_duration_days",
              "30"
            )
          );
      }


      const expiresAt =
        now() +
        durationDays *
        24 *
        60 *
        60 *
        1000;


      const roomId =
        roomType +
        "-" +
        uuid();


      /* کم کردن اعتبار */

      if (
        roomType === "private"
      ) {

        this.ctx.storage.sql.exec(
          `
          UPDATE users
          SET private_room_credits =
              private_room_credits - 1
          WHERE id = ?
          AND private_room_credits > 0
          `,
          user.id
        );

      } else {

        this.ctx.storage.sql.exec(
          `
          UPDATE users
          SET shared_room_credits =
              shared_room_credits - 1
          WHERE id = ?
          AND shared_room_credits > 0
          `,
          user.id
        );
      }


      /* ایجاد اتاق */

      this.ctx.storage.sql.exec(
        `
        INSERT INTO rooms
        (
          id,
          name,
          description,
          type,
          owner_id,
          price,
          duration_days,
          expires_at,
          created_at,
          is_active
        )
        VALUES
        (?, ?, ?, ?, ?, 0, ?, ?, ?, 1)
        `,
        roomId,
        name,
        description,
        roomType,
        user.id,
        durationDays,
        expiresAt,
        now()
      );


      this.addRoomMember(
        roomId,
        user.id
      );


      return json({

        ok: true,

        room:
          this.getRoom(
            roomId
          )
      });
    }


    /* =====================================================
       PURCHASES
    ===================================================== */

    if (
      url.pathname ===
        "/purchases" &&
      request.method === "POST"
    ) {

      const user =
        this.requireUser(
          request
        );


      if (!user) {

        return json({
          ok: false,
          error:
            "ابتدا وارد حساب شوید."
        }, 401);
      }


      try {

        const data =
          await request.json();


        const type =
          clean(
            data.type,
            50
          );


        const purchase =
          this.createPurchase(
            user.id,
            type
          );


        return json({
          ok: true,
          purchase
        });

      } catch (error) {

        return json({
          ok: false,
          error:
            error.message ||
            "خطا در ایجاد سفارش."
        }, 400);
      }
    }


    /* -----------------------------------------------------
       USER PURCHASES
    ----------------------------------------------------- */

    if (
      url.pathname ===
        "/purchases" &&
      request.method === "GET"
    ) {

      const user =
        this.requireUser(
          request
        );


      if (!user) {

        return json({
          ok: false,
          error:
            "ابتدا وارد حساب شوید."
        }, 401);
      }


      const purchases =
        this.ctx.storage.sql
          .exec(
            `
            SELECT
              id,
              type,
              amount,
              payment_url,
              status,
              created_at,
              approved_at
            FROM purchases
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 100
            `,
            user.id
          )
          .toArray();


      return json({
        ok: true,
        purchases
      });
    }


    /* =====================================================
       WEBSOCKET
    ===================================================== */

    if (
      url.pathname === "/ws"
    ) {

      if (
        request.headers.get(
          "Upgrade"
        ) !== "websocket"
      ) {

        return new Response(
          "WebSocket required",
          { status: 426 }
        );
      }


      const token =
        clean(
          url.searchParams.get(
            "token"
          ),
          500
        );


      const roomId =
        clean(
          url.searchParams.get(
            "roomId"
          ) ||
          "public-main",
          100
        );


      const user =
        this.getUserFromToken(
          token
        );


      if (!user) {

        return new Response(
          "Unauthorized",
          { status: 401 }
        );
      }


      const room =
        this.getRoom(
          roomId
        );


      if (
        !this.canAccessRoom(
          room,
          user
        )
      ) {

        return new Response(
          "Forbidden",
          { status: 403 }
        );
      }


      this.addRoomMember(
        roomId,
        user.id
      );


      const pair =
        new WebSocketPair();


      const client =
        pair[0];

      const server =
        pair[1];


      this.ctx.acceptWebSocket(
        server
      );


      server.serializeAttachment({

        userId:
          user.id,

        username:
          user.username,

        roomId
      });


      server.send(
        JSON.stringify({

          type:
            "history",

          roomId,

          messages:
            this.getMessages(
              roomId
            )
        })
      );


      this.broadcast(
        {
          type:
            "presence",

          username:
            user.username,

          online:
            true,

          roomId
        },

        roomId,

        server
      );


      return new Response(
        null,
        {
          status: 101,
          webSocket: client
        }
      );
    }


    /* =====================================================
       ADMIN SETTINGS
    ===================================================== */

    if (
      url.pathname ===
        "/admin/settings" &&
      request.method === "GET"
    ) {

      return json({
        ok: true,

        settings:
          this.getPublicSettings()
      });
    }


    if (
      url.pathname ===
        "/admin/settings" &&
      request.method === "PUT"
    ) {

      try {

        const data =
          await request.json();


        const allowed = [

          "vip_price",
          "vip_duration_days",
          "vip_payment_url",

          "private_room_price",
          "private_room_duration_days",
          "private_room_payment_url",

          "shared_room_price",
          "shared_room_duration_days",
          "shared_room_payment_url"

        ];


        for (
          const key
          of allowed
        ) {

          if (
            data[key] !== undefined
          ) {

            let value =
              String(
                data[key]
              );


            if (
              key.endsWith(
                "_price"
              ) ||
              key.endsWith(
                "_days"
              )
            ) {

              const number =
                Number(value);


              if (
                !Number.isFinite(
                  number
                ) ||
                number < 0
              ) {

                return json({
                  ok: false,
                  error:
                    `مقدار ${key} نامعتبر است.`
                }, 400);
              }


              value =
                String(
                  Math.floor(number)
                );
            }


            if (
              key.endsWith(
                "_payment_url"
              ) &&
              value
            ) {

              try {

                const parsed =
                  new URL(value);


                if (
                  parsed.protocol !==
                  "https:"
                ) {

                  return json({
                    ok: false,
                    error:
                      "لینک پرداخت باید HTTPS باشد."
                  }, 400);
                }

              } catch {

                return json({
                  ok: false,
                  error:
                    "لینک پرداخت نامعتبر است."
                }, 400);
              }
            }


            this.setSetting(
              key,
              value
            );
          }
        }


        return json({

          ok: true,

          settings:
            this.getPublicSettings()
        });

      } catch {

        return json({
          ok: false,
          error:
            "تنظیمات نامعتبر است."
        }, 400);
      }
    }


    /* =====================================================
       ADMIN PURCHASE LIST
    ===================================================== */

    if (
      url.pathname ===
        "/admin/purchases" &&
      request.method === "GET"
    ) {

      const purchases =
        this.ctx.storage.sql
          .exec(
            `
            SELECT
              p.id,
              p.user_id,
              u.username,
              p.type,
              p.amount,
              p.payment_url,
              p.status,
              p.created_at,
              p.approved_at
            FROM purchases p
            LEFT JOIN users u
            ON u.id = p.user_id
            ORDER BY
              p.created_at DESC
            LIMIT 500
            `
          )
          .toArray();


      return json({
        ok: true,
        purchases
      });
    }


    /* =====================================================
       ADMIN APPROVE PURCHASE
    ===================================================== */

    if (
      url.pathname.startsWith(
        "/admin/purchase-approve/"
      ) &&
      request.method === "POST"
    ) {

      const purchaseId =
        clean(
          url.pathname.replace(
            "/admin/purchase-approve/",
            ""
          ),
          100
        );


      const purchase =
        this.ctx.storage.sql
          .exec(
            `
            SELECT *
            FROM purchases
            WHERE id = ?
            LIMIT 1
            `,
            purchaseId
          )
          .toArray();


      if (!purchase.length) {

        return json({
          ok: false,
          error:
            "سفارش پیدا نشد."
        }, 404);
      }


      const item =
        purchase[0];


      if (
        item.status ===
        "approved"
      ) {

        return json({
          ok: false,
          error:
            "این سفارش قبلاً تایید شده است."
        }, 409);
      }


      const user =
        this.getUserById(
          item.user_id
        );


      if (!user) {

        return json({
          ok: false,
          error:
            "کاربر پیدا نشد."
        }, 404);
      }


      /* ---------------------------------------------------
         VIP
      --------------------------------------------------- */

      if (
        item.type === "vip"
      ) {

        const duration =
          Number(
            this.getSetting(
              "vip_duration_days",
              "30"
            )
          );


        const current =
          Math.max(
            Number(
              user.vipUntil || 0
            ),
            now()
          );


        const vipUntil =
          current +
          duration *
          24 *
          60 *
          60 *
          1000;


        this.ctx.storage.sql.exec(
          `
          UPDATE users
          SET vip_until = ?
          WHERE id = ?
          `,
          vipUntil,
          item.user_id
        );
      }


      /* ---------------------------------------------------
         Private Room
      --------------------------------------------------- */

      if (
        item.type ===
        "private_room"
      ) {

        this.ctx.storage.sql.exec(
          `
          UPDATE users
          SET private_room_credits =
              private_room_credits + 1
          WHERE id = ?
          `,
          item.user_id
        );
      }


      /* ---------------------------------------------------
         Shared Room
      --------------------------------------------------- */

      if (
        item.type ===
        "shared_room"
      ) {

        this.ctx.storage.sql.exec(
          `
          UPDATE users
          SET shared_room_credits =
              shared_room_credits + 1
          WHERE id = ?
          `,
          item.user_id
        );
      }


      this.ctx.storage.sql.exec(
        `
        UPDATE purchases
        SET
          status = 'approved',
          approved_at = ?
        WHERE id = ?
        `,
        now(),
        purchaseId
      );


      return json({

        ok: true,

        message:
          "پرداخت تایید شد و سرویس کاربر فعال شد.",

        purchase:
          this.ctx.storage.sql
            .exec(
              `
              SELECT *
              FROM purchases
              WHERE id = ?
              `,
              purchaseId
            )
            .toArray()[0]
      });
    }


    /* =====================================================
       ADMIN USERS
    ===================================================== */

    if (
      url.pathname ===
        "/admin/users" &&
      request.method === "GET"
    ) {

      const users =
        this.ctx.storage.sql
          .exec(
            `
            SELECT
              id,
              username,
              is_admin,
              vip_until,
              private_room_credits,
              shared_room_credits,
              created_at
            FROM users
            ORDER BY created_at DESC
            LIMIT 1000
            `
          )
          .toArray();


      return json({
        ok: true,
        users
      });
    }


    /* =====================================================
       DEFAULT
    ===================================================== */

    return new Response(
      "ChatRoom OK"
    );
  }


  /* =======================================================
     WEBSOCKET MESSAGE
  ======================================================= */

  async webSocketMessage(
    ws,
    message
  ) {

    let data;


    try {

      data =
        typeof message ===
        "string"

          ? JSON.parse(
              message
            )

          : JSON.parse(
              new TextDecoder()
                .decode(message)
            );

    } catch {

      ws.send(
        JSON.stringify({
          type:
            "error",

          message:
            "پیام نامعتبر است."
        })
      );

      return;
    }


    const attachment =
      ws.deserializeAttachment() ||
      {};


    const userId =
      attachment.userId;

    const username =
      attachment.username;

    const roomId =
      attachment.roomId;


    if (
      !userId ||
      !username ||
      !roomId
    ) {
      return;
    }


    const user =
      this.getUserById(
        userId
      );


    if (!user) {
      return;
    }


    const room =
      this.getRoom(
        roomId
      );


    if (
      !this.canAccessRoom(
        room,
        user
      )
    ) {

      ws.send(
        JSON.stringify({
          type:
            "error",

          message:
            "دسترسی شما به این اتاق پایان یافته است."
        })
      );


      try {
        ws.close();
      } catch {}


      return;
    }


    if (
      data.type !==
      "message"
    ) {
      return;
    }


    const body =
      clean(
        data.body,
        2000
      );


    if (!body) {
      return;
    }


    const saved =
      this.saveMessage(
        roomId,
        username,
        body
      );


    this.broadcast(
      {
        type:
          "message",

        message:
          saved
      },

      roomId
    );
  }


  /* =======================================================
     WEBSOCKET CLOSE
  ======================================================= */

  async webSocketClose(
    ws
  ) {

    const attachment =
      ws.deserializeAttachment() ||
      {};


    if (
      attachment.username &&
      attachment.roomId
    ) {

      this.broadcast(
        {
          type:
            "presence",

          username:
            attachment.username,

          online:
            false,

          roomId:
            attachment.roomId
        },

        attachment.roomId,

        ws
      );
    }
  }


  async webSocketError(
    ws
  ) {

    try {
      ws.close();
    } catch {}
  }
}


/* =========================================================
   WORKER
========================================================= */

export default {

  async fetch(
    request,
    env
  ) {

    const url =
      new URL(request.url);


    /* =======================================================
       CORS
    ======================================================= */

    if (
      request.method ===
      "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,

          headers: {
            "Access-Control-Allow-Origin":
              "*",

            "Access-Control-Allow-Headers":
              "Content-Type, Authorization, X-Admin-Token",

            "Access-Control-Allow-Methods":
              "GET, POST, PUT, DELETE, OPTIONS"
          }
        }
      );
    }


    /* =======================================================
       HEALTH
    ======================================================= */

    if (
      url.pathname ===
      "/api/health"
    ) {

      return json({

        ok:
          true,

        app:
          "Chat Dorhami",

        version:
          "6.0",

        backend:
          "Cloudflare Durable Object",

        time:
          new Date().toISOString()
      });
    }


    /* =======================================================
       GLOBAL DURABLE OBJECT
    ======================================================= */

    const room =
      env.CHAT_ROOM.get(
        env.CHAT_ROOM.idFromName(
          "global"
        )
      );


    /* =======================================================
       REGISTER
    ======================================================= */

    if (
      url.pathname ===
      "/api/register"
    ) {

      return room.fetch(
        new Request(
          "https://chat/register",
          {
            method:
              request.method,

            headers:
              request.headers,

            body:
              request.method ===
              "GET"

                ? undefined

                : request.body
          }
        )
      );
    }


    /* =======================================================
       LOGIN
    ======================================================= */

    if (
      url.pathname ===
      "/api/login"
    ) {

      return room.fetch(
        new Request(
          "https://chat/login",
          {
            method:
              request.method,

            headers:
              request.headers,

            body:
              request.method ===
              "GET"

                ? undefined

                : request.body
          }
        )
      );
    }


    /* =======================================================
       ME
    ======================================================= */

    if (
      url.pathname ===
      "/api/me"
    ) {

      return room.fetch(
        new Request(
          "https://chat/me",
          {
            method:
              request.method,

            headers:
              request.headers
          }
        )
      );
    }


    /* =======================================================
       SETTINGS
    ======================================================= */

    if (
      url.pathname ===
      "/api/settings"
    ) {

      return room.fetch(
        new Request(
          "https://chat/settings",
          {
            method:
              "GET"
          }
        )
      );
    }


    /* =======================================================
       ROOMS
    ======================================================= */

    if (
      url.pathname ===
      "/api/rooms"
    ) {

      return room.fetch(
        new Request(
          "https://chat/rooms",
          {
            method:
              request.method,

            headers:
              request.headers,

            body:
              request.method ===
              "GET"

                ? undefined

                : request.body
          }
        )
      );
    }


    /* =======================================================
       ROOM ROUTES
    ======================================================= */

    if (
      url.pathname.startsWith(
        "/api/rooms/"
      )
    ) {

      const internal =
        new URL(
          request.url
        );


      internal.pathname =
        internal.pathname.replace(
          "/api",
          ""
        );


      return room.fetch(
        new Request(
          internal,
          {
            method:
              request.method,

            headers:
              request.headers,

            body:
              request.method ===
              "GET"

                ? undefined

                : request.body
          }
        )
      );
    }


    /* =======================================================
       CREATE ROOM
    ======================================================= */

    if (
      url.pathname ===
      "/api/rooms/create"
    ) {

      return room.fetch(
        new Request(
          "https://chat/rooms/create",
          {
            method:
              request.method,

            headers:
              request.headers,

            body:
              request.body
          }
        )
      );
    }


    /* =======================================================
       PURCHASES
    ======================================================= */

    if (
      url.pathname ===
      "/api/purchases"
    ) {

      return room.fetch(
        new Request(
          "https://chat/purchases",
          {
            method:
              request.method,

            headers:
              request.headers,

            body:
              request.method ===
              "GET"

                ? undefined

                : request.body
          }
        )
      );
    }


    /* =======================================================
       ADMIN AUTH
    ======================================================= */

    if (
      url.pathname.startsWith(
        "/api/admin/"
      )
    ) {

      const configured =
        env.ADMIN_TOKEN || "";

      const supplied =
        request.headers.get(
          "X-Admin-Token"
        ) || "";


      if (
        !configured ||
        supplied !== configured
      ) {

        return json({
          ok: false,
          error:
            "دسترسی مدیر مجاز نیست."
        }, 401);
      }


      /* -----------------------------------------------
         ADMIN SETTINGS
      ------------------------------------------------ */

      if (
        url.pathname ===
          "/api/admin/settings"
      ) {

        return room.fetch(
          new Request(
            "https://chat/admin/settings",
            {
              method:
                request.method,

              headers: {
                "Content-Type":
                  "application/json"
              },

              body:
                request.method ===
                "PUT"

                  ? request.body

                  : undefined
            }
          )
        );
      }


      /* -----------------------------------------------
         ADMIN PURCHASES
      ------------------------------------------------ */

      if (
        url.pathname ===
          "/api/admin/purchases"
      ) {

        return room.fetch(
          new Request(
            "https://chat/admin/purchases",
            {
              method:
                "GET"
            }
          )
        );
      }


      /* -----------------------------------------------
         APPROVE PURCHASE
      ------------------------------------------------ */

      if (
        url.pathname.startsWith(
          "/api/admin/purchases/"
        ) &&
        url.pathname.endsWith(
          "/approve"
        )
      ) {

        const purchaseId =
          url.pathname
            .replace(
              "/api/admin/purchases/",
              ""
            )
            .replace(
              "/approve",
              ""
            );


        return room.fetch(
          new Request(
            "https://chat/admin/purchase-approve/" +
              purchaseId,
            {
              method:
                "POST"
            }
          )
        );
      }


      /* -----------------------------------------------
         ADMIN USERS
      ------------------------------------------------ */

      if (
        url.pathname ===
          "/api/admin/users"
      ) {

        return room.fetch(
          new Request(
            "https://chat/admin/users",
            {
              method:
                "GET"
            }
          )
        );
      }
    }


    /* =======================================================
       WEBSOCKET
    ======================================================= */

    if (
      url.pathname ===
      "/ws"
    ) {

      return room.fetch(
        request
      );
    }


    /* =======================================================
       WEBSITE ASSETS
    ======================================================= */

    if (
      env.ASSETS
    ) {

      return env.ASSETS.fetch(
        request
      );
    }


    return new Response(
      "Chat Dorhami is online.",
      {
        status: 200
      }
    );
  }
};
