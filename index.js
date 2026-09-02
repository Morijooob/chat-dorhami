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
            :root{--bg:#f4eee6!important;--panel:#fffaf2!important;--panel2:#f1eafa!important;--card:#fffdf8!important;--line:rgba(104,77,128,.14)!important;--text:#3b3047!important;--muted:#7d7085!important;--primary:#b78b45!important;--blue:#9a78cf!important;--bubble:#b78b45!important}
            html,body{background:#f6f0e7!important;color:#3b3047!important}
            body{background:radial-gradient(circle at 10% 10%,rgba(205,169,99,.20),transparent 28%),radial-gradient(circle at 90% 20%,rgba(170,139,220,.20),transparent 30%),linear-gradient(135deg,#fcf8ef,#f1e9f8)!important}
            .app{background:linear-gradient(135deg,#fcf8ef 0%,#f5edf8 52%,#ede4f5 100%)!important}
            .auth-screen{background:radial-gradient(circle at 12% 15%,rgba(198,157,79,.22),transparent 30%),radial-gradient(circle at 88% 18%,rgba(158,124,210,.20),transparent 32%),linear-gradient(135deg,#fcf8ef,#f1e9f8)!important}
            .auth-card,.modal-card{background:rgba(255,253,248,.90)!important;border-color:rgba(183,139,69,.22)!important;box-shadow:0 25px 75px rgba(78,57,94,.16)!important;color:#3b3047!important}
            .brand-name,.welcome h1,.profile-text strong,.section-head,.modal-card h3,.settings-title{color:#49365a!important}
            .brand-subtitle,.welcome p,.auth-footer,.settings-sub,.modal-card p,.section-head .mini-label{color:#81738b!important}
            .tabs{background:#eee7f4!important}.tabs button{color:#81748b!important}.tabs button.active{background:linear-gradient(135deg,#b78b45,#d1ad69)!important;color:#fff!important}
            .auth-form input,.modal-card input,.search-box,.message-form{background:rgba(255,255,255,.80)!important;color:#3b3047!important;border-color:rgba(104,77,128,.14)!important}
            .auth-form label span{color:#66566f!important}.primary,.send-button{background:linear-gradient(135deg,#b78b45,#d0ad6b)!important;color:#fff!important}
            .chat{background:#f1eaf5!important}.sidebar{background:linear-gradient(180deg,#fffdf8,#f3ebf8)!important;border-color:rgba(183,139,69,.18)!important;box-shadow:-15px 0 45px rgba(82,61,99,.08)!important}
            .sidebar-header,.welcome-mini,.side-nav,.chat-panel,.people-panel,.sidebar-bottom{background:transparent!important}.welcome-mini{background:linear-gradient(135deg,rgba(183,139,69,.10),rgba(155,122,209,.10))!important;border-color:rgba(183,139,69,.18)!important}
            .nav-item{color:#887b91!important}.nav-item.active{color:#5b466d!important;background:#ebe3f2!important}.icon-button,.section-head button,.sidebar-bottom button,.tool-btn{background:#eee7f2!important;color:#695777!important}
            .search-box input,.message-form input{color:#3b3047!important}.search-box input::placeholder,.message-form input::placeholder{color:#998ca0!important}
            .room-card,.user-item,.history-item{color:#49384f!important;background:rgba(255,255,255,.65)!important}.room-card:hover,.user-item:hover,.history-item:hover,.room-card.active{background:linear-gradient(135deg,rgba(183,139,69,.13),rgba(155,122,209,.13))!important;border-color:rgba(183,139,69,.25)!important}
            .room-icon{background:rgba(183,139,69,.13)!important}.room-info small,.history-info small,.user-info small,.emptyHistory,.emptyUsers{color:#887b91!important}
            .chat-area{position:relative!important;overflow:hidden!important;background:radial-gradient(circle at 12% 10%,rgba(207,166,91,.30),transparent 28%),radial-gradient(circle at 88% 18%,rgba(174,143,224,.30),transparent 30%),radial-gradient(circle at 70% 84%,rgba(204,184,232,.30),transparent 32%),linear-gradient(135deg,#fffaf0 0%,#f5edf9 50%,#ece3f5 100%)!important}
            .chat-area:before{content:"";position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(circle at 18% 25%,rgba(183,139,69,.16) 0 2px,transparent 3px),radial-gradient(circle at 74% 30%,rgba(155,122,209,.14) 0 2px,transparent 3px),linear-gradient(115deg,transparent 30%,rgba(255,255,255,.55),transparent 70%);background-size:auto,auto,220% 100%;animation:dorhamiLightShine 16s linear infinite}
            .chat-area:after{content:"";position:absolute;inset:0;pointer-events:none;z-index:0;background:linear-gradient(180deg,rgba(255,255,255,.22),transparent 45%,rgba(100,70,125,.04))}
            #empty,#conversation,.messages,#messages{background:transparent!important;background-color:transparent!important}.conversation{position:relative;z-index:1;background:transparent!important}.conversation>*{position:relative;z-index:2}
            .conversation-header{background:rgba(255,252,246,.78)!important;border-color:rgba(183,139,69,.16)!important;color:#49365a!important}.message-form{background:rgba(255,252,246,.88)!important;border-color:rgba(183,139,69,.18)!important;backdrop-filter:blur(14px)}
            .message.theirs .messageBody{background:rgba(255,255,255,.84)!important;color:#493b50!important;border-color:rgba(125,93,150,.10)!important}.message.mine .messageBody{background:linear-gradient(135deg,#b78b45,#d0ad69)!important;color:#fff!important;box-shadow:0 8px 25px rgba(183,139,69,.20)!important}
            .empty h2{color:#4b3859!important}.empty p{color:#7d7085!important}.empty-logo{background:linear-gradient(135deg,#b78b45,#9a78cf)!important;box-shadow:0 18px 50px rgba(131,95,155,.20)!important}.empty-action{background:linear-gradient(135deg,#b78b45,#d0ad69)!important}.empty-action.secondary{background:rgba(255,255,255,.75)!important;color:#654d73!important}
            .modal{background:rgba(75,55,87,.25)!important;backdrop-filter:blur(8px)}.profile-big{border:3px solid rgba(183,139,69,.48)!important;box-shadow:0 8px 25px rgba(183,139,69,.16)!important}
            .avatar-upload{cursor:default!important}.avatar-upload>span{color:#806f89!important}.avatar-upload input{display:none!important}.avatar-presets{display:grid!important;grid-template-columns:repeat(6,1fr)!important;gap:9px!important;margin:12px 0!important}.avatar-preset{width:48px!important;height:48px!important;border-radius:15px!important;border:1px solid rgba(183,139,69,.20)!important;background:linear-gradient(145deg,#fff,#f1e8f8)!important;color:#49365a!important;font-size:25px!important;cursor:pointer!important;box-shadow:0 5px 16px rgba(80,60,100,.08)!important}.avatar-preset:hover{transform:translateY(-2px) scale(1.04)!important;border-color:#b78b45!important}.avatar-preset:disabled{opacity:.65}.avatar-img{object-fit:cover!important;border-radius:50%!important}
            @keyframes dorhamiLightShine{from{background-position:0,0,220% 0}to{background-position:0,0,-220% 0}}
            @media(max-width:520px){.avatar-presets{grid-template-columns:repeat(5,1fr)!important}.avatar-preset{width:44px!important;height:44px!important}}
          </style>`, { html: true });
        } })
        .on("body", { element(el) {
          el.append(`<script>
          (()=>{
            const avatars=['😀','😎','🤩','🥳','😇','😉','🤗','😜','🤔','😍','🥰','😘','😈','🤖','👻','🐱','🐼','🦊','🐯','🐸','🦁','🐵','🐨','🐰','🐙','🦄','🐲','🌟','🔥','💜','💙','✨','🌸','🌙','🦋','🍀','🎀','👑'];
            function makeAvatarPng(emoji){const c=document.createElement('canvas');c.width=256;c.height=256;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,256,256);g.addColorStop(0,'#b78b45');g.addColorStop(1,'#9a78cf');x.fillStyle=g;x.fillRect(0,0,256,256);x.font='150px sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText(emoji,128,134);return c.toDataURL('image/png')}
            async function savePreset(emoji,btn){try{btn.disabled=true;const user=JSON.parse(localStorage.getItem('chat_dorhami_user')||'null');if(!user?.id)throw Error('ابتدا وارد حساب شو.');const r=await fetch('/api/avatar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:user.id,avatar:makeAvatarPng(emoji)})});const d=await r.json();if(!r.ok)throw Error(d.error||'ذخیره آواتار ناموفق بود');localStorage.setItem('chat_dorhami_user',JSON.stringify(d.user));window.currentUser=d.user;if(typeof updateAvatarUI==='function')updateAvatarUI();document.querySelectorAll('.profile-big').forEach(p=>{p.innerHTML='';const img=document.createElement('img');img.className='avatar profile-big avatar-img';img.src=d.user.avatar;img.alt='';p.replaceWith(img)});document.querySelector('.me-avatar')?.setAttribute('src',d.user.avatar)}catch(e){alert(e.message||'ذخیره آواتار ناموفق بود')}finally{btn.disabled=false}}
            function initAvatarPicker(){const oldWrap=document.querySelector('.avatar-upload');if(!oldWrap||oldWrap.dataset.presetReady)return;const input=document.getElementById('avatarInput');if(input){input.onclick=e=>{e.preventDefault();e.stopPropagation();return false};input.addEventListener('click',e=>{e.preventDefault();e.stopPropagation()})}oldWrap.dataset.presetReady='1';const oldAvatar=oldWrap.querySelector('.profile-big');const wrap=document.createElement('div');wrap.className='avatar-upload';if(oldAvatar)wrap.appendChild(oldAvatar);const title=document.createElement('span');title.textContent='یک آواتار انتخاب کن ✨';wrap.appendChild(title);const grid=document.createElement('div');grid.className='avatar-presets';avatars.forEach(e=>{const b=document.createElement('button');b.type='button';b.className='avatar-preset';b.textContent=e;b.setAttribute('aria-label','آواتار '+e);b.onclick=ev=>{ev.preventDefault();ev.stopPropagation();savePreset(e,b)};grid.appendChild(b)});wrap.appendChild(grid);if(input)wrap.appendChild(input);oldWrap.replaceWith(wrap)}
            function boot(){initAvatarPicker();setTimeout(initAvatarPicker,300);setTimeout(initAvatarPicker,1000)}
            if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
          })();
          </script>`, { html: true });
        } })
        .transform(asset);
    }

    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/") && url.pathname !== "/ws") return env.ASSETS.fetch(request);

    const objectId = env.CHAT_ROOM.idFromName("chat-dorhami-global");
    const room = env.CHAT_ROOM.get(objectId);
    const target = new URL(request.url);
    if (target.pathname === "/ws") { const roomId = target.searchParams.get("roomId") || ""; if (roomId.startsWith("private:")) target.searchParams.set("roomId", "global"); }
    if (target.pathname === "/api" || target.pathname.startsWith("/api/")) target.pathname = target.pathname.replace(/^\/api/, "") || "/";
    return room.fetch(new Request(target, request));
  }
};
