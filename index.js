import { ChatRoom } from "./Publicsrc/index.js";

export { ChatRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Private realtime chats use the same Durable Object connection, while
    // the message layer still delivers private messages only to the two users.
    if (url.pathname === "/ws") {
      const roomId = url.searchParams.get("roomId") || "";
      if (roomId.startsWith("private:")) url.searchParams.set("roomId", "global");
    }

    // Inject lightweight UI enhancements without changing the existing HTML shell.
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const asset = await env.ASSETS.fetch(request);
      return new HTMLRewriter()
        .on("head", { element(el) {
          el.append('<script src="/presets.js" defer></script>', { html: true });
          el.append('<style>body{background:#070a18!important}.chat-main,.conversation,.messages,.chat-empty{background:radial-gradient(circle at 20% 15%,rgba(91,76,220,.18),transparent 34%),radial-gradient(circle at 85% 75%,rgba(0,210,255,.12),transparent 32%),linear-gradient(135deg,#080b1c 0%,#10152d 48%,#080b19 100%)!important}.chat-main:before,.conversation:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(120deg,transparent 0%,rgba(255,255,255,.025) 45%,transparent 70%);background-size:220% 100%;animation:dorhamiShine 9s linear infinite}@keyframes dorhamiShine{from{background-position:220% 0}to{background-position:-220% 0}}.room-card{transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}.room-card:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(76,67,180,.2)}</style>', { html: true });
        } })
        .transform(asset);
    }

    if (
      url.pathname !== "/api" &&
      !url.pathname.startsWith("/api/") &&
      url.pathname !== "/ws"
    ) {
      return env.ASSETS.fetch(request);
    }

    const objectId = env.CHAT_ROOM.idFromName("chat-dorhami-global");
    const room = env.CHAT_ROOM.get(objectId);

    const target = new URL(request.url);
    if (target.pathname === "/api" || target.pathname.startsWith("/api/")) {
      target.pathname = target.pathname.replace(/^\/api/, "") || "/";
    }

    return room.fetch(new Request(target, request));
  }
};
