import originalWorker, { ChatRoom } from "./index.js";

const originalChatFetch = ChatRoom.prototype.fetch;
const apiJson = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=UTF-8", "cache-control": "no-store" } });

ChatRoom.prototype.fetch = async function(request) {
  try {
    const url = new URL(request.url);
    const isAdminRoute = (request.method === "POST" && (url.pathname === "/admin/grant-diamonds" || url.pathname === "/admin/delete-user")) || (request.method === "GET" && (url.pathname === "/admin/user-wallet" || url.pathname === "/admin/users"));
    if (isAdminRoute) {
      await this.ready;
      const admin = this.getAdminUser(request);
      if (!admin) return apiJson({ error: "دسترسی غیرمجاز." }, 403);

      if (request.method === "GET" && url.pathname === "/admin/users") {
        const rows = this.ctx.storage.sql.exec("SELECT username, avatar, role, is_starred, is_blocked, is_crowned, is_diamond, is_vip, vip_expires_at, flowers, diamonds, created_at FROM users ORDER BY created_at ASC, username COLLATE NOCASE").toArray();
        return apiJson({ ok: true, count: rows.length, users: rows });
      }

      if (request.method === "POST" && url.pathname === "/admin/delete-user") {
        const body = await request.json().catch(() => ({}));
        const username = String(body.username || "").trim();
        if (!username || username.length > 24) return apiJson({ error: "کاربر نامعتبر است." }, 400);
        if (username === "Morteza2026") return apiJson({ error: "حساب مدیر قابل حذف نیست." }, 400);

        const exists = this.ctx.storage.sql.exec("SELECT username, role FROM users WHERE username = ? LIMIT 1", username).toArray();
        if (!exists.length) return apiJson({ error: "کاربر پیدا نشد." }, 404);
        if (String(exists[0].role || "").trim() === "admin") return apiJson({ error: "حساب مدیر قابل حذف نیست." }, 403);

        try {
          this.ctx.storage.sql.exec("BEGIN");
          this.ctx.storage.sql.exec("DELETE FROM sessions WHERE username = ?", username);
          this.ctx.storage.sql.exec("DELETE FROM private_reads WHERE username = ? OR other_user = ?", username, username);
          this.ctx.storage.sql.exec("DELETE FROM private_messages WHERE sender = ? OR recipient = ?", username, username);
          this.ctx.storage.sql.exec("DELETE FROM presence WHERE username = ?", username);
          this.ctx.storage.sql.exec("DELETE FROM message_reactions WHERE username = ?", username);
          this.ctx.storage.sql.exec("DELETE FROM room_bans WHERE username = ?", username);
          this.ctx.storage.sql.exec("DELETE FROM room_members WHERE username = ?", username);
          this.ctx.storage.sql.exec("DELETE FROM room_messages WHERE sender = ?", username);
          this.ctx.storage.sql.exec("DELETE FROM voice_files WHERE username = ?", username);
          this.ctx.storage.sql.exec("DELETE FROM messages WHERE username = ?", username);
          this.ctx.storage.sql.exec("DELETE FROM room_members WHERE room_id IN (SELECT id FROM private_rooms WHERE owner = ?)", username);
          this.ctx.storage.sql.exec("DELETE FROM room_bans WHERE room_id IN (SELECT id FROM private_rooms WHERE owner = ?)", username);
          this.ctx.storage.sql.exec("DELETE FROM room_messages WHERE room_id IN (SELECT id FROM private_rooms WHERE owner = ?)", username);
          this.ctx.storage.sql.exec("DELETE FROM private_rooms WHERE owner = ?", username);
          const result = this.ctx.storage.sql.exec("DELETE FROM users WHERE username = ?", username);
          if (!Number(result.rowsWritten || 0)) {
            this.ctx.storage.sql.exec("ROLLBACK");
            return apiJson({ error: "حذف کاربر انجام نشد." }, 500);
          }
          this.ctx.storage.sql.exec("COMMIT");
          return apiJson({ ok: true, deleted: username, message: "کاربر با موفقیت حذف شد." });
        } catch (error) {
          try { this.ctx.storage.sql.exec("ROLLBACK"); } catch (rollbackError) {}
          throw error;
        }
      }

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

const withAdminDeleteHandler = async (request, response) => {
  const url = new URL(request.url);
  if (request.method !== "GET" || !(url.pathname === "/admin-users" || url.pathname === "/admin-users.html")) return response;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/html")) return response;
  const html = await response.text();
  const script = `<script>(function(){document.addEventListener("click",async function(event){const button=event.target.closest("#deleteBtn");if(!button||button.disabled)return;event.preventDefault();event.stopPropagation();const selected=document.querySelector("#modalName");const username=(selected&&selected.textContent||"").trim();if(!username||username==="Morteza2026")return;if(!confirm("⚠️ آیا مطمئنی می‌خواهی کاربر «"+username+"» را حذف کنی؟"))return;if(!confirm("🚨 این کار قابل بازگشت نیست و اطلاعات وابسته این کاربر نیز حذف می‌شود. ادامه می‌دهی؟"))return;button.disabled=true;try{const response=await fetch("/admin/delete-user",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({username:username})});const data=await response.json().catch(function(){return{};});if(!response.ok||!data.ok)throw new Error(data.error||"حذف کاربر انجام نشد.");alert("✅ "+(data.message||"کاربر با موفقیت حذف شد."));location.reload();}catch(error){button.disabled=false;alert("❌ "+(error&&error.message||"خطا در حذف کاربر."));}});})();</script>`;
  if (!html.toLowerCase().includes("</body>")) return response;
  const headers = new Headers(response.headers);
  return new Response(html.replace(/<\/body>/i, script + "</body>"), { status: response.status, statusText: response.statusText, headers });
};

export { ChatRoom };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if ((request.method === "POST" && (url.pathname === "/admin/grant-diamonds" || url.pathname === "/admin/delete-user")) || (request.method === "GET" && (url.pathname === "/admin/user-wallet" || url.pathname === "/admin/users"))) {
      try {
        const id = env.CHAT_ROOM.idFromName("public-room");
        return await env.CHAT_ROOM.get(id).fetch(request);
      } catch (error) {
        return apiJson({ error: "اتصال سرور برقرار نشد.", detail: String(error?.message || error) }, 500);
      }
    }
    const response = await originalWorker.fetch(request, env, ctx);
    return await withAdminDeleteHandler(request, response);
  }
};
