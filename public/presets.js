(()=>{
'use strict';
const PRESETS=[
  ['👩🏻','خانم ۱'],['👩🏼','خانم ۲'],['👩🏽','خانم ۳'],['👩🏻‍🦱','خانم ۴'],['👩🏼‍🦰','خانم ۵'],['👩🏽‍🦳','خانم ۶'],
  ['👨🏻','آقا ۱'],['👨🏼','آقا ۲'],['👨🏽','آقا ۳'],['👨🏻‍🦱','آقا ۴'],['👨🏼‍🦰','آقا ۵'],['👨🏽‍🦳','آقا ۶'],
  ['🧑🏻','خنثی ۱'],['🧑🏼','خنثی ۲'],['🧑🏽','خنثی ۳'],['🧑🏻‍🎨','هنری']
];
function makeAvatarData(emoji){
  const c=document.createElement('canvas');c.width=160;c.height=160;const x=c.getContext('2d');
  const g=x.createRadialGradient(45,35,5,80,80,115);g.addColorStop(0,'#6d5dfc');g.addColorStop(1,'#171b35');x.fillStyle=g;x.fillRect(0,0,160,160);
  x.font='78px "Noto Color Emoji","Segoe UI Emoji",sans-serif';x.textAlign='center';x.textBaseline='middle';x.fillText(emoji,80,82);return c.toDataURL('image/png');
}
function openPresetGallery(){
  const modal=document.getElementById('profileModal');if(!modal)return;
  const old=modal.querySelector('.avatar-upload');if(old)old.style.display='none';
  let box=modal.querySelector('#presetAvatarBox');
  if(!box){box=document.createElement('div');box.id='presetAvatarBox';box.innerHTML='<div class="preset-title">🎭 آواتار خودت را انتخاب کن</div><div class="preset-grid"></div><div class="preset-note">بدون آپلود عکس شخصی • حجم بسیار کم ⚡</div>';const anchor=modal.querySelector('#profileName')||modal.firstElementChild;anchor?.parentNode?.insertBefore(box,anchor);}
  const grid=box.querySelector('.preset-grid');if(grid.dataset.ready)return;grid.dataset.ready='1';
  PRESETS.forEach(([emoji,name])=>{const b=document.createElement('button');b.type='button';b.className='preset-avatar';b.title=name;b.innerHTML='<span>'+emoji+'</span><small>'+name+'</small>';b.onclick=async()=>{try{const data=makeAvatarData(emoji);const r=await fetch('/api/avatar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:window.currentUser?.id||localStorage.getItem('chat_dorhami_user_id'),avatar:data})});const d=await r.json();if(!r.ok)throw Error(d.error||'ذخیره آواتار ناموفق بود');window.currentUser=d.user;localStorage.setItem('chat_dorhami_user',JSON.stringify(d.user));if(typeof window.updateAvatarUI==='function')window.updateAvatarUI();document.getElementById('profileModal')?.classList.add('hidden');if(typeof window.loadUsers==='function')window.loadUsers();}catch(e){alert(e.message||'خطا در ذخیره آواتار')}};grid.appendChild(b)});
}
function install(){
  document.addEventListener('click',e=>{if(e.target.closest('#settingsBtn'))setTimeout(openPresetGallery,30);});
  const style=document.createElement('style');style.textContent=`#presetAvatarBox{margin:10px 0 16px;padding:14px;border:1px solid rgba(255,255,255,.1);border-radius:22px;background:rgba(20,24,50,.72)}.preset-title{text-align:center;font-weight:800;margin-bottom:10px}.preset-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.preset-avatar{border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:8px;background:rgba(255,255,255,.04);color:inherit;cursor:pointer}.preset-avatar span{display:block;font-size:34px;line-height:42px}.preset-avatar small{font-size:9px;opacity:.7}.preset-avatar:hover{transform:translateY(-2px);border-color:#7c6cff}.preset-note{text-align:center;font-size:10px;opacity:.55;margin-top:9px}@media(max-width:600px){.preset-grid{grid-template-columns:repeat(4,1fr)}.preset-avatar span{font-size:29px}}`;
  document.head.appendChild(style);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();