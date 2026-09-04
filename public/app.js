const $ = (s) => document.querySelector(s);
const authView = $('#authView');
const chatView = $('#chatView');
const authForm = $('#authForm');
const authStatus = $('#authStatus');
const authText = $('#authText');
const usernameInput = $('#username');
const passwordInput = $('#password');
const messagesEl = $('#messages');
const messageForm = $('#messageForm');
const messageInput = $('#messageInput');
let mode = 'login';
let username = localStorage.getItem('dorhami_user') || '';
let timer = null;
let presenceTimer = null;

function setMode(next) {
  mode = next;
  document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === next));
  authText.textContent = next === 'login' ? 'وارد شدن' : 'ساخت حساب';
  passwordInput.autocomplete = next === 'login' ? 'current-password' : 'new-password';
  authStatus.textContent = '';
}

document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({ error: 'پاسخ نامعتبر از سرور' }));
  if (!response.ok) throw new Error(data.error || 'خطایی رخ داد');
  return data;
}

async function updatePresence() {
  if (!username) return;
  try {
    await api('/presence', { method: 'POST', body: JSON.stringify({ username }) });
    const data = await api('/presence', { method: 'GET', headers: {} });
    const names = (data.users || []).map(u => u.username);
    const label = `${data.count || 0} نفر آنلاین`;
    $('#onlineText').textContent = `${label} · ${username}`;
    $('#onlineText').title = names.length ? `آنلاین‌ها: ${names.join('، ')}` : 'فعلاً کسی آنلاین نیست';
    const miniCount = document.querySelector('.mini-count');
    if (miniCount) miniCount.textContent = `● ${label}`;
  } catch (error) {
    // Presence is optional; chat should continue working if it is temporarily unavailable.
  }
}

function startPresence() {
  if (presenceTimer) clearInterval(presenceTimer);
  updatePresence();
  presenceTimer = setInterval(updatePresence, 10000);
}

function stopPresence() {
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = null;
}

function showChat() {
  authView.classList.add('hidden');
  chatView.classList.remove('hidden');
  $('#onlineText').textContent = `در حال اتصال · ${username}`;
  loadMessages();
  startPresence();
  if (timer) clearInterval(timer);
  timer = setInterval(loadMessages, 2500);
  messageInput.focus();
}

function showAuth() {
  if (timer) clearInterval(timer);
  stopPresence();
  chatView.classList.add('hidden');
  authView.classList.remove('hidden');
}

function renderMessages(list) {
  if (!list.length) {
    messagesEl.innerHTML = '<div class="welcome"><b>به دورهمی خوش اومدی 🌙</b><span>اولین پیام رو تو بفرست!</span></div>';
    return;
  }
  messagesEl.innerHTML = list.map(m => {
    const mine = m.username === username ? ' mine' : '';
    const time = new Date(m.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    return `<article class="message${mine}"><div class="meta">${escapeHtml(m.username)} · ${time}</div><div class="body">${escapeHtml(m.text)}</div></article>`;
  }).join('');
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

async function loadMessages() {
  try {
    const data = await api('/messages', { method: 'GET', headers: {} });
    renderMessages(data.messages || []);
  } catch (error) {
    $('#onlineText').textContent = 'اتصال دوباره در حال تلاش است…';
  }
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authStatus.textContent = 'در حال اتصال…';
  const usernameValue = usernameInput.value.trim();
  const password = passwordInput.value;
  try {
    const data = await api(`/${mode === 'login' ? 'login' : 'register'}`, {
      method: 'POST', body: JSON.stringify({ username: usernameValue, password })
    });
    username = data.username || usernameValue;
    localStorage.setItem('dorhami_user', username);
    passwordInput.value = '';
    showChat();
  } catch (error) {
    authStatus.textContent = error.message;
  }
});

messageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  messageInput.disabled = true;
  try {
    await api('/messages', { method: 'POST', body: JSON.stringify({ username, text }) });
    messageInput.value = '';
    await loadMessages();
  } catch (error) {
    $('#onlineText').textContent = error.message;
  } finally {
    messageInput.disabled = false;
    messageInput.focus();
  }
});

$('#logout').addEventListener('click', async () => {
  const leavingUser = username;
  stopPresence();
  try {
    await api('/presence', { method: 'DELETE', body: JSON.stringify({ username: leavingUser }) });
  } catch (error) {}
  localStorage.removeItem('dorhami_user');
  username = '';
  showAuth();
});

if (username) {
  usernameInput.value = username;
  showChat();
}
