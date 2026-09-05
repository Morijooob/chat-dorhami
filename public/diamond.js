(() => {
  const DIAMOND_CLASS = 'dorhami-diamond';
  let diamonds = Object.create(null);
  let busy = false;

  const loadDiamonds = async () => {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch('/users?t=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data.users)) return;
      const next = Object.create(null);
      data.users.forEach(user => {
        const name = String(user.username || '').trim();
        if (name && Number(user.is_diamond) === 1) next[name] = true;
      });
      diamonds = next;
      renderDiamonds();
    } catch (error) {
      // Keep the chat usable if the rank request fails.
    } finally {
      busy = false;
    }
  };

  const renderDiamonds = () => {
    document.querySelectorAll('#messages .message').forEach(message => {
      const meta = message.querySelector('.meta');
      if (!meta) return;
      const name = String(message.dataset.username || '').trim();
      const old = meta.querySelector('.' + DIAMOND_CLASS);
      const shouldHaveDiamond = Boolean(diamonds[name]);

      if (!shouldHaveDiamond) {
        if (old) old.remove();
        return;
      }

      if (old) return;

      const diamond = document.createElement('span');
      diamond.className = DIAMOND_CLASS;
      diamond.textContent = '💎';
      diamond.title = 'کاربر VIP';
      diamond.setAttribute('aria-label', 'کاربر VIP');
      meta.appendChild(diamond);
    });
  };

  const addVipEntryPoint = () => {
    const actions = document.querySelector('.chat-actions');
    if (!actions || document.querySelector('#vipEntryButton')) return;

    const button = document.createElement('button');
    button.id = 'vipEntryButton';
    button.type = 'button';
    button.className = 'dorhami-vip-button';
    button.textContent = '💎 VIP';
    button.setAttribute('aria-label', 'امکانات VIP دورهمی');
    button.title = 'امکانات VIP دورهمی';

    const modal = document.createElement('div');
    modal.id = 'vipModal';
    modal.className = 'dorhami-vip-modal hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'vipModalTitle');
    modal.innerHTML = `
      <div class="dorhami-vip-card">
        <button type="button" class="dorhami-vip-close" aria-label="بستن">×</button>
        <div class="dorhami-vip-icon">💎</div>
        <h3 id="vipModalTitle">VIP دورهمی</h3>
        <p>به‌زودی امکانات ویژه‌ای برای کاربران VIP فعال می‌کنیم.</p>
        <div class="dorhami-vip-list">
          <div><span>🔐</span><b>ساخت اتاق خصوصی</b><small>ساخت اتاق برای دورهمی‌های اختصاصی</small></div>
          <div><span>👥</span><b>دعوت کاربران</b><small>دعوت دوستان به اتاق خصوصی</small></div>
          <div><span>💎</span><b>نشان الماس</b><small>نمایش ویژه در کنار نام کاربری</small></div>
          <div><span>👑</span><b>نشان‌های ویژه</b><small>سطح‌ها و مزایای بیشتر در آینده</small></div>
        </div>
        <div class="dorhami-vip-soon">✨ امکانات VIP مرحله‌به‌مرحله فعال می‌شوند</div>
      </div>`;

    const style = document.createElement('style');
    style.textContent = `
      .dorhami-vip-button{border:1px solid rgba(251,191,36,.32);background:linear-gradient(135deg,rgba(124,58,237,.22),rgba(251,191,36,.10));color:#f8fafc;border-radius:11px;padding:8px 10px;font:inherit;font-size:10px;font-weight:900;cursor:pointer;box-shadow:0 0 16px rgba(124,58,237,.10);transition:.18s}
      .dorhami-vip-button:hover{transform:translateY(-1px);border-color:rgba(251,191,36,.58);box-shadow:0 8px 24px rgba(124,58,237,.18),0 0 18px rgba(251,191,36,.10)}
      .dorhami-vip-modal{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:18px;background:rgba(2,6,23,.74);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
      .dorhami-vip-modal.hidden{display:none}
      .dorhami-vip-card{position:relative;width:min(390px,94vw);padding:25px 20px 20px;border:1px solid rgba(251,191,36,.25);border-radius:25px;background:radial-gradient(circle at 50% 0%,rgba(124,58,237,.25),transparent 42%),linear-gradient(145deg,rgba(25,31,58,.98),rgba(8,12,28,.98));box-shadow:0 30px 100px rgba(0,0,0,.62),0 0 40px rgba(124,58,237,.12);text-align:center;color:#fff}
      .dorhami-vip-close{position:absolute;top:9px;left:10px;width:29px;height:29px;border:1px solid rgba(255,255,255,.08);border-radius:50%;background:rgba(255,255,255,.06);color:#cbd5e1;font-size:20px;cursor:pointer}
      .dorhami-vip-icon{width:64px;height:64px;margin:0 auto 10px;display:grid;place-items:center;border-radius:20px;background:linear-gradient(135deg,rgba(124,58,237,.28),rgba(251,191,36,.16));border:1px solid rgba(251,191,36,.25);font-size:30px;box-shadow:0 0 28px rgba(251,191,36,.10)}
      .dorhami-vip-card h3{margin:0;font-size:20px}.dorhami-vip-card>p{margin:7px 0 17px;color:#94a3b8;font-size:10px;line-height:1.9}
      .dorhami-vip-list{display:grid;gap:8px;text-align:right}.dorhami-vip-list>div{display:grid;grid-template-columns:30px 1fr;column-gap:8px;padding:9px 10px;border:1px solid rgba(255,255,255,.07);border-radius:13px;background:rgba(255,255,255,.035)}.dorhami-vip-list span{grid-row:1 / span 2;font-size:19px;align-self:center;text-align:center}.dorhami-vip-list b{font-size:10px}.dorhami-vip-list small{margin-top:3px;color:#64748b;font-size:8px}.dorhami-vip-soon{margin-top:13px;padding:9px;border-radius:11px;background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.12);color:#fbbf24;font-size:9px;font-weight:800}
      @media (max-width:620px){.chat-actions{gap:5px}.dorhami-vip-button{padding:8px 7px}.dorhami-vip-button{font-size:9px}.users-trigger{padding:8px 7px}.logout{padding:8px 7px}}
    `;
    document.head.appendChild(style);
    actions.insertBefore(button, actions.firstChild);
    document.body.appendChild(modal);

    const close = () => modal.classList.add('hidden');
    button.addEventListener('click', () => modal.classList.remove('hidden'));
    modal.querySelector('.dorhami-vip-close').addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  };

  const start = () => {
    addVipEntryPoint();
    loadDiamonds();
    const observer = new MutationObserver(() => {
      renderDiamonds();
      addVipEntryPoint();
    });
    const target = document.querySelector('#messages');
    if (target) observer.observe(target, { childList: true, subtree: true });
    setInterval(loadDiamonds, 10000);
  };

  const style = document.createElement('style');
  style.textContent = `.${DIAMOND_CLASS}{display:inline-block;margin-inline-start:4px;font-size:.9em;line-height:1;vertical-align:middle}`;
  document.head.appendChild(style);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();