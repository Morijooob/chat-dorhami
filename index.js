import { ChatRoom } from "./Publicsrc/index-v4.js";
export { ChatRoom };
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const page = new URL(request.url); page.pathname = "/app-v4.html";
      return env.ASSETS.fetch(new Request(page, request));
    }
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/") && url.pathname !== "/ws") return env.ASSETS.fetch(request);
    const objectId = env.CHAT_ROOM.idFromName("chat-dorhami-global");
    const room = env.CHAT_ROOM.get(objectId);
    const target = new URL(request.url);
    if (target.pathname === "/api" || target.pathname.startsWith("/api/")) target.pathname = target.pathname.replace(/^\/api/, "") || "/";
    return room.fetch(new Request(target, request));
  }
};
