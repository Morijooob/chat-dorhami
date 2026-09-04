const $ = (id) => document.getElementById(id);
let mode = 'login';
let me = null;

async function hash(s) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(data)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function setMode(m) {
  mode = m;
  $('submit').querySelector('span').textContent = m === 'login' ? 'ورود به دورهمی' : 'ساخت حساب کاربری';
  $('loginTab').classList.toggle('active', m === 'login');
  $('registerTab').classList.toggle('active', m === 'register');
  $('password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('error').textContent = '';
}

async function auth(e) {
  if (e) e.preventDefault();
  const username = $('username').value.trim();
  const password = $('password').value;
  if (!username || !password) {
    $('error').textContent = 'نام کاربری و رمز عبور را وارد کن';
    return;
  }
  $('submit').disabled = true;
  $('error').textContent = 'در حال بررسی...';
  try {
    const response = await fetch(mode === 'login' ? '/login' : '/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, passwordHash: await hash(password) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `خطای سرور (${response.status})`);
    me = data.user;
    localStorage.setItem('user', JSON.stringify(me));
    showChat();
  } catch (err) {
    $('error').textContent = err.message || 'خطا در اتصال';
  } finally {
    $('submit').disabled = false;
  }
}

function showChat() {
  $('auth').hidden = true;
  $('chat').hidden = false;
  loadMessages();
}

async function loadMessages() {
  try {
    const response = await fetch('/messages');
    const data = await response.json();
    if (data.ok) {
      $('messages').innerHTML = data.messages.map(x => `<p><b>${escapeHtml(x.username)}</b>: ${escapeHtml(x.text)}</p>`).join('');
    }
  } catch (_) {}
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

function init() {
  $('loginTab').addEventListener('click', () => setMode('login'));
  $('registerTab').addEventListener('click', () => setMode('register'));
  $('authForm').addEventListener('submit', auth);
  $('logout').addEventListener('click', () => {
    localStorage.removeItem('user');
    location.reload();
  });
  $('send').addEventListener('submit', async e => {
    e.preventDefault();
    const text = $('text').value.trim();
    if (!text) return;
    await fetch('/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: me.username, text })
    });
    $('text').value = '';
    loadMessages();
  });

  setMode('login');
  try {
    const saved = JSON.parse(localStorage.getItem('user') || 'null');
    if (saved && saved.username) {
      me = saved;
      showChat();
    }
  } catch (_) {}
}

document.addEventListener('DOMContentLoaded', init, { once: true });
