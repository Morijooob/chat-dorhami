import { DurableObject } from "cloudflare:workers";

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v,max=2000)=>String(v??"").replace(/\0/g,"").trim().slice(0,max);
const norm=v=>clean(v,100).normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").toLowerCase();
const uid=()=>crypto.randomUUID();

export class ChatRoom extends DurableObject {
  constructor(ctx,env){
    super(ctx,env); this.ctx=ctx;
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL,avatar TEXT,vip INTEGER NOT NULL DEFAULT 0,role TEXT NOT NULL DEFAULT 'user');
      CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,description TEXT NOT NULL,created_at INTEGER NOT NULL,creator_id TEXT);
      CREATE TABLE IF NOT EXISTS room_members(room_id TEXT NOT NULL,user_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(room_id,user_id));
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,sender_id TEXT NOT NULL,receiver_id TEXT,room_id TEXT,body TEXT,message_type TEXT NOT NULL DEFAULT 'text',media TEXT,created_at INTEGER NOT NULL,read_at INTEGER);
      INSERT OR IGNORE INTO rooms(id,name,description,created_at,creator_id) VALUES('global','اتاق دورهمی','گفتگوی عمومی همه کاربران',strftime('%s','now')*1000,NULL);
    `);
    for(const q of [
      "ALTER TABLE users ADD COLUMN avatar TEXT",
      "ALTER TABLE users ADD COLUMN vip INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
      "ALTER TABLE rooms ADD COLUMN creator_id TEXT",
      "ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'",
      "ALTER TABLE messages ADD COLUMN media TEXT",
      "ALTER TABLE messages ADD COLUMN read_at INTEGER"
    ]) try{ctx.storage.sql.exec(q)}catch{}
    const first=ctx.storage.sql.exec("SELECT id FROM users ORDER BY created_at LIMIT 1").toArray()[0];
    if(first) try{ctx.storage.sql.exec("UPDATE users SET role='admin' WHERE id=?",first.id)}catch{}
  }
  user(id){return this.ctx.storage.sql.exec("SELECT id,username,created_at,avatar,vip,role FROM users WHERE id=? LIMIT 1",id).toArray()[0]||null}
  room(id){return this.ctx.storage.sql.exec("SELECT id,name,description,created_at,creator_id FROM rooms WHERE id=? LIMIT 1",id).toArray()[0]||null}
  member(r,u){return r==='global'||this.ctx.storage.sql.exec("SELECT 1 FROM room_members WHERE room_id=? AND user_id=? LIMIT 1",r,u).toArray().length>0}
  key(a,b){return [a,b].sort().join(':')}
  isAdmin(u){return this.user(u)?.role==='admin'}
  select(){return "SELECT m.id,m.sender_id,m.receiver_id,m.room_id,m.body,m.message_type,m.media,m.created_at,m.read_at,u.username,u.avatar,u.vip FROM messages m LEFT JOIN users u ON u.id=m.sender_id"}
  broadcast(key,data){const text=JSON.stringify(data);for(const ws of this.ctx.getWebSockets()){const a=ws.deserializeAttachment()||{};if(a.privateKey===key)try{ws.send(text)}catch{}}}

  async fetch(req){
    const url=new URL(req.url),p=url.pathname;
    if(p==='/register'&&req.method==='POST'){
      let d;try{d=await req.json()}catch{return json({error:'اطلاعات نامعتبر است.'},400)}
      const username=norm(d.username),passwordHash=clean(d.passwordHash,128);
      if(!/^[\p{L}\p{N}_]{3,24}$/u.test(username)||!/^[a-f0-9]{64}$/i.test(passwordHash))return json({error:'اطلاعات ثبت‌نام نامعتبر است.'},400);
      if(this.ctx.storage.sql.exec("SELECT id FROM users WHERE username=?",username).toArray().length)return json({error:'این نام کاربری قبلاً ثبت شده است.'},409);
      const id=uid(),now=Date.now(),count=this.ctx.storage.sql.exec("SELECT COUNT(*) n FROM users").toArray()[0].n;
      this.ctx.storage.sql.exec("INSERT INTO users(id,username,password_hash,created_at,avatar,vip,role) VALUES(?,?,?,?,?,?,?)",id,username,passwordHash,now,null,0,count===0?'admin':'user');
      return json({ok:true,user:this.user(id)},201);
    }
    if(p==='/login'&&req.method==='POST'){
      let d;try{d=await req.json()}catch{return json({error:'اطلاعات نامعتبر است.'},400)}
      const x=this.ctx.storage.sql.exec("SELECT id,username,created_at,avatar,vip,role FROM users WHERE username=? AND password_hash=? LIMIT 1",norm(d.username),clean(d.passwordHash,128)).toArray()[0];
      return x?json({ok:true,user:x}):json({error:'نام کاربری یا رمز عبور اشتباه است.'},401);
    }
    if(p==='/avatar'&&req.method==='POST'){
      let d;try{d=await req.json()}catch{return json({error:'تصویر نامعتبر است.'},400)}
      const id=clean(d.userId,100),avatar=String(d.avatar||'');
      if(!this.user(id))return json({error:'کاربر معتبر نیست.'},401);
      if(avatar&&(!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(avatar)||avatar.length>900000))return json({error:'تصویر نامعتبر یا بزرگ است.'},400);
      this.ctx.storage.sql.exec("UPDATE users SET avatar=? WHERE id=?",avatar||null,id);return json({ok:true,user:this.user(id)});
    }
    if(p==='/users'){
      const q=norm(url.searchParams.get('q'));return json({users:this.ctx.storage.sql.exec("SELECT id,username,created_at,avatar,vip,role FROM users WHERE username LIKE ? ORDER BY username LIMIT 100",`%${q}%`).toArray()});
    }
    if(p==='/rooms'){
      const id=clean(url.searchParams.get('userId'),100);return json({rooms:this.ctx.storage.sql.exec("SELECT r.id,r.name,r.description,r.created_at,r.creator_id FROM rooms r WHERE r.id='global' OR EXISTS(SELECT 1 FROM room_members rm WHERE rm.room_id=r.id AND rm.user_id=?) ORDER BY r.created_at DESC",id).toArray()});
    }
    if(p==='/create-room'&&req.method==='POST'){
      let d;try{d=await req.json()}catch{return json({error:'اطلاعات نامعتبر است.'},400)}
      const creator=clean(d.creatorId,100),name=clean(d.name,40),description=clean(d.description,120)||'اتاق گفتگوی دورهمی';
      if(!this.user(creator)||!name)return json({error:'نام اتاق الزامی است.'},400);
      if(this.ctx.storage.sql.exec("SELECT id FROM rooms WHERE name=?",name).toArray().length)return json({error:'این نام اتاق قبلاً استفاده شده است.'},409);
      const rid=uid(),now=Date.now();this.ctx.storage.sql.exec("INSERT INTO rooms VALUES(?,?,?,?,?)",rid,name,description,now,creator);this.ctx.storage.sql.exec("INSERT INTO room_members VALUES(?,?,?)",rid,creator,now);return json({ok:true,room:this.room(rid)},201);
    }
    if(p==='/room-members'){
      const r=clean(url.searchParams.get('roomId'),100),u=clean(url.searchParams.get('userId'),100);if(!this.member(r,u))return json({error:'دسترسی ندارید.'},403);return json({members:this.ctx.storage.sql.exec("SELECT u.id,u.username,u.avatar,u.vip FROM room_members rm JOIN users u ON u.id=rm.user_id WHERE rm.room_id=? ORDER BY rm.created_at",r).toArray()});
    }
    if(p==='/room-invite'&&req.method==='POST'){
      let d;try{d=await req.json()}catch{return json({error:'اطلاعات نامعتبر است.'},400)}
      const roomId=clean(d.roomId,100),inviter=clean(d.userId,100),invitee=clean(d.inviteeId,100);if(!this.room(roomId)||!this.user(invitee))return json({error:'اطلاعات نامعتبر است.'},400);if(!this.member(roomId,inviter))return json({error:'دسترسی ندارید.'},403);this.ctx.storage.sql.exec("INSERT OR IGNORE INTO room_members VALUES(?,?,?)",roomId,invitee,Date.now());return json({ok:true});
    }
    if(p==='/room-messages'){
      const r=clean(url.searchParams.get('roomId'),100)||'global',u=clean(url.searchParams.get('userId'),100);if(!this.member(r,u))return json({error:'دسترسی ندارید.'},403);return json({messages:this.ctx.storage.sql.exec(`${this.select()} WHERE m.room_id=? ORDER BY m.created_at LIMIT 200`,r).toArray()});
    }
    if(p==='/private-messages'){
      const a=clean(url.searchParams.get('userId'),100),b=clean(url.searchParams.get('otherId'),100);return json({messages:this.ctx.storage.sql.exec(`${this.select()} WHERE m.room_id IS NULL AND ((m.sender_id=? AND m.receiver_id=?) OR (m.sender_id=? AND m.receiver_id=?)) ORDER BY m.created_at LIMIT 200`,a,b,b,a).toArray()});
    }
    if(p==='/recent-chats'){
      const x=clean(url.searchParams.get('userId'),100);return json({chats:this.ctx.storage.sql.exec(`SELECT x.other_id,u.username,u.avatar,u.vip,x.body,x.message_type,x.created_at FROM(SELECT CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END other_id,body,message_type,created_at,ROW_NUMBER() OVER(PARTITION BY CASE WHEN sender_id=? THEN receiver_id ELSE sender_id END ORDER BY created_at DESC) rn FROM messages WHERE room_id IS NULL AND(sender_id=? OR receiver_id=?))x JOIN users u ON u.id=x.other_id WHERE x.rn=1 ORDER BY x.created_at DESC LIMIT 50`,x,x,x,x).toArray()});
    }
    if(p==='/admin/stats'){
      const u=clean(url.searchParams.get('userId'),100);if(!this.isAdmin(u))return json({error:'دسترسی مدیریت مجاز نیست.'},403);return json({ok:true,users:this.ctx.storage.sql.exec('SELECT COUNT(*) n FROM users').toArray()[0].n,messages:this.ctx.storage.sql.exec('SELECT COUNT(*) n FROM messages').toArray()[0].n,rooms:this.ctx.storage.sql.exec('SELECT COUNT(*) n FROM rooms').toArray()[0].n});
    }
    if(p==='/admin/users'){
      const u=clean(url.searchParams.get('userId'),100);if(!this.isAdmin(u))return json({error:'دسترسی مدیریت مجاز نیست.'},403);return json({ok:true,users:this.ctx.storage.sql.exec('SELECT id,username,created_at,avatar,vip,role FROM users ORDER BY created_at DESC').toArray()});
    }
    if(p==='/admin/set-role'&&req.method==='POST'){
      let d;try{d=await req.json()}catch{return json({error:'اطلاعات نامعتبر است.'},400)}const admin=clean(d.adminId,100),target=clean(d.userId,100),role=d.role==='admin'?'admin':'user';if(!this.isAdmin(admin)||!this.user(target))return json({error:'دسترسی ندارید.'},403);this.ctx.storage.sql.exec("UPDATE users SET role=? WHERE id=?",role,target);return json({ok:true});
    }
    if(p==='/ws'){
      if(req.headers.get('Upgrade')!=='websocket')return new Response('WebSocket required',{status:426});
      const userId=clean(url.searchParams.get('userId'),100),username=norm(url.searchParams.get('username')),roomId=clean(url.searchParams.get('roomId'),100)||'global',me=this.user(userId);if(!me||me.username!==username)return json({error:'نشست نامعتبر است.'},401);
      let privateKey=null,target=null;if(roomId.startsWith('private:')){target=clean(roomId.slice(8),100);if(!this.user(target)||target===userId)return json({error:'گفتگوی خصوصی نامعتبر است.'},404);privateKey=this.key(userId,target)}else if(!this.member(roomId,userId))return json({error:'دسترسی ندارید.'},403);
      const pair=new WebSocketPair(),ws=pair[1];this.ctx.acceptWebSocket(ws);ws.serializeAttachment({userId,username,roomId,privateKey,vip:!!me.vip,avatar:me.avatar||null});
      const messages=privateKey?this.ctx.storage.sql.exec(`${this.select()} WHERE m.room_id IS NULL AND((m.sender_id=? AND m.receiver_id=?)OR(m.sender_id=? AND m.receiver_id=?)) ORDER BY m.created_at LIMIT 200`,userId,target,target,userId).toArray():this.ctx.storage.sql.exec(`${this.select()} WHERE m.room_id=? ORDER BY m.created_at LIMIT 200`,roomId).toArray();
      ws.send(JSON.stringify({type:'history',messages}));return new Response(null,{status:101,webSocket:pair[0]});
    }
    return new Response('ChatRoom OK');
  }

  async webSocketMessage(ws,message){
    let d;try{d=JSON.parse(typeof message==='string'?message:new TextDecoder().decode(message))}catch{return}
    const a=ws.deserializeAttachment()||{},from=a.userId;if(!from)return;
    if(d.type==='mark_read'&&a.privateKey){const m=this.ctx.storage.sql.exec("SELECT id,receiver_id,read_at FROM messages WHERE id=?",clean(d.messageId,100)).toArray()[0];if(m&&m.receiver_id===from&&!m.read_at){const now=Date.now();this.ctx.storage.sql.exec("UPDATE messages SET read_at=? WHERE id=?",now,m.id);this.broadcast(a.privateKey,{type:'message_read',messageId:m.id,readAt:now});}return;}
    if(d.type==='private_message'){
      const to=clean(d.receiverId,100),body=clean(d.body,2000);if(!this.user(to)||to===from||!body)return;const m={id:uid(),sender_id:from,receiver_id:to,room_id:null,body,message_type:'text',media:null,created_at:Date.now(),read_at:null,username:a.username,avatar:a.avatar||null,vip:!!a.vip};this.ctx.storage.sql.exec("INSERT INTO messages(id,sender_id,receiver_id,room_id,body,message_type,media,created_at,read_at) VALUES(?,?,?,?,?,?,?,?,?)",m.id,from,to,null,body,'text',null,m.created_at,null);this.broadcast(this.key(from,to),{type:'private_message',message:m});this.broadcast(this.key(from,to),{type:'message_delivered',messageId:m.id});return;
    }
    if(d.type==='voice_message'){
      const to=clean(d.receiverId,100),media=String(d.media||'');if(!this.user(to)||to===from||!/^data:audio\//i.test(media)||media.length>1000000)return;const m={id:uid(),sender_id:from,receiver_id:to,room_id:null,body:'',message_type:'voice',media,created_at:Date.now(),read_at:null,username:a.username,avatar:a.avatar||null,vip:!!a.vip};this.ctx.storage.sql.exec("INSERT INTO messages(id,sender_id,receiver_id,room_id,body,message_type,media,created_at,read_at) VALUES(?,?,?,?,?,?,?,?,?)",m.id,from,to,null,'','voice',media,m.created_at,null);this.broadcast(this.key(from,to),{type:'private_message',message:m});this.broadcast(this.key(from,to),{type:'message_delivered',messageId:m.id});return;
    }
    if(d.type==='room_message'){const roomId=clean(d.roomId,100)||a.roomId,body=clean(d.body,2000);if(!this.member(roomId,from)||!body)return;const m={id:uid(),sender_id:from,receiver_id:null,room_id:roomId,body,message_type:'text',media:null,created_at:Date.now(),read_at:null,username:a.username,avatar:a.avatar||null,vip:!!a.vip};this.ctx.storage.sql.exec("INSERT INTO messages(id,sender_id,receiver_id,room_id,body,message_type,media,created_at,read_at) VALUES(?,?,?,?,?,?,?,?,?)",m.id,from,null,roomId,body,'text',null,m.created_at,null);for(const w of this.ctx.getWebSockets()){const q=w.deserializeAttachment()||{};if(!q.privateKey&&q.roomId===roomId)try{w.send(JSON.stringify({type:'room_message',message:m}))}catch{}}}
  }
  async webSocketClose(ws){try{ws.close()}catch{}}
  async webSocketError(ws){try{ws.close()}catch{}}
}
