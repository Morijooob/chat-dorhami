const j=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json;charset=utf-8"}});
export class ChatRoom{
 constructor(state){this.s=state;this.ready=this.init()}
 async init(){this.s.storage.sql.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL,text TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`)}
 async fetch(r){await this.ready;let u=new URL(r.url);
  if(u.pathname==="/health")return j({ok:true});
  if((u.pathname==="/register"||u.pathname==="/login")&&r.method==="POST"){
   let b=await r.json().catch(()=>null);if(!b)return j({ok:false,error:"درخواست نامعتبر است"},400);
   let n=String(b.username||"").trim(),p=String(b.passwordHash||"");
   if(!/^[\\p{L}\\p{N}_]{3,24}$/u.test(n)||!/^[a-f0-9]{64}$/i.test(p))return j({ok:false,error:"نام کاربری یا رمز عبور نامعتبر است"},400);
   if(u.pathname==="/register"){
    let x=[...this.s.storage.sql.exec("SELECT id FROM users WHERE username=?",n)];if(x.length)return j({ok:false,error:"این نام کاربری قبلاً ثبت شده است"},409);
    let q=this.s.storage.sql.exec("INSERT INTO users(username,password_hash) VALUES(?,?)",n,p);return j({ok:true,user:{id:Number(q.lastInsertRowId),username:n}},201)
   }
   let x=[...this.s.storage.sql.exec("SELECT id,username FROM users WHERE username=? AND password_hash=?",n,p)];if(!x.length)return j({ok:false,error:"نام کاربری یا رمز عبور اشتباه است"},401);return j({ok:true,user:x[0]})
  }
  if(u.pathname==="/messages"&&r.method==="GET")return j({ok:true,messages:[...this.s.storage.sql.exec("SELECT id,username,text,created_at FROM messages ORDER BY id DESC LIMIT 100")].reverse()});
  if(u.pathname==="/messages"&&r.method==="POST"){
   let b=await r.json().catch(()=>null),n=String(b?.username||"").trim(),t=String(b?.text||"").trim();if(!n||!t||t.length>1000)return j({ok:false,error:"پیام نامعتبر است"},400);this.s.storage.sql.exec("INSERT INTO messages(username,text) VALUES(?,?)",n,t);return j({ok:true})
  }
  return j({ok:false,error:"Not found"},404)
 }
}
export default{async fetch(r,e){let u=new URL(r.url);if(u.pathname==="/"||u.pathname==="/index.html"){let t=new URL(r.url);t.pathname="/index.html";return e.ASSETS.fetch(new Request(t,r))}let id=e.CHAT_ROOM.idFromName("chat-dorhami-global");return e.CHAT_ROOM.get(id).fetch(r)}};
