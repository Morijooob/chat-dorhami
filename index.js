import { ChatRoom } from "./Publicsrc/backend-v6.js";
export { ChatRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Always serve the new standalone entry page and prevent an old cached
    // HTML shell from bringing back the broken login/register UI.
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const target = new URL(url);
      target.pathname = "/index.html";
      const response = await env.ASSETS.fetch(new Request(target, request));
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      headers.set("Pragma", "no-cache");
      headers.set("Expires", "0");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/") && url.pathname !== "/ws") {
      return env.ASSETS.fetch(request);
    }

    const objectId = env.CHAT_ROOM.idFromName("chat-dorhami-global");
    const room = env.CHAT_ROOM.get(objectId);
    const target = new URL(url);

    if (target.pathname === "/api" || target.pathname.startsWith("/api/")) {
      target.pathname = target.pathname.replace(/^\/api/, "") || "/";
    }

    return room.fetch(new Request(target, request));
  }
};
