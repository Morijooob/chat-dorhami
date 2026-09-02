'use strict';

const API = '/api';

let token = localStorage.getItem('chat_dorhami_token') || '';
let currentUser = null;
let currentMode = 'login';
let socket = null;
let currentRoom = null;
let rooms = [];

/* =========================
   HELPERS
========================= */

const $ = id => document.getElementById(id);

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
      data.error ||
      `خطا در ارتباط با سرور (${response.status})`
    );
  }

  return data;
}

/* =========================
   AUTH MODE
========================= */

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

  const submit =
    document.querySelector(
      '#authForm button[type="submit"]'
    );

  if (submit) {
    submit.textContent =
      mode === 'register'
        ? 'ثبت‌نام'
        : 'ورود';
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

/* =========================
   REGISTER / LOGIN
========================= */

async function handleAuth(event) {
  event.preventDefault();

  setError('');

  const username =
    $('username')?.value.trim().toLowerCase();

  const password =
    $('password')?.value || '';

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
    setError(
      'رمز عبور باید حداقل ۸ کاراکتر باشد.'
    );
    return;
  }

  const button =
    document.querySelector(
      '#authForm button[type="submit"]'
    );

  if (button) {
    button.disabled = true;
    button.textContent =
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

    $('auth')?.classList.add('hidden');
    $('chat')?.classList.remove('hidden');

    if ($('me')) {
      $('me').textContent =
        '@' + currentUser.username;
    }

    await startChat();

  } catch (error) {
    console.error(error);
    setError(
      error.message ||
      'خطایی رخ داد.'
    );

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent =
        currentMode === 'register'
          ? 'ثبت‌نام'
          : 'ورود';
    }
  }
}

/* =========================
   RESTORE SESSION
========================= */

async function restoreSession() {
  if (!token) {
    return false;
  }

  try {
    const data =
      await api('/me');

    currentUser =
      data.user;

    localStorage.setItem(
      'chat_dorhami_user',
      JSON.stringify(currentUser)
    );

    $('auth')?.classList.add('hidden');
    $('chat')?.classList.remove('hidden');

    if ($('me')) {
      $('me').textContent =
        '@' + currentUser.username;
    }

    await startChat();

    return true;

  } catch (error) {
    console.warn(
      'Session expired',
      error
    );

    clearSession();

    return false;
  }
}

/* =========================
   START CHAT
========================= */

async function startChat() {
  await loadRooms();

  showEmpty();
}

/* =========================
   ROOMS
========================= */

async function loadRooms() {
  try {
    const data =
      await api('/rooms');

    rooms =
      Array.isArray(data.rooms)
        ? data.rooms
        : [];

    renderRooms();

  } catch (error) {
    console.error(
      'ROOM ERROR:',
      error
    );
  }
}

function renderRooms() {
  const publicButton =
    $('publicRoom');

  if (!publicButton) {
    return;
  }

  const room =
    rooms.find(
      r => r.id === 'public-main'
    );

  if (room) {
    publicButton.dataset.roomId =
      room.id;

    const name =
      publicButton.querySelector(
        '.room-info strong'
      );

    const description =
      publicButton.querySelector(
        '.room-info small'
      );

    if (name) {
      name.textContent =
        room.name;
    }

    if (description) {
      description.textContent =
        room.description ||
        'گفتگوی عمومی';
    }
  }

  /*
     اتاق‌های عمومی دیگر را
     به صورت خودکار اضافه می‌کنیم.
  */

  const sidebar =
    publicButton.parentElement;

  if (!sidebar) return;

  document
    .querySelectorAll(
      '[data-generated-room="true"]'
    )
    .forEach(el => el.remove());

  const publicRooms =
    rooms.filter(
      room =>
        room.type === 'public' &&
        room.id !== 'public-main'
    );

  publicRooms.forEach(room => {

    const button =
      document.createElement('button');

    button.type = 'button';

    button.className =
      'room-card';

    button.dataset.generatedRoom =
      'true';

    button.innerHTML = `
      <div class="room-icon">💬</div>

      <div class="room-info">
        <strong></strong>
        <small></small>
      </div>

      <span class="room-arrow">‹</span>
    `;

    button.querySelector(
      'strong'
    ).textContent =
      room.name;

    button.querySelector(
      'small'
    ).textContent =
      room.description ||
      'اتاق عمومی';

    button.addEventListener(
      'click',
      () => openRoom(room)
    );

    sidebar.insertBefore(
      button,
      $('search')?.parentElement ||
      null
    );
  });
}

/* =========================
   OPEN PUBLIC ROOM
========================= */

async function openPublicRoom() {
  const room =
    rooms.find(
      r => r.id === 'public-main'
    );

  if (!room) {
    await loadRooms();
  }

  const freshRoom =
    rooms.find(
      r => r.id === 'public-main'
    );

  if (!freshRoom) {
    showErrorInChat(
      'اتاق دورهمی پیدا نشد.'
    );
    return;
  }

  await openRoom(freshRoom);
}

/* =========================
   OPEN ROOM
========================= */

async function openRoom(room) {

  if (!room) return;

  try {

    await api(
      `/rooms/${encodeURIComponent(room.id)}/join`,
      {
        method: 'POST'
      }
    );

    currentRoom = room;

    $('empty')?.classList.add(
      'hidden'
    );

    $('conversation')?.classList.remove(
      'hidden'
    );

    if ($('chatWith')) {
      $('chatWith').textContent =
        room.name;
    }

    if ($('status')) {
      $('status').textContent =
        room.type === 'vip'
          ? 'اتاق VIP'
          : 'گفتگوی عمومی';
    }

    await connectWebSocket(
      room.id
    );

  } catch (error) {

    showErrorInChat(
      error.message ||
      'امکان ورود به اتاق وجود ندارد.'
    );
  }
}

/* =========================
   WEBSOCKET
========================= */

function connectWebSocket(roomId) {

  return new Promise(
    (resolve, reject) => {

      if (!token) {
        reject(
          new Error(
            'نشست کاربری معتبر نیست.'
          )
        );
        return;
      }

      closeSocket();

      const protocol =
        location.protocol === 'https:'
          ? 'wss:'
          : 'ws:';

      const url =
        `${protocol}//${location.host}` +
        `/ws?token=${encodeURIComponent(token)}` +
        `&roomId=${encodeURIComponent(roomId)}`;

      socket =
        new WebSocket(url);

      let opened = false;

      socket.onopen = () => {

        opened = true;

        if ($('status')) {
          $('status').textContent =
            'آنلاین 🟢';
        }

        resolve();
      };

      socket.onmessage = event => {

        try {

          const data =
            JSON.parse(event.data);

          handleSocketMessage(data);

        } catch (error) {

          console.error(
            'Invalid socket message',
            error
          );
        }
      };

      socket.onerror = error => {

        console.error(
          'WebSocket error',
          error
        );

        if (!opened) {
          reject(
            new Error(
              'ارتباط realtime با سرور برقرار نشد.'
            )
          );
        }
      };

      socket.onclose = () => {

        if (
          $('status') &&
          currentRoom
        ) {
          $('status').textContent =
            'اتصال قطع شد';
        }
      };
    }
  );
}

/* =========================
   SOCKET MESSAGE
========================= */

function handleSocketMessage(data) {

  if (!data) return;

  if (data.type === 'history') {

    renderMessages(
      data.messages || []
    );

    return;
  }

  if (data.type === 'message') {

    if (
      data.message &&
      currentRoom &&
      data.message.room_id ===
        currentRoom.id
    ) {

      addMessage(
        data.message
      );

      scrollMessages();
    }

    return;
  }

  if (data.type === 'error') {

    showErrorInChat(
      data.message ||
      'خطای ارتباطی'
    );

    return;
  }
}

/* =========================
   SEND MESSAGE
========================= */

function handleSend(event) {

  event.preventDefault();

  const input =
    $('message');

  if (!input) return;

  const body =
    input.value.trim();

  if (!body) return;

  if (
    !socket ||
    socket.readyState !==
      WebSocket.OPEN
  ) {

    showErrorInChat(
      'ارتباط با سرور برقرار نیست.'
    );

    return;
  }

  if (!currentRoom) {

    showErrorInChat(
      'ابتدا وارد یک اتاق شو.'
    );

    return;
  }

  socket.send(
    JSON.stringify({
      type: 'message',
      body
    })
  );

  input.value = '';

  input.focus();
}

/* =========================
   RENDER MESSAGES
========================= */

function renderMessages(messages) {

  const container =
    $('messages');

  if (!container) return;

  container.innerHTML = '';

  messages.forEach(
    message => {
      addMessage(message);
    }
  );

  scrollMessages();
}

function addMessage(message) {

  const container =
    $('messages');

  if (!container) return;

  const row =
    document.createElement('div');

  const mine =
    message.username ===
    currentUser?.username;

  row.className =
    'message ' +
    (mine
      ? 'mine'
      : 'theirs');

  const sender =
    document.createElement('small');

  sender.className =
    'messageSender';

  sender.textContent =
    message.username || 'کاربر';

  const body =
    document.createElement('div');

  body.className =
    'messageBody';

  body.textContent =
    message.body || '';

  row.appendChild(sender);
  row.appendChild(body);

  container.appendChild(row);
}

/* =========================
   SCROLL
========================= */

function scrollMessages() {

  const container =
    $('messages');

  if (!container) return;

  container.scrollTop =
    container.scrollHeight;
}

/* =========================
   EMPTY
========================= */

function showEmpty() {

  closeSocket();

  currentRoom = null;

  $('empty')?.classList.remove(
    'hidden'
  );

  $('conversation')?.classList.add(
    'hidden'
  );
}

/* =========================
   ERROR
========================= */

function showErrorInChat(message) {

  console.error(message);

  const container =
    $('messages');

  if (!container) return;

  container.innerHTML = '';

  const error =
    document.createElement('div');

  error.className =
    'chatError';

  error.textContent =
    message ||
    'خطایی رخ داد.';

  container.appendChild(error);
}

/* =========================
   LOGOUT
========================= */

function logout() {

  closeSocket();

  clearSession();

  currentRoom = null;

  $('chat')?.classList.add(
    'hidden'
  );

  $('auth')?.classList.remove(
    'hidden'
  );

  if ($('username')) {
    $('username').value = '';
  }

  if ($('password')) {
    $('password').value = '';
  }

  setMode('login');

  setError('');
}

/* =========================
   CLOSE SOCKET
========================= */

function closeSocket() {

  if (!socket) return;

  try {
    socket.close();
  } catch {}

  socket = null;
}

/* =========================
   START APP
========================= */

function startApp() {

  console.log(
    'چت دورهمی: application started'
  );

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

  $('authForm')?.addEventListener(
    'submit',
    handleAuth
  );

  $('logout')?.addEventListener(
    'click',
    logout
  );

  $('publicRoom')?.addEventListener(
    'click',
    openPublicRoom
  );

  $('backBtn')?.addEventListener(
    'click',
    showEmpty
  );

  $('sendForm')?.addEventListener(
    'submit',
    handleSend
  );

  setMode('login');

  restoreSession();
}

/* =========================
   DOM READY
========================= */

if (
  document.readyState ===
  'loading'
) {

  document.addEventListener(
    'DOMContentLoaded',
    startApp,
    { once: true }
  );

} else {

  startApp();

             }
