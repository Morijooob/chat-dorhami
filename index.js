import { ChatRoom } from "./Publicsrc/index.js";

export { ChatRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Realtime chat is handled by the Durable Object. Do NOT rewrite
    // private:<userId> room IDs to global: the frontend uses that value
    // to keep each socket's conversation context isolated.

    // Inject UI enhancements without changing the existing HTML shell.
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const asset = await env.ASSETS.fetch(request);
      return new HTMLRewriter()
        .on("head", { element(el) {
          el.append('<script src="/presets.js" defer></script>', { html: true });
          el.append(`<style>
            html,body{background:#070816!important}
            .chat-area{position:relative;overflow:hidden;background:
              radial-gradient(circle at 12% 18%,rgba(111,76,255,.28),transparent 30%),
              radial-gradient(circle at 88% 22%,rgba(0,211,255,.20),transparent 28%),
              radial-gradient(circle at 72% 88%,rgba(226,67,255,.16),transparent 32%),
              linear-gradient(145deg,#070918 0%,#10152d 45%,#090b1d 100%)!important;
            }
            .chat-area:before{content:"";position:absolute;inset:0;pointer-events:none;background:
              radial-gradient(circle at 50% 45%,rgba(255,255,255,.045),transparent 42%),
              linear-gradient(115deg,transparent 0%,rgba(255,255,255,.035) 48%,transparent 62%);
              background-size:auto,220% 100%;animation:dorhamiRoomShine 10s linear infinite;
            }
            .conversation{position:relative;background:transparent!important}
            .conversation>*{position:relative;z-index:1}
            .messages{background:transparent!important}
            @keyframes dorhamiRoomShine{from{background-position:0,220% 0}to{background-position:0,-220% 0}}
            .room-card{transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
            .room-card:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(76,67,180,.2)}
          </style>`, { html: true });
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
