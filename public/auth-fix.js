(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const error = (msg) => { const el = $('authError'); if (el) el.textContent = msg || ''; };
  const hash = async (value) => {
    if (!globalThis.crypto?.subtle) throw new Error('مرورگر از رمزگذاری امن پشتیبانی نمی‌کند. لطفاً با HTTPS وارد شوید.');
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  };
  const request = async (path, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('/api' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: controller.signal
      });
      let data = {};
      try { data = await response.json(); } catch (_) {}
      if (!response.ok) throw new Error(data.error || `خطای سرور (${response.status})`);
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('پاسخ سرور دیر رسید. دوباره تلاش کن.');
      throw e;
    } finally { clearTimeout(timer); }
  };
  const bind = () => {
    const form = $('authForm');
    if (!form || form.dataset.authFixBound === '1') return;
    form.dataset.authFixBound = '1';
    let mode = 'login';
    document.querySelectorAll('.tabs button[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => { mode = btn.dataset.mode === 'register' ? 'register' : 'login'; error(''); });
    }, true);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      error('');
      const button = form.querySelector('button[type="submit"]');
      const username = ($('username')?.value || '').trim();
      const password = $('password')?.value || '';
      if (!/^[\p{L}\p{N}_]{3,24}$/u.test(username)) return error('نام کاربری باید ۳ تا ۲۴ حرف، عدد یا _ باشد.');
      if (password.length < 4) return error('رمز عبور حداقل ۴ کاراکتر باشد.');
      if (button) { button.disabled = true; button.dataset.oldText = button.textContent; button.textContent = 'در حال بررسی...'; }
      try {
        const passwordHash = await hash(password);
        const data = await request(mode === 'register' ? '/register' : '/login', { username, passwordHash });
        if (!data?.user?.id) throw new Error('پاسخ نامعتبر از سرور دریافت شد.');
        localStorage.setItem('dorhami_user', JSON.stringify(data.user));
        error('');
        const auth = $('auth'), chat = $('chat');
        if (auth) auth.classList.add('hidden');
        if (chat) chat.classList.remove('hidden');
        // Let the main application initialize from the saved account.
        setTimeout(() => location.reload(), 50);
      } catch (e) {
        error(e?.message || 'ثبت‌نام/ورود انجام نشد.');
      } finally {
        if (button) { button.disabled = false; button.textContent = button.dataset.oldText || (mode === 'login' ? 'ورود به دورهمی' : 'ساخت حساب و ورود'); }
      }
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
