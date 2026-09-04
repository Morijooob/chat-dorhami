(()=>{
'use strict';
const $=id=>document.getElementById(id);
let mode='login',socket=null,me=null,reconnectTimer=null,reconnectAttempts=0,privateUser=null,onlineIds=new Set(),typingTimer=null,remoteTypingTimer=null,onlineUsers=[];
const AVATARS=['🙂','😎','🤩','😇','🥳','🤠','🧑‍💻','👩‍💻','🦊','🐼','🐯','🐨','🐸','🐵','🐱','🐶','🦁','🐻'];
const auth=$('auth'),chat=$('chat'),form=$('authForm'),msg=$('authMsg');
function setMode(m){mode=m;document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));$('submit').textContent=m==='login'?'ورود به دورهمی':'ساخت حساب';$('password').autocomplete=m==='login'?'current-password':'new-password';msg.textContent='';}
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
async function api(path,opt={}){let response;try{response=await fetch(path,{...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})},cache:'no-store',credentials:'same-origin'});}catch{throw Error('اتصال به سرور برقرار نشد. اینترنت را بررسی کن.');}let data={};const text=await response.text();try{data=text?JSON.parse(text):{}}catch{}if(!response.ok){const error=Error(data.error||`خطای سرور (${response.status})`);error.code=data.code||'HTTP_ERROR';error.status=response.status;throw error;}return data;}
form.onsubmit=async e=>{e.preventDefault();msg.textContent='';$('submit').disabled=true;try{const username=$('username').value.trim(),password=$('password').value,d=await api(mode==='login'?'/api/login':'/api/register',{method:'POST',body:JSON.stringify({username,password})});me=d.user;showChat();}catch(err){msg.textContent=err.code&&err.code!=='INVALID_CREDENTIALS'?`${err.message} [${err.code}]`:err.message;}finally{$('submit').disabled=false;}};
async function boot(){try{const d=await api('/api/me');if(d.authenticated){me=d.user;showChat();}}catch(err){console.warn('session check failed',err);}}
function avatarStorageKey(userId=me?.id){return userId?`dorhami_avatar_${userId}`:'';}
function getAvatar(userId=me?.id){try{const value=localStorage.getItem(avatarStorageKey(userId));return AVATARS.includes(value)?value:'🙂';}catch{return'🙂';}}
function setAvatar(value){if(!AVATARS.includes(value)||!me)return;try{localStorage.setItem(avatarStorageKey(),value);}catch{}renderProfileAvatar();renderOnlineUsers();renderPrivateChats();if(privateUser)setPrivateHeader();}
function renderProfileAvatar(){$('myAvatar').textContent=getAvatar();}
function openAvatarPicker(){const box=$('avatarChoices');if(!box)return;const current=getAvatar();box.innerHTML=AVATARS.map(a=>`<button type="button" class="avatar-choice ${a===current?'selected':''}" data-avatar="${a}">${a}</button>`).join('');box.querySelectorAll('.avatar-choice').forEach(btn=>btn.onclick=()=>{setAvatar(btn.dataset.avatar);closeAvatarPicker();});$('avatarModal').classList.remove('hidden');}
function closeAvatarPicker(){$('avatarModal').classList.add('hidden');}
function showChat(){auth.classList.add('hidden');chat.classList.remove('hidden');$('me').textContent='@'+me.username;renderProfileAvatar();renderPrivateChats();connect();}
function connect(){if(socket&&socket.readyState<2)return;clearTimeout(reconnectTimer);const proto=location.protocol==='https:'?'wss:':'ws:';socket=new WebSocket(`${proto}//${location.host}/ws`);socket.onopen=()=>{reconnectAttempts=0;setConnectionState(true);socket.send(JSON.stringify({type:'history'}));};socket.onmessage=e=>{try{handle(JSON.parse(e.data))}catch(error){console.warn('bad websocket message',error)}};socket.onerror=()=>setConnectionState(false);socket.onclose=()=>{setConnectionState(false);if(auth.classList.contains('hidden'))scheduleReconnect();};}
function scheduleReconnect(){clearTimeout(reconnectTimer);reconnectAttempts=Math.min(reconnectAttempts+1,8);const delay=Math.min(1000*Math.pow(1.6,reconnectAttempts-1),10000);reconnectTimer=setTimeout(connect,delay);}
function setConnectionState(online){if(!online)$('online').textContent='در حال اتصال...';}
function handle(d){
  if(d.type==='ready'){if(d.user)me=d.user;renderHistory(d.messages||[]);return;}
  if(d.type==='history'){if(!privateUser)renderHistory(d.messages||[]);return;}
  if(d.type==='message'){if(!privateUser)addMessage(d.message);return;}
  if(d.type==='presence'){onlineUsers=d.users||[];onlineIds=new Set(onlineUsers.map(u=>Number(u.id)));$('online').textContent=fa(d.count)+' آنلاین';renderOnlineUsers();renderPrivateChats();if(privateUser)$('chatSubtitle').textContent=onlineIds.has(Number(privateUser.id))?'🟢 آنلاین':'⚪ آفلاین';return;}
  if(d.type==='typing'){if(privateUser&&Number(d.user?.id)===Number(privateUser.id)){clearTimeout(remoteTypingTimer);$('typing').textContent=d.typing?'✍️ در حال نوشتن...':'';if(d.typing)remoteTypingTimer=setTimeout(()=>{$('typing').textContent='';},2500);}return;}
  if(d.type==='private_opened'){clearRemoteTyping();privateUser=d.user;markChatRead(d.user?.id);rememberChat(d.user,{created_at:d.messages?.length?d.messages[d.messages.length-1].created_at:Date.now(),body:d.messages?.length?d.messages[d.messages.length-1].body:''});setPrivateHeader();renderHistory(d.messages||[]);return;}
  if(d.type==='private_history'){if(privateUser&&Number(d.user?.id)===Number(privateUser.id))renderHistory(d.messages||[]);return;}
  if(d.type==='private_message'){
    const fromId=Number(d.from?.id),toId=Number(d.to?.id),myId=Number(me?.id),privateId=Number(privateUser?.id),messageUserId=Number(d.message?.user_id);
    const otherId=fromId===myId?toId:fromId;
    const otherUser=fromId===myId?d.to:d.from;
    rememberChat(otherUser,d.message);
    const belongsToCurrentPrivateChat=privateUser&&(fromId===privateId||toId===privateId||messageUserId===myId);
    if(belongsToCurrentPrivateChat){clearRemoteTyping();addMessage(d.message);if(fromId!==myId)markChatRead(otherUser?.id);}else if(fromId!==myId){incrementUnread(otherUser);toast(`پیام خصوصی جدید از ${d.from?.username||'کاربر'}`);}
    return;
  }
  if(d.type==='private_error'){toast(d.error||'باز کردن چت خصوصی انجام نشد.');return;}
  if(d.type==='pong')return;
}
function openPrivate(targetId){if(!socket||socket.readyState!==WebSocket.OPEN)return;clearRemoteTyping();stopTyping();socket.send(JSON.stringify({type:'open_private',targetId}));}
function setPrivateHeader(){if(!privateUser)return;$('chatTitle').textContent='@'+privateUser.username;$('chatSubtitle').textContent=onlineIds.has(Number(privateUser.id))?'🟢 آنلاین':'⚪ آفلاین';$('typing').textContent='';$('backPublic').classList.remove('hidden');}
function showPublic(){stopTyping();clearRemoteTyping();privateUser=null;$('chatTitle').textContent='اتاق عمومی';$('chatSubtitle').textContent='گفتگوی زنده';$('typing').textContent='';$('backPublic').classList.add('hidden');renderHistory([]);if(socket&&socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'history'}));}
$('backPublic').onclick=showPublic;$('publicRoom').onclick=showPublic;
function renderHistory(messages){const box=$('messages');box.innerHTML='';messages.forEach(addMessage);}
function addMessage(m){if(!m)return;const box=$('messages'),mine=me&&m.user_id?Number(m.user_id)===Number(me.id):me&&m.username===me.username,el=document.createElement('div');el.className='bubble '+(mine?'mine':'');const head=document.createElement('div');head.className='bubble-head';const avatar=document.createElement('span');avatar.className='message-avatar';avatar.textContent=getAvatar(m.user_id);const name=document.createElement('span');name.className='name'+(Number(m.user_id)!==Number(me?.id)?' clickable-name':'');name.textContent=m.username||'کاربر';if(Number(m.user_id)!==Number(me?.id)&&Number(m.user_id)>0){name.title='برای چت خصوصی کلیک کن';name.onclick=()=>openPrivate(Number(m.user_id));}head.append(avatar,name);const body=document.createElement('div');body.textContent=m.body||'';const time=document.createElement('time');time.textContent=formatTime(m.created_at);el.append(head,body,time);box.appendChild(el);box.scrollTop=box.scrollHeight;}
function formatTime(value){const date=new Date(Number(value));if(Number.isNaN(date.getTime()))return '';return date.toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'});}
function chatStorageKey(){return me?`dorhami_private_chats_${me.id}`:'';}
function unreadStorageKey(){return me?`dorhami_private_unread_${me.id}`:'';}
function loadPrivateChats(){if(!me)return[];try{const data=JSON.parse(localStorage.getItem(chatStorageKey())||'[]');return Array.isArray(data)?data.filter(x=>x&&Number(x.id)>0&&Number(x.id)!==Number(me.id)):[]}catch{return[];}}
function savePrivateChats(list){try{localStorage.setItem(chatStorageKey(),JSON.stringify(list.slice(0,50)))}catch{}}
function loadUnread(){if(!me)return{};try{const data=JSON.parse(localStorage.getItem(unreadStorageKey())||'{}');return data&&typeof data==='object'?data:{}}catch{return{};}}
function saveUnread(data){try{localStorage.setItem(unreadStorageKey(),JSON.stringify(data))}catch{}}
function markChatRead(userId){const id=Number(userId);if(!id||!me)return;const data=loadUnread();if(data[id]){delete data[id];saveUnread(data);renderPrivateChats();}}
function incrementUnread(user){if(!user||!me||Number(user.id)===Number(me.id))return;const id=Number(user.id),data=loadUnread();data[id]=(Number(data[id])||0)+1;saveUnread(data);renderPrivateChats();}
function rememberChat(user,message){if(!user||!me||Number(user.id)===Number(me.id))return;const list=loadPrivateChats(),id=Number(user.id),item={id,username:String(user.username||'کاربر'),body:String(message?.body||''),created_at:Number(message?.created_at)||Date.now()};const next=[item,...list.filter(x=>Number(x.id)!==id)];savePrivateChats(next);renderPrivateChats();}
function renderPrivateChats(){const box=$('privateChats');if(!box||!me)return;const list=loadPrivateChats(),unread=loadUnread();if(!list.length){box.innerHTML='<div class="private-empty">هنوز گفتگوی خصوصی نداری</div>';return;}box.innerHTML=list.map(c=>{const isOnline=onlineIds.has(Number(c.id)),count=Number(unread[c.id])||0;return `<div class="private-chat" data-private-id="${c.id}"><div class="avatar">${getAvatar(c.id)}</div><div class="chat-info"><b>@${esc(c.username)}</b><small>${esc(c.body||'گفتگوی خصوصی')}</small></div>${count?`<span class="unread-badge">${count>99?'۹۹+':fa(count)}</span>`:''}<time>${isOnline?'آنلاین':'آفلاین'} · ${formatTime(c.created_at)}</time></div>`;}).join('');box.querySelectorAll('.private-chat').forEach(el=>el.onclick=()=>openPrivate(Number(el.dataset.privateId)));}
function renderOnlineUsers(){const box=$('users');if(!box)return;const query=String($('userSearch')?.value||'').trim().toLocaleLowerCase();const users=onlineUsers.filter(u=>!query||String(u.username||'').toLocaleLowerCase().includes(query));box.innerHTML=users.map(u=>`<div class="user ${u.id===me?.id?'self':''}" data-user-id="${Number(u.id)}"><span class="user-avatar">${getAvatar(u.id)}</span><b>${esc(u.username)}</b>${u.id===me?.id?'<small> شما</small>':'<em>چت خصوصی</em>'}</div>`).join('');if(!users.length)box.innerHTML='<div class="user-search-empty">کاربری پیدا نشد</div>';box.querySelectorAll('.user[data-user-id]').forEach(el=>{if(Number(el.dataset.userId)!==Number(me?.id))el.onclick=()=>openPrivate(Number(el.dataset.userId));});}
function stopTyping(){clearTimeout(typingTimer);if(socket&&socket.readyState===WebSocket.OPEN&&privateUser)socket.send(JSON.stringify({type:'typing',targetId:Number(privateUser.id),typing:false}));}
function sendTyping(){if(!privateUser||!socket||socket.readyState!==WebSocket.OPEN)return;clearTimeout(typingTimer);socket.send(JSON.stringify({type:'typing',targetId:Number(privateUser.id),typing:true}));typingTimer=setTimeout(stopTyping,1200);}
$('message').addEventListener('input',()=>{if(privateUser){if($('message').value.trim())sendTyping();else stopTyping();}});
$('userSearch').addEventListener('input',renderOnlineUsers);
$('myAvatar').onclick=openAvatarPicker;
$('closeAvatar').onclick=closeAvatarPicker;
$('avatarModal').onclick=e=>{if(e.target===$('avatarModal'))closeAvatarPicker();};
$('send').onsubmit=e=>{e.preventDefault();const input=$('message'),v=input.value.trim();if(!v||!socket||socket.readyState!==WebSocket.OPEN)return;stopTyping();if(privateUser)socket.send(JSON.stringify({type:'private_message',targetId:Number(privateUser.id),body:v}));else socket.send(JSON.stringify({type:'message',body:v}));input.value='';input.focus();};
$('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'})}finally{clearTimeout(reconnectTimer);stopTyping();if(socket){try{socket.close()}catch{}}location.reload();}};
function clearRemoteTyping(){clearTimeout(remoteTypingTimer);const el=$('typing');if(el)el.textContent='';}
function toast(text){const el=$('toast');el.textContent=text;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.textContent='',3000);}
function esc(v){return String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));}
function fa(n){return new Intl.NumberFormat('fa-IR').format(n);}
boot();
})();
