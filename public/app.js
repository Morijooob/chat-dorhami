(()=>{
'use strict';
const $=id=>document.getElementById(id);
let mode='login', socket=null, me=null;
const auth=$('auth'), chat=$('chat'), form=$('authForm'), msg=$('authMsg');

function setMode(m){
  mode=m;
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
  $('submit').textContent=m==='login'?'ورود به دورهمی':'ساخت حساب';
  $('password').minLength=6;
  msg.textContent='';
}

document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));

async function api(path,opt={}){
  const r=await fetch(path,{...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})},cache:'no-store'});
  let d={};
  try{d=await r.json()}catch{}
  if(!r.ok)throw Error(d.error||'خطای سرور');
  return d;
}

form.onsubmit=async e=>{
  e.preventDefault();
  msg.textContent='';
  $('submit').disabled=true;
  try{
    const d=await api(mode==='login'?'/api/login':'/api/register',{
      method:'POST',
      body:JSON.stringify({username:$('username').value,password:$('password').value})
    });
    me=d.user;
    showChat();
  }catch(err){
    msg.textContent=err.message;
  }finally{
    $('submit').disabled=false;
  }
};

async function boot(){
  try{
    const d=await api('/api/me');
    if(d.authenticated){
      me=d.user;
      showChat();
    }
  }catch{}
}

function showChat(){
  auth.classList.add('hidden');
  chat.classList.remove('hidden');
  $('me').textContent='@'+me.username;
  connect();
}

function connect(){
  if(socket&&socket.readyState<2)return;
  const proto=location.protocol==='https:'?'wss:':'ws:';
  socket=new WebSocket(`${proto}//${location.host}/ws`);
  socket.onopen=()=>socket.send(JSON.stringify({type:'history'}));
  socket.onmessage=e=>{
    try{handle(JSON.parse(e.data))}catch{}
  };
  socket.onclose=()=>setTimeout(connect,1800);
}

function handle(d){
  if(d.type==='history'){
    const box=$('messages');
    box.innerHTML='';
    d.messages.forEach(addMessage);
    return;
  }

  if(d.type==='message'){
    addMessage(d.message);
    return;
  }

  if(d.type==='presence'){
    $('online').textContent=fa(d.count)+' آنلاین';
    $('users').innerHTML=d.users.map(u=>
      `<div class="user">🟢 <b>${esc(u.username)}</b>${u.role==='admin'?'<span>مدیر</span>':''}</div>`
    ).join('');
  }
}

function addMessage(m){
  const box=$('messages');
  const mine=me&&m.username===me.username;
  const el=document.createElement('div');
  el.className='bubble '+(mine?'mine':'');
  el.innerHTML=`<div class="name">${esc(m.username)}</div><div>${esc(m.body)}</div><time>${new Date(m.created_at).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'})}</time>`;
  box.appendChild(el);
  box.scrollTop=box.scrollHeight;
}

$('send').onsubmit=e=>{
  e.preventDefault();
  const v=$('message').value.trim();
  if(!v||!socket||socket.readyState!==1)return;
  socket.send(JSON.stringify({type:'message',body:v}));
  $('message').value='';
  $('message').focus();
};

$('logout').onclick=async()=>{
  try{await api('/api/logout',{method:'POST'})}
  finally{socket?.close();location.reload();}
};

function esc(v){
  return String(v??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function fa(n){return new Intl.NumberFormat('fa-IR').format(n);}
boot();
})();
