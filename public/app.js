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
let currentPrivateUser = '';

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

function avatarFor(name) {
  const clean = String(name || '').trim();
  return clean ? clean.charAt(0).toUpperCase() : '👤';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

function openProfile(name) {
  const profile = $('#profilePopover');
  if (!profile) return;
  const clean = String(name || '').trim();
  $('#profileAvatar').textContent = avatarFor(clean);
  $('#profileUsername').textContent = clean || 'کاربر';
  $('#profileStatus').textContent = clean === username ? 'پروفایل من' : 'عضو دورهمی';
  profile.classList.remove('hidden');
}

function closeProfile() {
  const profile = $('#profilePopover');
  if (profile) profile.classList.add('hidden');
}

function setupProfileEvents() {
  $('#myProfile')?.addEventListener('click', () => openProfile(username));
  $('#profileClose')?.addEventListener('click', closeProfile);
  document.addEventListener('click', (event) => {
    const profile = $('#profilePopover');
    if (!profile || profile.classList.contains('hidden')) return;
    if (!profile.contains(event.target) && !$('#myProfile')?.contains(event.target)) closeProfile();
  });
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
  } catch (error) {}
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
  $('#myAvatar').textContent = avatarFor(username);
  $('#myProfileName').textContent = username;
  currentPrivateUser = '';
  showPublicChat();
  startPresence();
  if (timer) clearInterval(timer);
  timer = setInterval(loadCurrentConversation, 2500);
  messageInput.focus();
}

function showAuth() {
  if (timer) clearInterval(timer);
  stopPresence();
  closeProfile();
  chatView.classList.add('hidden');
  authView.classList.remove('hidden');
}

function showPublicChat() {
  currentPrivateUser = '';
  $('#privateBar').classList.add('hidden');
  $('#roomName').textContent = 'اتاق عمومی دورهمی';
  messageInput.placeholder = 'پیامت رو بنویس...';
  loadMessages();
}

function renderMessages(list) {
  if (!list.length) {
    messagesEl.innerHTML = '<div class="welcome"><b>به دورهمی خوش اومدی 🌙</b><span>اولین پیام رو تو بفرست!</span></div>';
    return;
  }
  messagesEl.innerHTML = list.map(m => {
    const mine = m.username === username ? ' mine' : '';
    const time = new Date(m.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    return `<article class="message${mine}" data-username="${escapeHtml(m.username)}"><button class="message-user" type="button"><span class="message-avatar avatar">${escapeHtml(avatarFor(m.username))}</span><span class="meta">${escapeHtml(m.username)} · ${time}</span></button><div class="body">${escapeHtml(m.text)}</div></article>`;
  }).join('');
  messagesEl.querySelectorAll('.message-user').forEach(button => {
    button.addEventListener('click', () => openProfile(button.closest('.message')?.dataset.username || ''));
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderPrivateMessages(list) {
  if (!list.length) {
    messagesEl.innerHTML = '<div class="welcome"><b>گفتگوی خصوصی 🌙</b><span>اولین پیام را بفرست!</span></div>';
    return;
  }
  messagesEl.innerHTML = list.map(m => {
    const mine = m.sender === username ? ' mine' : '';
    const time = new Date(m.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    return `<article class="message${mine}" data-username="${escapeHtml(m.sender)}"><button class="message-user" type="button"><span class="message-avatar avatar">${escapeHtml(avatarFor(m.sender))}</span><span class="meta">${escapeHtml(m.sender)} · ${time}</span></button><div class="body">${escapeHtml(m.text)}</div></article>`;
  }).join('');
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function loadMessages() {
  try {
    const data = await api('/messages', { method: 'GET', headers: {} });
    if (!currentPrivateUser) renderMessages(data.messages || []);
  } catch (error) {
    $('#onlineText').textContent = 'اتصال دوباره در حال تلاش است…';
  }
}

async function loadPrivateMessages() {
  if (!currentPrivateUser) return;
  try {
    const data = await api(`/private-messages?me=${encodeURIComponent(username)}&with=${encodeURIComponent(currentPrivateUser)}`, { method: 'GET', headers: {} });
    if (currentPrivateUser) renderPrivateMessages(data.messages || []);
  } catch (error) {
    $('#onlineText').textContent = error.message;
  }
}

async function loadCurrentConversation() {
  if (currentPrivateUser) await loadPrivateMessages();
  else await loadMessages();
}

async function openPrivateChat(otherUser) {
  const clean = String(otherUser || '').trim();
  if (!clean || clean === username) return;
  currentPrivateUser = clean;
  $('#userPanel').classList.add('hidden');
  $('#privateBar').classList.remove('hidden');
  $('#privateWith').textContent = clean;
  $('#roomName').textContent = `گفتگوی خصوصی با ${clean}`;
  $('#onlineText').textContent = 'گفتگوی خصوصی';
  messageInput.placeholder = `پیام برای ${clean}...`;
  await loadPrivateMessages();
  messageInput.focus();
}

async function loadUsers() {
  const list = $('#userList');
  list.innerHTML = '<div class="user-loading">در حال دریافت کاربران…</div>';
  try {
    const data = await api('/users', { method: 'GET', headers: {} });
    const users = (data.users || []).map(u => u.username).filter(name => name !== username);
    if (!users.length) {
      list.innerHTML = '<div class="user-loading">کاربر دیگری برای گفتگوی خصوصی نیست.</div>';
      return;
    }
    list.innerHTML = users.map(name => `<button class="user-item" type="button" data-user="${escapeHtml(name)}"><span class="avatar">${escapeHtml(avatarFor(name))}</span><span><b>${escapeHtml(name)}</b><small>شروع پیام خصوصی</small></span></button>`).join('');
    list.querySelectorAll('.user-item').forEach(button => button.addEventListener('click', () => openPrivateChat(button.dataset.user)));
  } catch (error) {
    list.innerHTML = `<div class="user-loading">${escapeHtml(error.message)}</div>`;
  }
}

function toggleUserPanel() {
  const panel = $('#userPanel');
  const willOpen = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (willOpen) loadUsers();
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
    if (currentPrivateUser) {
      await api('/private-messages', { method: 'POST', body: JSON.stringify({ sender: username, recipient: currentPrivateUser, text }) });
      messageInput.value = '';
      await loadPrivateMessages();
    } else {
      await api('/messages', { method: 'POST', body: JSON.stringify({ username, text }) });
      messageInput.value = '';
      await loadMessages();
    }
  } catch (error) {
    $('#onlineText').textContent = error.message;
  } finally {
    messageInput.disabled = false;
    messageInput.focus();
  }
});

$('#usersTrigger').addEventListener('click', toggleUserPanel);
$('#userPanelClose').addEventListener('click', () => $('#userPanel').classList.add('hidden'));
$('#backPublic').addEventListener('click', showPublicChat);

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

setupProfileEvents();
if (username) {
  usernameInput.value = username;
  showChat();
}
