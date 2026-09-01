const $ = (id) => document.getElementById(id);

let token = localStorage.getItem('chat_token') || '';
let me = null;
let socket = null;
let currentUser = null;
let currentRoom = null;
let users = [];

const authBox = $('auth');
const chatBox = $('chat');
const authForm = $('authForm');
const authError = $('authError');
const usernameInput = $('username');
const passwordInput = $('password');
const meLabel = $('me');
const usersBox = $('users');
const searchInput = $('search');
const messagesBox = $('messages');
const messageInput = $('message');
const sendForm = $('sendForm');
const emptyBox = $('empty');
const conversation = $('conversation');
const chatWith = $('chatWith');
const statusLabel = $('status');
const publicRoom = $('publicRoom');
const logoutBtn = $('logout');
const backBtn = $('backBtn');

let authMode = 'login';

document.querySelectorAll('.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    authMode = btn.dataset.mode;
    authForm.querySelector('button').textContent =
      authMode === 'login' ? 'ورود' : 'ثبت‌نام';
    authError.textContent = '';
  });
});

async function api(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || 'خطایی رخ داد.');
  }

  return data;
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  try {
    const data = await api(
      authMode === 'login' ? '/api/login' : '/api/register',
      {
        method: 'POST',
        body: JSON.stringify({ username, password })
      }
    );

    token = data.token;
    localStorage.setItem('chat_token', token);

    await startChat();
  } catch (err) {
    authError.textContent = err.message;
  }
});

async function startChat() {
  try {
    const data = await api('/api/me');
    me = data.user;

    authBox.classList.add('hidden');
    chatBox.classList.remove('hidden');
    meLabel.textContent = '@' + me.username;

    connectSocket();
    await loadUsers();
  } catch (err) {
    logout();
  }
}

function connectSocket() {
  if (socket) socket.disconnect();

  socket = io({
    auth: { token }
  });

  socket.on('connect_error', () => {
    console.log('Socket connection error');
  });

  socket.on('presence', (data) => {
    const user = users.find(u => u.id === data.userId);
    if (user) {
      user.online = data.online;
      renderUsers();
    }

    if (currentUser && currentUser.id === data.userId) {
      statusLabel.textContent = data.online ? 'آنلاین' : 'آفلاین';
    }
  });

  socket.on('private_message', (message) => {
    if (
      currentUser &&
      (
        message.sender_id === currentUser.id ||
        message.receiver_id === currentUser.id
      )
    ) {
      appendMessage(message);
      scrollMessages();
    }
  });

  socket.on('room_message', (message) => {
    if (currentRoom && message.room_id === currentRoom.id) {
      appendMessage(message);
      scrollMessages();
    }
  });
}

async function loadUsers() {
  try {
    const data = await api('/api/users');
    users = data.users || [];
    users.forEach(u => u.online = false);
    renderUsers();
  } catch (err) {
    console.error(err);
  }
}

function renderUsers() {
  usersBox.innerHTML = '';

  if (!users.length) {
    usersBox.innerHTML =
      '<div class="muted">هنوز کاربر دیگری ثبت‌نام نکرده است.</div>';
    return;
  }

  users.forEach(user => {
    const item = document.createElement('button');
    item.className = 'userItem';
    item.innerHTML = `
      <span class="avatar">${escapeHtml(user.username.charAt(0).toUpperCase())}</span>
      <span class="userInfo">
        <b>${escapeHtml(user.username)}</b>
        <small>${user.online ? 'آنلاین' : 'آفلاین'}</small>
      </span>
      <span class="dot ${user.online ? 'online' : ''}"></span>
    `;

    item.addEventListener('click', () => openPrivateChat(user));
    usersBox.appendChild(item);
  });
}

searchInput?.addEventListener('input', async () => {
  const q = searchInput.value.trim();

  try {
    const data = await api('/api/users?q=' + encodeURIComponent(q));
    users = data.users || [];
    renderUsers();
  } catch (err) {
    console.error(err);
  }
});

publicRoom?.addEventListener('click', () => openPublicRoom());

async function openPublicRoom() {
  try {
    const data = await api('/api/rooms');
    const room = (data.rooms || []).find(r => r.name === 'دورهمی');

    if (!room) {
      alert('اتاق دورهمی پیدا نشد.');
      return;
    }

    await api(`/api/rooms/${room.id}/join`, {
      method: 'POST'
    });

    currentRoom = room;
    currentUser = null;

    chatWith.textContent = '🌟 اتاق دورهمی';
    statusLabel.textContent = 'گفتگوی عمومی';

    emptyBox.classList.add('hidden');
    conversation.classList.remove('hidden');

    messagesBox.innerHTML = '';

    const dataMessages = await api(`/api/rooms/${room.id}/messages`);

    dataMessages.messages.forEach(appendMessage);

    socket.emit('join_room', room.id);

    scrollMessages();
  } catch (err) {
    alert(err.message);
  }
}

async function openPrivateChat(user) {
  currentUser = user;
  currentRoom = null;

  chatWith.textContent = '@' + user.username;
  statusLabel.textContent = user.online ? 'آنلاین' : 'آفلاین';

  emptyBox.classList.add('hidden');
  conversation.classList.remove('hidden');

  messagesBox.innerHTML = '';

  try {
    const data = await api(`/api/messages/${user.id}`);
    data.messages.forEach(appendMessage);
    scrollMessages();
  } catch (err) {
    alert(err.message);
  }
}

sendForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const body = messageInput.value.trim();
  if (!body || !socket) return;

  if (currentUser) {
    socket.emit('private_message', {
      receiverId: currentUser.id,
      body
    });
  } else if (currentRoom) {
    socket.emit('room_message', {
      roomId: currentRoom.id,
      body
    });
  }

  messageInput.value = '';
  messageInput.focus();
});

function appendMessage(message) {
  const mine = message.sender_id === me.id;

  const item = document.createElement('div');
  item.className = 'message ' + (mine ? 'mine' : 'other');

  const time = new Date(message.created_at).toLocaleTimeString(
    'fa-IR',
    { hour: '2-digit', minute: '2-digit' }
  );

  item.innerHTML = `
    <div class="bubble">
      <div class="body">${escapeHtml(message.body)}</div>
      <small>${time}</small>
    </div>
  `;

  messagesBox.appendChild(item);
}

function scrollMessages() {
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

backBtn?.addEventListener('click', () => {
  currentUser = null;
  currentRoom = null;

  conversation.classList.add('hidden');
  emptyBox.classList.remove('hidden');
  messagesBox.innerHTML = '';
});

logoutBtn?.addEventListener('click', logout);

function logout() {
  token = '';
  me = null;
  currentUser = null;
  currentRoom = null;

  localStorage.removeItem('chat_token');

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  chatBox.classList.add('hidden');
  authBox.classList.remove('hidden');

  usernameInput.value = '';
  passwordInput.value = '';
  messagesBox.innerHTML = '';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

if (token) {
  startChat();
}
