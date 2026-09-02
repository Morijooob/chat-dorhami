(()=>{
'use strict';

const PRESETS=['😀','😎','🤩','🥳','😇','😉','🤗','😜','😍','🥰','😘','😈','🤖','👻','🐱','🐼','🦊','🐯','🦁','🐰','🐙','🦄','🐲','🌟','🔥','💜','💙','✨','🌸','🌙','🦋','🍀','🎀','👑'];
const MARK='__DORHAMI_READ__:';
const user=()=>{try{return JSON.parse(localStorage.getItem('chat_dorhami_user')||'null')}catch{return null}};

function makeAvatar(emoji){
  const c=document.createElement('canvas');c.width=256;c.height=256;
  const x=c.getContext('2d');
  const g=x.createLinearGradient(0,0,256,256);g.addColorStop(0,'#b78b45');g.addColorStop(1,'#9a78cf');
  x.fillStyle=g;x.fillRect(0,0,256,256);x.font='145px "Noto Color Emoji","Segoe UI Emoji",sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText(emoji,128,132);
  return c.toDataURL('image/png');
}

function applyAvatar(src){
  document.querySelectorAll('.me-avatar,.profile-big,.conversation-avatar').forEach(el=>{
    if(!el)return;
    if(el.classList.contains('conversation-avatar'))return;
    if(el.tagName==='IMG'){el.src=src;return}
    const img=document.createElement('img');img.className=el.className+' avatar-img';img.src=src;img.alt='';el.replaceWith(img);
  });
}

async function saveAvatar(emoji,button){
  const u=user();if(!u?.id)return alert('ابتدا وارد حساب شو.');
  button.disabled=true;
  try{
    const r=await fetch('/api/avatar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:u.id,avatar:makeAvatar(emoji)})});
    const d=await r.json();if(!r.ok)throw Error(d.error||'ذخیره آواتار ناموفق بود');
    localStorage.setItem('chat_dorhami_user',JSON.stringify(d.user));
    applyAvatar(d.user.avatar);
    document.querySelector('.avatar-picker-modal')?.remove();
  }catch(e){alert(e.message||'خطا در ذخیره آواتار')}finally{button.disabled=false}
}

function openAvatarPicker(){
  if(document.querySelector('.avatar-picker-modal'))return;
  const modal=document.createElement('div');modal.className='modal avatar-picker-modal';
  const card=document.createElement('div');card.className='modal-card avatar-picker-card';
  card.innerHTML='<button class="modal-close" type="button">×</button><div class="modal-icon">🎭</div><h3>انتخاب آواتار</h3><p>یک آواتار انتخاب کن ✨</p><div class="preset-grid"></div><small class="preset-note">آواتار جدید بلافاصله ذخیره می‌شود ❤️</small>';
  modal.appendChild(card);document.body.appendChild(modal);
  card.querySelector('.modal-close').onclick=()=>modal.remove();modal.onclick=e=>{if(e.target===modal)modal.remove()};
  const grid=card.querySelector('.preset-grid');
  PRESETS.forEach(emoji=>{const b=document.createElement('button');b.type='button';b.className='preset-avatar';b.textContent=emoji;b.setAttribute('aria-label','انتخاب '+emoji);b.onclick=()=>saveAvatar(emoji,b);grid.appendChild(b)});
}

function installAvatar(){
  const label=document.querySelector('.avatar-upload');
  const input=document.getElementById('avatarInput');
  if(input){input.style.display='none';input.disabled=true;input.onchange=null;input.onclick=e=>{e.preventDefault();e.stopPropagation()};}
  if(label){label.style.cursor='pointer';label.onclick=e=>{e.preventDefault();e.stopPropagation();openAvatarPicker()};const s=label.querySelector('span');if(s)s.textContent='🎭 انتخاب آواتار';}
  const profile=document.getElementById('profileBtn');
  if(profile&&!profile.dataset.avatarBound){profile.dataset.avatarBound='1';profile.addEventListener('click',()=>setTimeout(openAvatarPicker,80));}
}

function addTick(node,read){
  if(!node||node.querySelector('.read-tick'))return;
  const t=document.createElement('span');t.className='read-tick'+(read?' read':'');t.textContent=read?'✓✓':'✓';node.appendChild(t);
}
function markTick(id){
  if(!id)return;
  let n=document.querySelector('[data-message-id="'+CSS.escape(String(id))+'"]');
  if(n){const t=n.querySelector('.read-tick');if(t){t.textContent='✓✓';t.classList.add('read')}else addTick(n,true)}
}

function wrapWebSocket(){
  if(window.__dorhamiWSWrapped)return;window.__dorhamiWSWrapped=true;
  const proto=WebSocket.prototype;
  const desc=Object.getOwnPropertyDescriptor(proto,'onmessage');
  try{
    Object.defineProperty(proto,'onmessage',{
      configurable:true,
      get(){return this.__dorhamiOnMessage||null},
      set(fn){
        this.__dorhamiOnMessage=typeof fn==='function'?((ev)=>handleSocketEvent(this,fn,ev)):fn;
      }
    });
  }catch{return}
  if(desc&&desc.get)proto.__dorhamiOriginalOnMessageDescriptor=desc;
}

function peerFromSocket(ws){
  try{const u=new URL(ws.url);const r=u.searchParams.get('roomId')||'';return r.startsWith('private:')?r.slice(8):null}catch{return null}
}
function handleSocketEvent(ws,original,ev){
  let d=null;try{d=JSON.parse(ev.data)}catch{}
  if(d?.type==='private_message'){
    const m=d.message||{};
    if(String(m.body||'').startsWith(MARK)){
      markTick(String(m.body).slice(MARK.length));
      return;
    }
    original(ev);
    setTimeout(()=>{
      const nodes=[...document.querySelectorAll('.message')];
      const node=nodes[nodes.length-1];
      if(node&&m.id){node.dataset.messageId=m.id;if(String(m.sender_id)===String(user()?.id))addTick(node,false);else if(peerFromSocket(ws)===String(m.sender_id)){sendRead(ws,m.id);}}
    },0);
    return;
  }
  original(ev);
}
function sendRead(ws,id){
  if(ws?.readyState===WebSocket.OPEN&&id)try{ws.send(JSON.stringify({type:'private_message',receiverId:peerFromSocket(ws),body:MARK+id}))}catch{}
}

function observeMessages(){
  const c=document.getElementById('messages');if(!c||c.dataset.receiptsReady)return;c.dataset.receiptsReady='1';
  const obs=new MutationObserver(()=>{
    const u=user();if(!u)return;
    const wsList=[];
    try{if(window.__dorhamiSockets)wsList.push(...window.__dorhamiSockets)}catch{}
    c.querySelectorAll('.message').forEach(n=>{
      if(n.classList.contains('mine')&&!n.dataset.messageId)addTick(n,false);
    });
  });obs.observe(c,{childList:true,subtree:true});
}

function trackSockets(){
  if(window.__dorhamiSocketTrack)return;window.__dorhamiSocketTrack=true;window.__dorhamiSockets=[];
  const Native=window.WebSocket;
  const Wrapped=function(...args){const ws=new Native(...args);window.__dorhamiSockets.push(ws);ws.addEventListener('close',()=>{window.__dorhamiSockets=window.__dorhamiSockets.filter(x=>x!==ws)});return ws};
  Wrapped.prototype=Native.prototype;Object.setPrototypeOf(Wrapped,Native);window.WebSocket=Wrapped;
}

function adminMenu(){
  const nav=document.querySelector('.side-nav');if(!nav||document.getElementById('adminNav'))return;
  const b=document.createElement('button');b.id='adminNav';b.type='button';b.className='nav-item';b.innerHTML='<span>🛠️</span>مدیریت';nav.appendChild(b);
  b.onclick=()=>{
    document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));b.classList.add('active');
    document.getElementById('chatPanel')?.classList.add('hidden');document.getElementById('peoplePanel')?.classList.add('hidden');
    let p=document.getElementById('adminPanel');
    if(!p){p=document.createElement('div');p.id='adminPanel';p.className='people-panel';p.innerHTML='<div class="section-head"><span>پنل مدیریت</span><span class="mini-label">چت دورهمی</span></div><div class="admin-card"><h3>🛠️ مدیریت دورهمی</h3><p>آمار و مدیریت کاربران از این بخش در دسترس است.</p><div id="adminStats">در حال دریافت...</div><button type="button" id="adminRefresh">↻ به‌روزرسانی</button></div>';document.querySelector('.sidebar')?.appendChild(p);p.querySelector('#adminRefresh').onclick=loadAdmin;}
    p.classList.remove('hidden');loadAdmin();
  };
}
async function loadAdmin(){
  const box=document.getElementById('adminStats');if(!box)return;
  try{const r=await fetch('/api/users?q=');const d=await r.json();const users=d.users||[];box.innerHTML='<b>👥 کاربران: '+users.length+'</b><br><span>🟢 سامانه چت فعال است</span><br><span>💬 پیام خصوصی فعال است</span>';}
  catch{box.textContent='خطا در دریافت آمار کاربران'}
}

function css(){
  if(document.getElementById('dorhamiFeatureCss'))return;
  const s=document.createElement('style');s.id='dorhamiFeatureCss';s.textContent=`
.avatar-picker-modal{display:flex!important;align-items:center;justify-content:center;z-index:99999!important;background:rgba(75,55,87,.28)!important;backdrop-filter:blur(8px)}
.avatar-picker-card{width:min(520px,94vw)!important;max-height:88vh;overflow:auto!important;background:#fffaf2!important;color:#49365a!important}
.preset-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:16px 0}.preset-avatar{border:1px solid rgba(183,139,69,.22);border-radius:16px;padding:8px;background:linear-gradient(145deg,#fff,#f1e8f8);color:#49365a;cursor:pointer;font-size:30px;min-height:54px;transition:.15s}.preset-avatar:hover{transform:translateY(-2px) scale(1.04);border-color:#b78b45}.preset-avatar:disabled{opacity:.55}.preset-note{display:block;text-align:center;color:#887b91}.read-tick{display:inline-block;margin-right:8px;font-size:12px;font-weight:900;opacity:.75}.read-tick.read{opacity:1}.admin-card{padding:16px;border:1px solid rgba(183,139,69,.18);border-radius:18px;background:rgba(255,255,255,.72);color:#49365a;line-height:2}.admin-card h3{margin:0 0 6px}.admin-card p{font-size:11px;color:#887b91}.admin-card button{margin-top:10px;padding:9px 13px;border:0;border-radius:12px;background:#b78b45;color:#fff;cursor:pointer}.avatar-upload{cursor:pointer!important}@media(max-width:520px){.preset-grid{grid-template-columns:repeat(5,1fr)}.preset-avatar{font-size:27px;min-height:48px}}
`;
  document.head.appendChild(s);
}

function boot(){css();wrapWebSocket();trackSockets();installAvatar();adminMenu();observeMessages();setTimeout(()=>{installAvatar();adminMenu();observeMessages()},300);setTimeout(()=>{installAvatar();adminMenu()},1200);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();