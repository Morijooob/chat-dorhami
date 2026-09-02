import { ChatRoom } from "./Publicsrc/backend-v6.js";
export { ChatRoom };

const AUTH_FALLBACK = `
<script>
(()=>{
  const boot=()=>{
    const form=document.getElementById('authForm');
    const userEl=document.getElementById('username');
    const passEl=document.getElementById('password');
    const msg=document.getElementById('authMessage');
    const btn=document.getElementById('authSubmit');
    if(!form||!userEl||!passEl||!msg||!btn)return;
    let mode='login';
    const setMsg=t=>{msg.textContent=t||''};
    document.addEventListener('click',e=>{
      const b=e.target.closest('.tabs button[data-mode]');
      if(!b)return;
      mode=b.dataset.mode==='register'?'register':'login';
    },true);
    document.addEventListener('submit',async e=>{
      if(e.target!==form)return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const username=userEl.value.trim(),password=passEl.value;
      if(!/^[\\p{L}\\p{N}_]{3,24}$/u.test(username))return setMsg('نام کاربری باید ۳ تا ۲۴ حرف، عدد یا _ باشد.');
      if(password.length<4)return setMsg('رمز عبور حداقل ۴ کاراکتر باشد.');
      btn.disabled=true;setMsg('در حال بررسی...');
      try{
        const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password));
        const passwordHash=[...new Uint8Array(data)].map(x=>x.toString(16).padStart(2,'0')).join('');
        const r=await fetch('/api/'+mode,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,passwordHash})});
        let d={};try{d=await r.json()}catch{}
        if(!r.ok)throw new Error(d.error||'عملیات انجام نشد.');
        if(!d.user||!d.user.id)throw new Error('پاسخ نامعتبر از سرور دریافت شد.');
        localStorage.setItem('dorhami_user',JSON.stringify(d.user));
        location.reload();
      }catch(err){setMsg(err&&err.message?err.message:'ارتباط با سرور برقرار نشد.');btn.disabled=false}
    },true);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
</script>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const target = new URL(url);
      target.pathname = "/index.html";
      const response = await env.ASSETS.fetch(new Request(target, request));
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      headers.set("Pragma", "no-cache");
      headers.set("Expires", "0");
      const type = headers.get("content-type") || "";
      if (type.includes("text/html")) {
        const html = await response.text();
        const patched = html.replace(/<\/body>\s*<\/html>\s*$/i, AUTH_FALLBACK + "</body></html>");
        return new Response(patched, { status: response.status, statusText: response.statusText, headers });
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/") && url.pathname !== "/ws") return env.ASSETS.fetch(request);
    const objectId = env.CHAT_ROOM.idFromName("chat-dorhami-global");
    const room = env.CHAT_ROOM.get(objectId);
    const target = new URL(url);
    if (target.pathname === "/api" || target.pathname.startsWith("/api/")) target.pathname = target.pathname.replace(/^\/api/, "") || "/";
    return room.fetch(new Request(target, request));
  }
};
