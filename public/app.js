(()=>{
'use strict';
const $=id=>document.getElementById(id);
let mode='login',socket=null,me=null,reconnectTimer=null,reconnectAttempts=0,privateUser=null;
const auth=$('auth'),chat=$('chat'),form=$('authForm'),msg=$('authMsg');
function setMode(m){mode=m;document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));$('submit').textContent=m==='login'?'ورود به دورهمی':'ساخت حساب';$('password').autocomplete=m==='login'?'current-password':'new-password';msg.textContent='';}
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
async function api(path,opt={}){let response;try{response=await fetch(path,{...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})},cache:'no-store',credentials:'same-origin'});}catch{throw Error('اتصال به سرور برقرار نشد. اینترنت را بررسی کن.');}let data={};const text=await response.text();try{data=text?JSON.parse(text):{}}catch{}if(!response.ok){const error=Error(data.error||`خطای سرور (${response.status})`);error.code=data.code||'HTTP_ERROR';error.status=response.status;throw error;}return data;}
form.onsubmit=async e=>{e.preventDefault();msg.textContent='';$('submit').disabled=true;try{const username=$('username').value.trim(),password=$('password').value,d=await api(mode==='login'?'/api/login':'/api/register',{method:'POST',body:JSON.stringify({username,password})});me=d.user;showChat();}catch(err){msg.textContent=err.code&&err.code!=='INVALID_CREDENTIALS'?`${err.message} [${err.code}]`:err.message;}finally{$('submit').disabled=false;}};
async function boot(){try{const d=await api('/api/me');if(d.authenticated){me=d.user;showChat();}}catch(err){console.warn('session check failed',err);}}
function showChat(){auth.classList.add('hidden');chat.classList.remove('hidden');$('me').textContent='@'+me.username;connect();}
function connect(){if(socket&&socket.readyState<2)return;clearTimeout(reconnectTimer);const proto=location.protocol==='https:'?'wss:':'ws:';socket=new WebSocket(`${proto}//${location.host}/ws`);socket.onopen=()=>{reconnectAttempts=0;setConnectionState(true);socket.send(JSON.stringify({type:'history'}));};socket.onmessage=e=>{try{handle(JSON.parse(e.data))}catch(error){console.warn('bad websocket message',error)}};socket.onerror=()=>setConnectionState(false);socket.onclose=()=>{setConnectionState(false);if(auth.classList.contains('hidden'))scheduleReconnect();};}
function scheduleReconnect(){clearTimeout(reconnectTimer);reconnectAttempts=Math.min(reconnectAttempts+1,8);const delay=Math.min(1000*Math.pow(1.6,reconnectAttempts-1),10000);reconnectTimer=setTimeout(connect,delay);}
function setConnectionState(online){if(!online)$('online').textContent='در حال اتصال...';}
function handle(d){
  if(d.type==='ready'){if(d.user)me=d.user;renderHistory(d.messages||[]);return;}
  if(d.type==='history'){if(!privateUser)renderHistory(d.messages||[]);return;}
  if(d.type==='message'){if(!privateUser)addMessage(d.message);return;}
  if(d.type==='presence'){$('online').textContent=fa(d.count)+' آنلاین';$('users').innerHTML=d.users.map(u=>`<div class="user ${u.id===me?.id?'self':''}" data-user-id="${Number(u.id)}"><span>🟢</span><b>${esc(u.username)}</b>${u.id===me?.id?'<small> شما</small>':'<em>چت خصوصی</em>'}</div>`).join('');document.querySelectorAll('.user[data-user-id]').forEach(el=>{if(Number(el.dataset.userId)!==Number(me?.id))el.onclick=()=>openPrivate(Number(el.dataset.userId));});return;}
  if(d.type==='private_opened'){privateUser=d.user;setPrivateHeader();renderHistory(d.messages||[]);return;}
  if(d.type==='private_history'){if(privateUser&&Number(d.user?.id)===Number(privateUser.id))renderHistory(d.messages||[]);return;}
  if(d.type==='private_message'){if(privateUser&&Number(d.from?.id)===Number(privateUser.id))addMessage(d.message);else if(!privateUser)toast(`پیام خصوصی جدید از ${d.from?.username||'کاربر'}`);return;}
  if(d.type==='private_error'){toast(d.error||'باز کردن چت خصوصی انجام نشد.');return;}
  if(d.type==='pong')return;
}
function openPrivate(targetId){if(!socket||socket.readyState!==WebSocket.OPEN)return;socket.send(JSON.stringify({type:'open_private',targetId}));}
function setPrivateHeader(){if(!privateUser)return;$('chatTitle').textContent='@'+privateUser.username;$('chatSubtitle').textContent='گفتگوی خصوصی';$('backPublic').classList.remove('hidden');}
function showPublic(){privateUser=null;$('chatTitle').textContent='اتاق عمومی';$('chatSubtitle').textContent='گفتگوی زنده';$('backPublic').classList.add('hidden');renderHistory([]);if(socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'history'}));}
$('backPublic').onclick=showPublic;$('publicRoom').onclick=showPublic;
function renderHistory(messages){const box=$('messages');box.innerHTML='';messages.forEach(addMessage);}
function addMessage(m){if(!m)return;const box=$('messages'),mine=me&&m.user_id?Number(m.user_id)===Number(me.id):me&&m.username===me.username,el=document.createElement('div');el.className='bubble '+(mine?'mine':'');el.innerHTML=`<div class="name">${esc(m.username)}</div><div>${esc(m.body)}</div><time>${formatTime(m.created_at)}</time>`;box.appendChild(el);box.scrollTop=box.scrollHeight;}
function formatTime(value){const date=new Date(Number(value));if(Number.isNaN(date.getTime()))return '';return date.toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'});}
$('send').onsubmit=e=>{e.preventDefault();const input=$('message'),v=input.value.trim();if(!v||!socket||socket.readyState!==WebSocket.OPEN)return;if(privateUser)socket.send(JSON.stringify({type:'private_message',targetId:Number(privateUser.id),body:v}));else socket.send(JSON.stringify({type:'message',body:v}));input.value='';input.focus();};
$('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'})}finally{clearTimeout(reconnectTimer);if(socket){try{socket.close()}catch{}}location.reload();}};
function toast(text){const el=$('toast');el.textContent=text;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.textContent='',3000);}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fa(n){return new Intl.NumberFormat('fa-IR').format(n);}
boot();
})();
