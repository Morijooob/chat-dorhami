import { ChatRoom } from "./Publicsrc/index.js";

export { ChatRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const roomId = url.searchParams.get("roomId") || "";
      if (roomId.startsWith("private:")) url.searchParams.set("roomId", "global");
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const asset = await env.ASSETS.fetch(request);
      return new HTMLRewriter()
        .on("head", { element(el) {
          el.append('<script src="/presets.js" defer></script>', { html: true });
          el.append(`<style>
            html,body{background:#050611!important}
            .chat-area{position:relative;overflow:hidden!important;background:
              radial-gradient(circle at 8% 12%,rgba(126,87,255,.42),transparent 27%),
              radial-gradient(circle at 92% 14%,rgba(0,224,255,.28),transparent 25%),
              radial-gradient(circle at 78% 82%,rgba(236,61,255,.24),transparent 30%),
              radial-gradient(circle at 25% 88%,rgba(41,112,255,.18),transparent 27%),
              linear-gradient(135deg,#050615 0%,#0c1230 42%,#160d2d 72%,#050611 100%)!important;}
            .chat-area:before{content:"";position:absolute;inset:0;pointer-events:none;z-index:0;background:
              radial-gradient(circle at 18% 30%,rgba(255,255,255,.12) 0 1px,transparent 2px),
              radial-gradient(circle at 72% 22%,rgba(255,255,255,.10) 0 1px,transparent 2px),
              radial-gradient(circle at 55% 72%,rgba(255,255,255,.08) 0 1px,transparent 2px),
              radial-gradient(circle at 88% 58%,rgba(255,255,255,.09) 0 1px,transparent 2px),
              linear-gradient(115deg,transparent 0%,rgba(255,255,255,.045) 48%,transparent 62%);
              background-size:auto,auto,auto,auto,220% 100%;animation:dorhamiRoomShine 12s linear infinite;}
            .chat-area:after{content:"";position:absolute;inset:0;pointer-events:none;z-index:0;background:linear-gradient(180deg,rgba(255,255,255,.035),transparent 28%,rgba(0,0,0,.16));}
            .chat-area #empty,.chat-area #conversation,.chat-area .messages,.chat-area #messages{background:transparent!important;background-color:transparent!important;}
            .conversation{position:relative;z-index:1;background:transparent!important}
            .conversation>*{position:relative;z-index:2}
            .conversation-header{background:rgba(7,10,24,.58)!important}
            .message-form{background:rgba(10,13,30,.82)!important}
            @keyframes dorhamiRoomShine{from{background-position:0,0,0,0,220% 0}to{background-position:0,0,0,0,-220% 0}}
            .room-card{transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
            .room-card:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(76,67,180,.2)}
            .avatar-upload{cursor:default!important}
            .avatar-presets{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:10px 0 12px}
            .avatar-preset{width:48px;height:48px;border-radius:15px;border:1px solid rgba(255,255,255,.1);background:#171c32;font-size:25px;cursor:pointer;box-shadow:0 5px 16px rgba(0,0,0,.18)}
            .avatar-preset:hover{transform:translateY(-2px);border-color:#8b6cff;background:#202743}
            @media(max-width:520px){.avatar-presets{grid-template-columns:repeat(5,1fr)}.avatar-preset{width:44px;height:44px}}
          </style>`, { html: true });
        } })
        .on("body", { element(el) {
          el.append(`<script>
          (()=>{
            const avatars=['😀','😎','🤩','🥳','😇','😉','🤗','😜','🤔','😍','🥰','😘','😈','🤖','👻','🐱','🐼','🦊','🐯','🐸','🦁','🐵','🐨','🐰','🐙','🦄','🐲','🌟','🔥','💜'];
            function makeAvatarPng(emoji){
              const c=document.createElement('canvas');c.width=256;c.height=256;const x=c.getContext('2d');
              const g=x.createLinearGradient(0,0,256,256);g.addColorStop(0,'#7c5cff');g.addColorStop(1,'#20cfff');x.fillStyle=g;x.fillRect(0,0,256,256);
              x.font='150px sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText(emoji,128,134);return c.toDataURL('image/png');
            }
            async function savePreset(emoji,btn){
              try{btn.disabled=true;btn.textContent='…';const user=JSON.parse(localStorage.getItem('chat_dorhami_user')||'null');if(!user?.id)throw Error('ابتدا وارد حساب شو.');
                const r=await fetch('/api/avatar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:user.id,avatar:makeAvatarPng(emoji)})});const d=await r.json();if(!r.ok)throw Error(d.error||'ذخیره آواتار ناموفق بود');
                localStorage.setItem('chat_dorhami_user',JSON.stringify(d.user));if(typeof updateAvatarUI==='function')updateAvatarUI();const p=document.querySelector('.profile-big');if(p)p.innerHTML='<img class="avatar profile-big avatar-img" src="'+d.user.avatar+'" alt="">';
              }catch(e){alert(e.message||'ذخیره آواتار ناموفق بود')}finally{btn.disabled=false;btn.textContent=emoji}
            }
            function initAvatarPicker(){
              const oldWrap=document.querySelector('.avatar-upload'),input=document.getElementById('avatarInput');
              if(!oldWrap||!input||oldWrap.dataset.presetReady)return;
              oldWrap.dataset.presetReady='1';
              const oldAvatar=oldWrap.querySelector('.profile-big');
              const wrap=document.createElement('div');wrap.className='avatar-upload';
              if(oldAvatar)wrap.appendChild(oldAvatar);
              const title=document.createElement('span');title.textContent='یک آواتار انتخاب کن ✨';wrap.appendChild(title);
              const grid=document.createElement('div');grid.className='avatar-presets';
              avatars.forEach(e=>{const b=document.createElement('button');b.type='button';b.className='avatar-preset';b.textContent=e;b.onclick=ev=>{ev.preventDefault();ev.stopPropagation();savePreset(e,b)};grid.appendChild(b)});
              wrap.appendChild(grid);
              input.style.display='none';wrap.appendChild(input);
              oldWrap.replaceWith(wrap);
            }
            if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initAvatarPicker,{once:true});else initAvatarPicker();
          })();
          </script>`, { html: true });
        } })
        .transform(asset);
    }

    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/") && url.pathname !== "/ws") {
      return env.ASSETS.fetch(request);
    }

    const objectId = env.CHAT_ROOM.idFromName("chat-dorhami-global");
    const room = env.CHAT_ROOM.get(objectId);
    const target = new URL(request.url);
    if (target.pathname === "/ws") {
      const roomId = target.searchParams.get("roomId") || "";
      if (roomId.startsWith("private:")) target.searchParams.set("roomId", "global");
    }
    if (target.pathname === "/api" || target.pathname.startsWith("/api/")) target.pathname = target.pathname.replace(/^\/api/, "") || "/";
    return room.fetch(new Request(target, request));
  }
};
