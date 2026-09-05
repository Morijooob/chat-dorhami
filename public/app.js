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
let unreadTimer = null;
let currentPrivateUser = '';
let unreadByUser = {};
let myAvatar = '👤';

const AVATARS = ['😀','😎','🥰','🤩','😇','🥳','🤓','😈','👻','🤖','🐱','🐼','🦊','🐸','🐯','🦁','🐵','🐨','🐰','🐙','🦄','🐲','🌙','⭐','🔥'];

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
  if (!clean) return '👤';
  return window.dorhamiAvatars?.[clean] || '👤';
}

async function loadProfile(name) {
  const clean = String(name || '').trim();
  if (!clean) return '👤';
  try {
    const data = await api(`/profile?username=${encodeURIComponent(clean)}`, { method: 'GET', headers: {} });
    window.dorhamiAvatars = window.dorhamiAvatars || {};
    window.dorhamiAvatars[clean] = data.profile?.avatar || '👤';
    return window.dorhamiAvatars[clean];
  } catch (error) {
    return avatarFor(clean);
  }
}

async function loadMyProfile() {
  myAvatar = await loadProfile(username);
  $('#myAvatar').textContent = myAvatar;
  $('#myProfileName').textContent = username;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'\"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '\"':'&quot;' }[c]));
}

function openProfile(name) {
  const profile = $('#profilePopover');
  if (!profile) return;
  const clean = String(name || '').trim();
  const isMine = clean === username;
  $('#profileAvatar').textContent = avatarFor(clean);
  $('#profileUsername').textContent = clean || 'کاربر';
  $('#profileStatus').textContent = isMine ? 'پروفایل من' : 'عضو دورهمی';
  $('#profileKickerText').textContent = isMine ? 'پروفایل من' : 'پروفایل کاربر';
  $('#profilePrivateBtn')?.classList.toggle('hidden', isMine || !clean);
  profile.classList.remove('hidden');
}

function closeProfile() {
  const profile = $('#profilePopover');
  if (profile) profile.classList.add('hidden');
}

function openAvatarPicker() {
  if (!username) return;
  const picker = $('#avatarPicker');
  const grid = $('#avatarGrid');
  if (!picker || !grid) return;
  grid.innerHTML = AVATARS.map(avatar => `<button class="avatar-option${avatar === myAvatar ? ' selected' : ''}" type="button" data-avatar="${avatar}">${avatar}</button>`).join('');
  picker.classList.remove('hidden');
  grid.querySelectorAll('.avatar-option').forEach(button => {
    button.addEventListener('click', () => saveAvatar(button.dataset.avatar));
  });
}

function closeAvatarPicker() {
  $('#avatarPicker')?.classList.add('hidden');
}

async function saveAvatar(avatar) {
  if (!AVATARS.includes(avatar) || !username) return;
  const previous = myAvatar;
  try {
    const data = await api('/profile', {
      method: 'POST',
      body: JSON.stringify({ username, avatar })
    });
    myAvatar = data.profile?.avatar || avatar;
    window.dorhamiAvatars = window.dorhamiAvatars || {};
    window.dorhamiAvatars[username] = myAvatar;
    $('#myAvatar').textContent = myAvatar;
    $('#profileAvatar').textContent = myAvatar;
    closeAvatarPicker();
    await loadUsers();
    await loadMessages();
  } catch (error) {
    myAvatar = previous;
    alert(error.message);
  }
}

function setupProfileEvents() {
  $('#myProfile')?.addEventListener('click', async () => {
    await loadMyProfile();
    openProfile(username);
  });
  $('#profileAvatar')?.addEventListener('click', () => {
    if (String($('#profileUsername')?.textContent || '') === username) openAvatarPicker();
  });
  $('#profilePrivateBtn')?.addEventListener('click', async () => {
    const target = String($('#profileUsername')?.textContent || '').trim();
    closeProfile();
    await openPrivateChat(target);
  });
  $('#profileClose')?.addEventListener('click', closeProfile);
  $('#avatarPickerClose')?.addEventListener('click', closeAvatarPicker);
  $('#avatarPicker')?.addEventListener('click', event => {
    if (event.target.id === 'avatarPicker') closeAvatarPicker();
  });
  document.addEventListener('click', event => {
    const profile = $('#profilePopover');
    if (!profile || profile.classList.contains('hidden')) return;
    if (!profile.contains(event.target) && !$('#myProfile')?.contains(event.target)) closeProfile();
  });
}

function showActivityRewardToast(text) {
  let toast = document.getElementById('activityRewardToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'activityRewardToast';
    toast.style.cssText = 'position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:9999;padding:12px 18px;border-radius:999px;background:rgba(25,25,35,.94);color:#fff;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,.25);pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.style.opacity = '1';
  clearTimeout(window.activityRewardToastTimer);
  window.activityRewardToastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2800);
}

function setupRewardUI() {
  if ($('#rewardBar')) return;
  const announcement = $('.dorhami-announcement');
  if (!announcement || !chatView) return;
  const bar = document.createElement('div');
  bar.id = 'rewardBar';
  bar.innerHTML = '<div class="reward-balance"><span>🌹</span><b>گل‌های من</b><strong id="flowerBalance">0</strong></div><button id="claimRewardBtn" type="button">🎁 پاداش فعالیت</button>';
  bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 10px;padding:9px 11px;border:1px solid rgba(244,114,182,.25);border-radius:14px;background:linear-gradient(90deg,rgba(244,114,182,.09),rgba(124,58,237,.06));box-shadow:0 0 18px rgba(244,114,182,.06);';
  bar.querySelector('.reward-balance').style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0;color:#f8fafc;font-size:10px;';
  bar.querySelector('.reward-balance span').style.fontSize = '17px';
  bar.querySelector('.reward-balance b').style.fontWeight = '800';
  bar.querySelector('.reward-balance strong').style.cssText = 'min-width:28px;text-align:center;color:#f9a8d4;font-size:12px;';
  const button = bar.querySelector('#claimRewardBtn');
  button.style.cssText = 'border:1px solid rgba(244,114,182,.3);border-radius:10px;padding:7px 10px;background:rgba(244,114,182,.12);color:#fff;font-size:9px;font-weight:800;cursor:pointer;';
  announcement.parentNode.insertBefore(bar, announcement);
  button.addEventListener('click', claimActivityReward);
}

function updateRewardBalance(flowers) {
  const balance = $('#flowerBalance');
  if (balance) balance.textContent = String(Number(flowers || 0));
}

async function claimActivityReward() {
  const button = $('#claimRewardBtn');
  if (button) button.disabled = true;
  try {
    const reward = await api('/rewards/claim', { method: 'POST', body: JSON.stringify({}) });
    updateRewardBalance(reward.flowers);
    if (reward.rewarded) {
      showActivityRewardToast('🎁 پاداش فعالیت: ۱۰ 🌹 گل به حسابت اضافه شد!');
      if (button) button.textContent = '✅ دریافت شد';
    } else if (button) {
      button.textContent = '⏳ پاداش امروز دریافت شده';
    }
  } catch (error) {
    if (button) button.textContent = '❌ خطا؛ دوباره تلاش کن';
  } finally {
    if (button) {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = '🎁 پاداش فعالیت';
      }, 2200);
    }
  }
}

async function updatePresence() {
  if (!username) return;
  try {
    await api('/presence', { method: 'POST', body: JSON.stringify({ username }) });
    const reward = await api('/rewards/claim', { method: 'POST', body: JSON.stringify({}) });
    updateRewardBalance(reward.flowers);
    if (reward.rewarded) showActivityRewardToast('🎁 پاداش فعالیت: ۱۰ 🌹 گل به حسابت اضافه شد!');
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

function updateUnreadBadge() {
  const total = Object.values(unreadByUser).reduce((sum, count) => sum + count, 0);
  const badge = $('#privateUnreadBadge');
  if (badge) {
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.classList.toggle('hidden', total === 0);
  }
  document.title = total ? `(${total > 99 ? '99+' : total}) چت دورهمی` : 'چت دورهمی | گپ دوستانه';
}

async function checkPrivateUnread() {
  if (!username) return;
  try {
    const data = await api(`/private-unread?me=${encodeURIComponent(username)}`, { method: 'GET', headers: {} });
    unreadByUser = {};
    (data.users || []).forEach(item => { unreadByUser[item.sender] = Number(item.count || 0); });
    if (currentPrivateUser) delete unreadByUser[currentPrivateUser];
    updateUnreadBadge();
    const panel = $('#userPanel');
    if (panel && !panel.classList.contains('hidden')) renderUserListSearch();
  } catch (error) {}
}

function startUnreadPolling() {
  if (unreadTimer) clearInterval(unreadTimer);
  checkPrivateUnread();
  unreadTimer = setInterval(checkPrivateUnread, 2500);
}

function stopUnreadPolling() {
  if (unreadTimer) clearInterval(unreadTimer);
  unreadTimer = null;
  unreadByUser = {};
  updateUnreadBadge();
}

async function showChat() {
  authView.classList.add('hidden');
  chatView.classList.remove('hidden');
  setupRewardUI();
  $('#onlineText').textContent = `در حال اتصال · ${username}`;
  $('#myAvatar').textContent = '👤';
  $('#myProfileName').textContent = username;
  currentPrivateUser = '';
  await loadMyProfile();
  showPublicChat();
  startPresence();
  startUnreadPolling();
  if (timer) clearInterval(timer);
  timer = setInterval(loadCurrentConversation, 2500);
  messageInput.focus();
}

function showAuth() {
  if (timer) clearInterval(timer);
  stopPresence();
  stopUnreadPolling();
  closeProfile();
  closeAvatarPicker();
  chatView.classList.add('hidden');
  authView.classList.remove('hidden');
}

function showPublicChat() {
  currentPrivateUser = '';
  $('#privateBar').classList.add('hidden');
  $('#roomName').textContent = 'اتاق عمومی دورهمی';
  messageInput.placeholder = 'پیامت رو بنویس...';
  loadMessages();
  checkPrivateUnread();
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
    button.addEventListener('click', async () => {
      const name = button.closest('.message')?.dataset.username || '';
      await loadProfile(name);
      openProfile(name);
    });
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
  messagesEl.querySelectorAll('.message-user').forEach(button => {
    button.addEventListener('click', async () => {
      const name = button.closest('.message')?.dataset.username || '';
      await loadProfile(name);
      openProfile(name);
    });
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function loadMessages() {
  try {
    const data = await api('/messages', { method: 'GET', headers: {} });
    if (!currentPrivateUser) {
      const names = [...new Set((data.messages || []).map(m => m.username))];
      await Promise.all(names.map(loadProfile));
      renderMessages(data.messages || []);
    }
  } catch (error) {
    $('#onlineText').textContent = 'اتصال دوباره در حال تلاش است…';
  }
}

async function loadPrivateMessages() {
  if (!currentPrivateUser) return;
  try {
    const data = await api(`/private-messages?me=${encodeURIComponent(username)}&with=${encodeURIComponent(currentPrivateUser)}`, { method: 'GET', headers: {} });
    if (currentPrivateUser) {
      const messages = data.messages || [];
      const names = [...new Set(messages.map(m => m.sender))];
      await Promise.all(names.map(loadProfile));
      renderPrivateMessages(messages);
      const last = messages[messages.length - 1];
      if (last) await markPrivateRead(currentPrivateUser, last.id);
    }
  } catch (error) {
    $('#onlineText').textContent = error.message;
  }
}

async function markPrivateRead(otherUser, lastReadId) {
  if (!otherUser || !lastReadId) return;
  try {
    await api('/private-read', { method: 'POST', body: JSON.stringify({ username, otherUser, lastReadId }) });
    delete unreadByUser[otherUser];
    updateUnreadBadge();
  } catch (error) {}
}

async function loadCurrentConversation() {
  if (currentPrivateUser) await loadPrivateMessages();
  else await loadMessages();
}

async function openPrivateChat(otherUser) {
  const clean = String(otherUser || '').trim();
  if (!clean || clean === username) return;
  currentPrivateUser = clean;
  delete unreadByUser[clean];
  updateUnreadBadge();
  $('#userPanel').classList.add('hidden');
  $('#privateBar').classList.remove('hidden');
  $('#privateWith').textContent = clean;
  $('#roomName').textContent = `گفتگوی خصوصی با ${clean}`;
  $('#onlineText').textContent = 'گفتگوی خصوصی';
  messageInput.placeholder = `پیام برای ${clean}...`;
  await loadProfile(clean);
  await loadPrivateMessages();
  messageInput.focus();
}

function renderUserListSearch() {
  const list = $('#userList');
  const query = String($('#userSearch')?.value || '').trim().toLocaleLowerCase();
  const users = window.dorhamiUsers || [];
  const filtered = users.filter(name => name.toLocaleLowerCase().includes(query));
  if (!filtered.length) {
    list.innerHTML = '<div class="user-loading">کاربری با این نام پیدا نشد.</div>';
    return;
  }
  list.innerHTML = filtered.map(name => {
    const count = Number(unreadByUser[name] || 0);
    const badge = count ? `<span class="unread-count">${count > 99 ? '99+' : count}</span>` : '';
    return `<button class="user-item" type="button" data-user="${escapeHtml(name)}"><span class="avatar">${escapeHtml(avatarFor(name))}</span><span class="user-item-text"><b>${escapeHtml(name)}</b><small>شروع پیام خصوصی</small></span>${badge}</button>`;
  }).join('');
  list.querySelectorAll('.user-item').forEach(button => button.addEventListener('click', () => openPrivateChat(button.dataset.user)));
}

async function loadUsers() {
  const list = $('#userList');
  if (!list) return;
  list.innerHTML = '<div class="user-loading">در حال دریافت کاربران…</div>';
  try {
    const data = await api('/users', { method: 'GET', headers: {} });
    window.dorhamiAvatars = window.dorhamiAvatars || {};
    (data.users || []).forEach(user => { window.dorhamiAvatars[user.username] = user.avatar || '👤'; });
    window.dorhamiUsers = (data.users || []).map(u => u.username).filter(name => name !== username);
    if (!window.dorhamiUsers.length) {
      list.innerHTML = '<div class="user-loading">کاربر دیگری برای گفتگوی خصوصی نیست.</div>';
      return;
    }
    renderUserListSearch();
  } catch (error) {
    list.innerHTML = `<div class="user-loading">${escapeHtml(error.message)}</div>`;
  }
}

function toggleUserPanel() {
  const panel = $('#userPanel');
  const willOpen = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  if (willOpen) {
    loadUsers();
    checkPrivateUnread();
    setTimeout(() => $('#userSearch')?.focus(), 50);
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
    window.dorhamiAvatars = window.dorhamiAvatars || {};
    window.dorhamiAvatars[username] = data.avatar || '👤';
    passwordInput.value = '';
    await showChat();
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
$('#userSearch')?.addEventListener('input', renderUserListSearch);
$('#backPublic').addEventListener('click', showPublicChat);

$('#logout').addEventListener('click', async () => {
  const leavingUser = username;
  stopPresence();
  stopUnreadPolling();
  try {
    await api('/presence', { method: 'DELETE', body: JSON.stringify({ username: leavingUser }) });
  } catch (error) {}
  localStorage.removeItem('dorhami_user');
  username = '';
  myAvatar = '👤';
  showAuth();
});

setupProfileEvents();
if (username) {
  usernameInput.value = username;
  showChat();
}
