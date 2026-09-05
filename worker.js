import originalWorker, { ChatRoom } from "./index.js";

const originalChatFetch = ChatRoom.prototype.fetch;

ChatRoom.prototype.fetch = async function(request) {
  try {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/admin/grant-diamonds") {
      await this.ready;
      const admin = this.getAdminUser(request);
      if (!admin) return new Response(JSON.stringify({ error: "دسترسی غیرمجاز." }), { status: 403, headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" } });
      const body = await request.json().catch(() => ({}));
      const username = String(body.username || "").trim();
      const amount = Number(body.amount);
      if (!username || username.length > 24) return new Response(JSON.stringify({ error: "کاربر نامعتبر است." }), { status: 400, headers: { "content-type": "application/json; charset=UTF-8" } });
      if (username === "Morteza2026") return new Response(JSON.stringify({ error: "حساب مدیر قابل شارژ الماس نیست." }), { status: 400, headers: { "content-type": "application/json; charset=UTF-8" } });
      if (!Number.isInteger(amount) || amount < 1 || amount > 10000) return new Response(JSON.stringify({ error: "مقدار الماس باید عدد صحیح بین ۱ تا ۱۰٬۰۰۰ باشد." }), { status: 400, headers: { "content-type": "application/json; charset=UTF-8" } });
      const exists = this.ctx.storage.sql.exec("SELECT username, diamonds FROM users WHERE username = ? LIMIT 1", username).toArray();
      if (!exists.length) return new Response(JSON.stringify({ error: "کاربر پیدا نشد." }), { status: 404, headers: { "content-type": "application/json; charset=UTF-8" } });
      const current = Number(exists[0].diamonds || 0);
      const next = current + amount;
      this.ctx.storage.sql.exec("UPDATE users SET diamonds = diamonds + ? WHERE username = ?", amount, username);
      return new Response(JSON.stringify({ ok: true, username, addedDiamonds: amount, diamonds: next, admin: admin.username }), { status: 200, headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" } });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: "خطای داخلی سرور", detail: String(error?.message || error) }), { status: 500, headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" } });
  }
  return originalChatFetch.call(this, request);
};

export { ChatRoom };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/admin/grant-diamonds") {
      try {
        const id = env.CHAT_ROOM.idFromName("public-room");
        return await env.CHAT_ROOM.get(id).fetch(request);
      } catch (error) {
        return new Response(JSON.stringify({ error: "اتصال سرور برقرار نشد.", detail: String(error?.message || error) }), { status: 500, headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" } });
      }
    }
    return originalWorker.fetch(request, env, ctx);
  }
};
