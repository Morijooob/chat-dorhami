import originalWorker, { ChatRoom } from "./index.js";

const originalChatFetch = ChatRoom.prototype.fetch;
const apiJson = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" } });

ChatRoom.prototype.fetch = async function(request) {
  try {
    const url = new URL(request.url);
    if ((request.method === "POST" && url.pathname === "/admin/grant-diamonds") || (request.method === "GET" && url.pathname === "/admin/user-wallet")) {
      await this.ready;
      const admin = this.getAdminUser(request);
      if (!admin) return apiJson({ error: "دسترسی غیرمجاز." }, 403);
      if (request.method === "GET") {
        const username = String(url.searchParams.get("username") || "").trim();
        if (!username || username.length > 24) return apiJson({ error: "کاربر نامعتبر است." }, 400);
        const rows = this.ctx.storage.sql.exec("SELECT username, diamonds FROM users WHERE username = ? LIMIT 1", username).toArray();
        if (!rows.length) return apiJson({ error: "کاربر پیدا نشد." }, 404);
        return apiJson({ ok: true, username, diamonds: Number(rows[0].diamonds || 0) });
      }
      const body = await request.json().catch(() => ({}));
      const username = String(body.username || "").trim();
      const amount = Number(body.amount);
      if (!username || username.length > 24) return apiJson({ error: "کاربر نامعتبر است." }, 400);
      if (username === "Morteza2026") return apiJson({ error: "حساب مدیر قابل شارژ الماس نیست." }, 400);
      if (!Number.isInteger(amount) || amount < 1 || amount > 10000) return apiJson({ error: "مقدار الماس باید عدد صحیح بین ۱ تا ۱۰٬۰۰۰ باشد." }, 400);
      const exists = this.ctx.storage.sql.exec("SELECT username, diamonds FROM users WHERE username = ? LIMIT 1", username).toArray();
      if (!exists.length) return apiJson({ error: "کاربر پیدا نشد." }, 404);
      const current = Number(exists[0].diamonds || 0);
      const result = this.ctx.storage.sql.exec("UPDATE users SET diamonds = diamonds + ? WHERE username = ?", amount, username);
      if (!Number(result.rowsWritten || 0)) return apiJson({ error: "شارژ الماس انجام نشد." }, 500);
      return apiJson({ ok: true, username, addedDiamonds: amount, diamonds: current + amount, admin: admin.username });
    }
  } catch (error) {
    return apiJson({ error: "خطای داخلی سرور", detail: String(error?.message || error) }, 500);
  }
  return originalChatFetch.call(this, request);
};

export { ChatRoom };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if ((request.method === "POST" && url.pathname === "/admin/grant-diamonds") || (request.method === "GET" && url.pathname === "/admin/user-wallet")) {
      try {
        const id = env.CHAT_ROOM.idFromName("public-room");
        return await env.CHAT_ROOM.get(id).fetch(request);
      } catch (error) {
        return apiJson({ error: "اتصال سرور برقرار نشد.", detail: String(error?.message || error) }, 500);
      }
    }
    return originalWorker.fetch(request, env, ctx);
  }
};
