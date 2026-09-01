import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'chat.db'));
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be set and at least 32 characters long.');
  process.exit(1);
}

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rooms(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS room_members(room_id INTEGER NOT NULL, user_id INTEGER NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY(room_id,user_id), FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER NOT NULL, receiver_id INTEGER, room_id INTEGER, body TEXT NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE);
`);
const seedRoom = db.prepare('SELECT id FROM rooms WHERE name=?').get('دورهمی');
if (!seedRoom) db.prepare('INSERT INTO rooms(name,description,created_at) VALUES(?,?,?)').run('دورهمی','اتاق عمومی چت دورهمی',Date.now());

const tokenFor = user => jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
function auth(req,res,next){try{const h=req.headers.authorization||'';req.user=jwt.verify(h.startsWith('Bearer ')?h.slice(7):'',JWT_SECRET);next()}catch{res.status(401).json({error:'UNAUTHORIZED'})}}
function cleanBody(v){return String(v??'').replace(/\u0000/g,'').trim().slice(0,2000)}

app.get('/api/health',(req,res)=>res.json({ok:true,version:'2.0-online'}));
app.post('/api/register',(req,res)=>{const username=String(req.body.username||'').trim().toLowerCase();const password=String(req.body.password||'');if(!/^[a-z0-9_]{3,24}$/.test(username))return res.status(400).json({error:'نام کاربری باید ۳ تا ۲۴ کاراکتر انگلیسی، عدد یا _ باشد.'});if(password.length<8)return res.status(400).json({error:'رمز عبور حداقل ۸ کاراکتر باشد.'});try{const hash=bcrypt.hashSync(password,12);const info=db.prepare('INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)').run(username,hash,Date.now());const user={id:Number(info.lastInsertRowid),username};const room=db.prepare('SELECT id FROM rooms WHERE name=?').get('دورهمی');db.prepare('INSERT INTO room_members(room_id,user_id,joined_at) VALUES(?,?,?)').run(room.id,user.id,Date.now());res.json({user,token:tokenFor(user)})}catch{res.status(409).json({error:'این نام کاربری قبلاً ثبت شده است.'})}});
app.post('/api/login',(req,res)=>{const username=String(req.body.username||'').trim().toLowerCase();const password=String(req.body.password||'');const user=db.prepare('SELECT id,username,password_hash FROM users WHERE username=?').get(username);if(!user||!bcrypt.compareSync(password,user.password_hash))return res.status(401).json({error:'نام کاربری یا رمز عبور اشتباه است.'});const safe={id:user.id,username:user.username};res.json({user:safe,token:tokenFor(safe)})});
app.get('/api/me',auth,(req,res)=>res.json({user:req.user}));
app.get('/api/users',auth,(req,res)=>{const q=String(req.query.q||'').trim().toLowerCase();const users=db.prepare('SELECT id,username,created_at FROM users WHERE id!=? AND username LIKE ? ORDER BY username LIMIT 50').all(req.user.id,`%${q}%`);res.json({users})});
app.get('/api/rooms',auth,(req,res)=>res.json({rooms:db.prepare('SELECT id,name,description,created_at FROM rooms ORDER BY id').all()}));
app.post('/api/rooms/:id/join',auth,(req,res)=>{const id=Number(req.params.id);const room=db.prepare('SELECT id FROM rooms WHERE id=?').get(id);if(!room)return res.status(404).json({error:'اتاق پیدا نشد.'});db.prepare('INSERT OR IGNORE INTO room_members(room_id,user_id,joined_at) VALUES(?,?,?)').run(id,req.user.id,Date.now());res.json({ok:true})});
app.get('/api/rooms/:id/messages',auth,(req,res)=>{const id=Number(req.params.id);const member=db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').get(id,req.user.id);if(!member)return res.status(403).json({error:'ابتدا وارد اتاق شوید.'});const messages=db.prepare('SELECT id,sender_id,body,created_at FROM messages WHERE room_id=? ORDER BY id DESC LIMIT 100').all(id).reverse();res.json({messages})});
app.get('/api/messages/:userId',auth,(req,res)=>{const id=Number(req.params.userId);const rows=db.prepare('SELECT id,sender_id,receiver_id,body,created_at FROM messages WHERE room_id IS NULL AND ((sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?)) ORDER BY id DESC LIMIT 100').all(req.user.id,id,id,req.user.id).reverse();res.json({messages:rows})});

const online=new Map();
io.use((socket,next)=>{try{socket.user=jwt.verify(socket.handshake.auth?.token||'',JWT_SECRET);next()}catch{next(new Error('unauthorized'))}});
io.on('connection',socket=>{
  online.set(socket.user.id,socket.id);
  io.emit('presence',{userId:socket.user.id,online:true});
  socket.on('join_room',roomId=>{const id=Number(roomId);const ok=db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').get(id,socket.user.id);if(ok)socket.join('room:'+id)});
  socket.on('private_message',data=>{const receiverId=Number(data.receiverId);const body=cleanBody(data.body);if(!receiverId||!body)return;const now=Date.now();const info=db.prepare('INSERT INTO messages(sender_id,receiver_id,body,created_at) VALUES(?,?,?,?)').run(socket.user.id,receiverId,body,now);const message={id:Number(info.lastInsertRowid),sender_id:socket.user.id,receiver_id:receiverId,body,created_at:now};socket.emit('private_message',message);const target=online.get(receiverId);if(target)io.to(target).emit('private_message',message)});
  socket.on('room_message',data=>{const roomId=Number(data.roomId);const body=cleanBody(data.body);if(!roomId||!body)return;const member=db.prepare('SELECT 1 FROM room_members WHERE room_id=? AND user_id=?').get(roomId,socket.user.id);if(!member)return;const now=Date.now();const info=db.prepare('INSERT INTO messages(sender_id,room_id,body,created_at) VALUES(?,?,?,?)').run(socket.user.id,roomId,body,now);io.to('room:'+roomId).emit('room_message',{id:Number(info.lastInsertRowid),sender_id:socket.user.id,room_id:roomId,body,created_at:now})});
  socket.on('disconnect',()=>{if(online.get(socket.user.id)===socket.id){online.delete(socket.user.id);io.emit('presence',{userId:socket.user.id,online:false})}})
});

const PORT=Number(process.env.PORT||3000);server.listen(PORT,()=>console.log(`Chat Dorhami online server listening on ${PORT}`));
