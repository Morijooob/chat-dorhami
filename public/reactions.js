(()=>{
'use strict';
const EMOJIS=['❤️','😂','👍','😍','😢','😡','🎉'];
const NativeWebSocket=window.WebSocket;
let currentHistory=[];
let currentSocket=null;

function injectStyles(){
  if(document.getElementById('reactionStyles'))return;
  const style=document.createElement('style');
  style.id='reactionStyles';
  style.textContent=`
    .bubble{position:relative}
    .reaction-row{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;align-items:center}
    .reaction-item,.reaction-add{border:1px solid #dfe4e8;background:#f7f8f9;border-radius:999px;min-height:28px;padding:2px 8px;display:inline-flex;align-items:center;justify-content:center;gap:4px;font:inherit;cursor:pointer;transition:transform .12s ease,background .12s ease,border-color .12s ease}
    .reaction-item:hover,.reaction-add:hover{transform:translateY(-1px);background:#eef2f4}
    .reaction-add{width:30px;padding:0;font-size:16px;opacity:.78}
    .reaction-count{font-size:12px;color:#65717b;direction:ltr}
    .reaction-menu{display:flex;flex-wrap:wrap;gap:5px;padding:7px;background:#fff;border:1px solid #e2e6e9;border-radius:14px;box-shadow:0 10px 30px #0002;position:absolute;z-index:20;bottom:42px;right:0;max-width:260px}
    .reaction-menu button{border:0;background:#f3f5f6;border-radius:10px;width:34px;height:34px;font-size:20px;cursor:pointer}
    .reaction-menu button:hover{background:#e8ecef;transform:scale(1.08)}
    .reaction-item:active,.reaction-add:active,.reaction-menu button:active{transform:scale(.94)}
    .dark .reaction-item,.dark .reaction-add{background:#25313b;border-color:#3a4853;color:#fff}
    .dark .reaction-item:hover,.dark .reaction-add:hover{background:#30404d}
    .dark .reaction-menu{background:#1f2932;border-color:#3a4853;box-shadow:0 10px 30px #0006}
    .dark .reaction-menu button{background:#2a3741}
    .dark .reaction-menu button:hover{background:#34444f}
    .dark .reaction-count{color:#b8c2ca}
  `;
  document.head.appendChild(style);
}

function sendReaction(messageId,emoji){
  const ws=currentSocket||window.__dorhamiSocket;
  if(!ws||ws.readyState!==NativeWebSocket.OPEN)return;
  ws.send(JSON.stringify({type:'reaction',messageId:Number(messageId),emoji}));
}

function closeMenus(except){
  document.querySelectorAll('.reaction-menu').forEach(menu=>{if(menu!==except)menu.remove();});
}

document.addEventListener('click',e=>{
  if(!e.target.closest('.reaction-menu')&&!e.target.closest('.reaction-add'))closeMenus();
});

function renderReactions(bubble,reactions){
  if(!bubble)return;
  let row=bubble.querySelector('.reaction-row');
  if(!row){row=document.createElement('div');row.className='reaction-row';bubble.appendChild(row);}
  row.innerHTML='';
  (Array.isArray(reactions)?reactions:[]).filter(r=>r&&Number(r.count)>0).forEach(r=>{
    const button=document.createElement('button');
    button.type='button';button.className='reaction-item';button.dataset.emoji=r.emoji;
    button.title=`واکنش ${r.emoji}`;
    button.innerHTML=`<span>${r.emoji}</span><span class="reaction-count">${Number(r.count)}</span>`;
    button.onclick=e=>{e.stopPropagation();const id=bubble.dataset.messageId;if(id)sendReaction(id,r.emoji);};
    row.appendChild(button);
  });
  const add=document.createElement('button');
  add.type='button';add.className='reaction-add';add.textContent='➕';add.title='واکنش';
  add.onclick=e=>{
    e.stopPropagation();
    const old=row.parentElement.querySelector('.reaction-menu');
    closeMenus(old);
    if(old)return;
    const menu=document.createElement('div');menu.className='reaction-menu';
    EMOJIS.forEach(emoji=>{
      const b=document.createElement('button');b.type='button';b.textContent=emoji;
      b.onclick=ev=>{ev.stopPropagation();const id=bubble.dataset.messageId;if(id)sendReaction(id,emoji);menu.remove();};
      menu.appendChild(b);
    });
    bubble.appendChild(menu);
  };
  row.appendChild(add);
}

function enhanceBubble(bubble,message){
  if(!bubble||!message?.id)return;
  bubble.dataset.messageId=String(message.id);
  renderReactions(bubble,message.reactions||[]);
}

function mapHistory(messages){
  currentHistory=Array.isArray(messages)?messages:[];
  setTimeout(()=>{
    const bubbles=[...document.querySelectorAll('#messages .bubble')];
    const start=Math.max(0,bubbles.length-currentHistory.length);
    currentHistory.forEach((message,index)=>enhanceBubble(bubbles[start+index],message));
  },0);
}

function enhanceLive(message){
  setTimeout(()=>{
    const bubbles=document.querySelectorAll('#messages .bubble');
    const bubble=bubbles[bubbles.length-1];
    if(bubble)enhanceBubble(bubble,message);
  },0);
}

function updateReaction(messageId,reactions){
  const bubble=document.querySelector(`#messages .bubble[data-message-id="${CSS.escape(String(messageId))}"]`);
  if(bubble)renderReactions(bubble,reactions||[]);
}

function handleIncoming(event){
  try{
    const d=JSON.parse(event.data);
    if(d.type==='ready'||d.type==='history'||d.type==='private_opened'||d.type==='private_history'){
      mapHistory(d.messages||[]);
    }else if(d.type==='message'||d.type==='private_message'){
      enhanceLive(d.message);
    }else if(d.type==='reaction_update'){
      updateReaction(d.messageId,d.reactions);
    }
  }catch{}
}

function HookedWebSocket(...args){
  const ws=new NativeWebSocket(...args);
  currentSocket=ws;window.__dorhamiSocket=ws;
  ws.addEventListener('message',handleIncoming);
  return ws;
}
HookedWebSocket.prototype=NativeWebSocket.prototype;
for(const key of ['CONNECTING','OPEN','CLOSING','CLOSED']){try{Object.defineProperty(HookedWebSocket,key,{value:NativeWebSocket[key]});}catch{}}
window.WebSocket=HookedWebSocket;

injectStyles();
})();
