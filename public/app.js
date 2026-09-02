'use strict';

const API = '/api';

let token = localStorage.getItem('chat_dorhami_token') || '';
let currentUser = null;
let currentMode = 'login';
let socket = null;
let currentChatUser = null;
let currentRoom = null;

// -----------------------------
// Helpers
// -----------------------------

const $ = (id) => document.getElementById(id);

function setError(message = '') {
  const box = $('authError');
  if (box) box.textContent = message;
}

function saveSession(data) {
  token = data.token || '';
  currentUser = data.user || null;

  if (token) {
    localStorage.setItem('chat_dorhami_token', token);
  }

  if (currentUser) {
    localStorage.setItem(
      'chat_dorhami_user',
      JSON.stringify(currentUser)
    );
  }
}

function clearSession() {
  token = '';
  currentUser = null;

  localStorage.removeItem('chat_dorhami_token');
  localStorage.removeItem('chat_dorhami_user');
}

async function api(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(API + url, {
    ...options,
    headers
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.error || `خطا در ارتباط با سرور (${response.status})`
    );
  }

  return data;
}

// -----------------------------
// Auth tabs
// -----------------------------

function setMode(mode) {
  currentMode = mode;

  document
    .querySelectorAll('.tabs button')
    .forEach(button => {
      button.classList.toggle(
        'active',
        button.dataset.mode === mode
      );
    });

  const submitButton =
    document.querySelector('#authForm button[type="submit"]');

  if (submitButton) {
    submitButton.textContent =
      mode === 'register' ? 'ثبت‌نام' : 'ورود';
  }

  const password = $('password');

  if (password) {
    password.autocomplete =
      mode === 'register'
        ? 'new-password'
        : 'current-password';
  }

  setError('');
}

// -----------------------------
// Register / Login
// -----------------------------

async function handleAuth(event) {
  event.preventDefault();

  setError('');

  const username = $('username')?.value.trim().toLowerCase();
  const password = $('password')?.value || '';

  if (!username) {
    setError('نام کاربری را وارد کن.');
    return;
  }

  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    setError(
      'نام کاربری باید ۳ تا ۲۴ کاراکتر انگلیسی، عدد یا _ باشد.'
    );
    return;
  }

  if (password.length < 8) {
    setError('رمز عبور باید حداقل ۸ کاراکتر باشد.');
    return;
  }

  const submitButton =
    document.querySelector('#authForm button[type="submit"]');

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent =
      currentMode === 'register'
        ? 'در حال ثبت‌نام...'
        : 'در حال ورود...';
  }

  try {
    const endpoint =
      currentMode === 'register'
        ? '/register'
        : '/login';

    const data = await api(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        username,
        password
      })
    });

    saveSession(data);

    $('auth').classList.add('hidden');
    $('chat').classList.remove('hidden');

    if ($('me')) {
      $('me').textContent =
        '@' + (currentUser?.username || username);
    }

    await startChat();

  } catch (error) {
    console.error('AUTH ERROR:', error);
    setError(error.message || 'خطایی رخ داد.');
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent =
        currentMode === 'register'
          ? 'ثبت‌نام'
          : 'ورود';
    }
  }
}

// -----------------------------
// Session
// -----------------------------

async function restoreSession() {
  if (!token) return false;

  try {
    const data = await api('/me');

    currentUser = data.user;

    localStorage.setItem(
      'chat_dorhami_user',
      JSON.stringify(currentUser)
    );

    $('auth').classList.add('hidden');
    $('chat').classList.remove('hidden');

    if ($('me')) {
      $('me').textContent =
        '@' + currentUser.username;
    }

    await startChat();

    return true;

  } catch (error) {
    console.warn('Session expired:', error);
    clearSession();
    return false;
  }
}

// -----------------------------
// Socket.IO
// -----------------------------

function connectSocket() {
  if (!token) return;

  if (typeof io !== 'function') {
    console.error(
      'Socket.IO library is not loaded.'
    );
    return;
  }

  if (socket) {
    try {
      socket.disconnect();
    } catch {}
  }

  socket = io({
    auth: {
      token
    }
  });

  socket.on('connect', () => {
    console.log('Socket connected');
  });

  socket.on('connect_error', error => {
    console.error(
      'Socket connection error:',
      error.message
    );
  });

  socket.on('presence', data => {
    updateUserPresence(data);
  });

  socket.on('private_message', message => {
    handleIncomingPrivateMessage(message);
  });

  socket.on('room_message', message => {
    handleIncomingRoomMessage(message);
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });
}

// -----------------------------
// Chat startup
// -----------------------------

async function startChat() {
  connectSocket();

  await loadUsers();
  await loadRooms();

  showEmpty();
}

// -----------------------------
// Users
// -----------------------------

async function loadUsers(query = '') {
  try {
    const data = await api(
      '/users?q=' +
      encodeURIComponent(query)
    );

    renderUsers(data.users || []);

  } catch (error) {
    console.error(
      'Could not load users:',
      error
    );
  }
}

function renderUsers(users) {
  const container = $('users');

  if (!container) return;

  container.innerHTML = '';

  if (!users.length) {
    container.innerHTML =
      '<div class="emptyUsers">کاربری پیدا نشد.</div>';
    return;
  }

  users.forEach(user => {
    const item = document.createElement('button');

    item.type = 'button';
    item.className = 'userItem';
    item.dataset.userId = user.id;

    item.innerHTML = `
      <span class="avatar">👤</span>
      <span class="userInfo">
        <b>${escapeHtml(user.username)}</b>
        <small class="presence" data-presence-id="${user.id}">
          آفلاین
        </small>
      </span>
    `;

    item.addEventListener('click', () => {
      openPrivateChat(user);
    });

    container.appendChild(item);
  });
}

function updateUserPresence(data) {
  const element = document.querySelector(
    `[data-presence-id="${data.userId}"]`
  );

  if (!element) return;

  element.textContent =
    data.online ? 'آنلاین' : 'آفلاین';

  element.classList.toggle(
    'online',
    !!data.online
  );
}

// -----------------------------
// Rooms
// -----------------------------

async function loadRooms() {
  try {
    const data = await api('/rooms');

    const room =
      (data.rooms || []).find(
        r => r.name === 'دورهمی'
      );

    currentRoom = room || null;

  } catch (error) {
    console.error(
      'Could not load rooms:',
      error
    );
  }
}

async function openPublicRoom() {
  if (!currentRoom) {
    await loadRooms();
  }

  if (!currentRoom) {
    showErrorInChat('اتاق دورهمی پیدا نشد.');
    return;
  }

  try {
    await api(
      `/rooms/${currentRoom.id}/join`,
      {
        method: 'POST'
      }
    );

    if (socket) {
      socket.emit(
        'join_room',
        currentRoom.id
      );
    }

    currentChatUser = null;

    $('empty').classList.add('hidden');
    $('conversation').classList.remove('hidden');

    $('chatWith').textContent =
      '🌟 اتاق دورهمی';

    $('status').textContent =
      'گفتگوی عمومی';

    await loadRoomMessages();

  } catch (error) {
    showErrorInChat(error.message);
  }
}

async function loadRoomMessages() {
  if (!currentRoom) return;

  try {
    const data = await api(
      `/rooms/${currentRoom.id}/messages`
    );

    renderMessages(
      data.messages || [],
      true
    );

  } catch (error) {
    console.error(
      'Room messages error:',
      error
    );
  }
}

// -----------------------------
// Private chat
// -----------------------------

async function openPrivateChat(user) {
  currentChatUser = user;
  currentRoom = null;

  $('empty').classList.add('hidden');
  $('conversation').classList.remove('hidden');

  $('chatWith').textContent =
    '@' + user.username;

  $('status').textContent =
    'گفتگوی خصوصی';

  try {
    const data = await api(
      `/messages/${user.id}`
    );

    renderMessages(
      data.messages || [],
      false
    );

  } catch (error) {
    showErrorInChat(error.message);
  }
}

// -----------------------------
// Messages
// -----------------------------

function renderMessages(messages, isRoom) {
  const container = $('messages');

  if (!container) return;

  container.innerHTML = '';

  messages.forEach(message => {
    addMessageToScreen(
      message,
      isRoom
    );
  });

  scrollMessagesToBottom();
}

function addMessageToScreen(message, isRoom) {
  const container = $('messages');

  if (!container) return;

  const mine =
    Number(message.sender_id) ===
    Number(currentUser?.id);

  const row = document.createElement('div');

  row.className =
    'message ' +
    (mine ? 'mine' : 'theirs');

  const body = document.createElement('div');

  body.className = 'messageBody';

  body.textContent =
    message.body || '';

  row.appendChild(body);

  if (isRoom && !mine) {
    const sender = document.createElement('small');

    sender.className =
      'messageSender';

    sender.textContent =
      'کاربر #' + message.sender_id;

    row.prepend(sender);
  }

  container.appendChild(row);
}

function handleIncomingPrivateMessage(message) {
  if (!currentChatUser) return;

  const senderId =
    Number(message.sender_id);

  const receiverId =
    Number(message.receiver_id);

  const me =
    Number(currentUser?.id);

  const belongsToCurrentChat =
    (
      senderId === me &&
      receiverId === Number(currentChatUser.id)
    ) ||
    (
      receiverId === me &&
      senderId === Number(currentChatUser.id)
    );

  if (!belongsToCurrentChat) return;

  addMessageToScreen(
    message,
    false
  );

  scrollMessagesToBottom();
}

function handleIncomingRoomMessage(message) {
  if (!currentRoom) return;

  if (
    Number(message.room_id) !==
    Number(currentRoom.id)
  ) {
    return;
  }

  addMessageToScreen(
    message,
    true
  );

  scrollMessagesToBottom();
}

async function handleSend(event) {
  event.preventDefault();

  const input = $('message');

  if (!input) return;

  const body = input.value.trim();

  if (!body) return;

  if (!socket || !socket.connected) {
    showErrorInChat(
      'ارتباط با سرور برقرار نیست.'
    );
    return;
  }

  if (currentChatUser) {
    socket.emit(
      'private_message',
      {
        receiverId:
          Number(currentChatUser.id),
        body
      }
    );

  } else if (currentRoom) {
    socket.emit(
      'room_message',
      {
        roomId:
          Number(currentRoom.id),
        body
      }
    );

  } else {
    return;
  }

  input.value = '';
  input.focus();
}

// -----------------------------
// UI
// -----------------------------

function showEmpty() {
  $('empty')?.classList.remove('hidden');
  $('conversation')?.classList.add('hidden');

  currentChatUser = null;
  currentRoom = null;
}

function showErrorInChat(message) {
  console.error(message);

  const container = $('messages');

  if (!container) return;

  const error = document.createElement('div');

  error.className =
    'chatError';

  error.textContent =
    message || 'خطایی رخ داد.';

  container.innerHTML = '';
  container.appendChild(error);
}

function scrollMessagesToBottom() {
  const container = $('messages');

  if (!container) return;

  container.scrollTop =
    container.scrollHeight;
}

// -----------------------------
// Logout
// -----------------------------

function logout() {
  if (socket) {
    try {
      socket.disconnect();
    } catch {}
  }

  clearSession();

  currentChatUser = null;
  currentRoom = null;

  $('chat')?.classList.add('hidden');
  $('auth')?.classList.remove('hidden');

  $('username').value = '';
  $('password').value = '';

  setMode('login');
  setError('');
}

// -----------------------------
// HTML escaping
// -----------------------------

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// -----------------------------
// Start application
// -----------------------------

function startApp() {
  console.log(
    'چت دورهمی: application started'
  );

  // Auth tabs
  document
    .querySelectorAll('.tabs button')
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          setMode(
            button.dataset.mode
          );
        }
      );
    });

  // Auth form
  const authForm = $('authForm');

  if (authForm) {
    authForm.addEventListener(
      'submit',
      handleAuth
    );
  }

  // Logout
  $('logout')?.addEventListener(
    'click',
    logout
  );

  // Public room
  $('publicRoom')?.addEventListener(
    'click',
    openPublicRoom
  );

  // Back
  $('backBtn')?.addEventListener(
    'click',
    showEmpty
  );

  // Send message
  $('sendForm')?.addEventListener(
    'submit',
    handleSend
  );

  // Search
  let searchTimer = null;

  $('search')?.addEventListener(
    'input',
    event => {
      clearTimeout(searchTimer);

      searchTimer = setTimeout(
        () => {
          loadUsers(
            event.target.value.trim()
          );
        },
        250
      );
    }
  );

  setMode('login');

  restoreSession();
}

// -----------------------------
// DOM ready
// -----------------------------

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    startApp,
    { once: true }
  );
} else {
  startApp();
}
