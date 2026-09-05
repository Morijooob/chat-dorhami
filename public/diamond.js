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

  const start = () => {
    loadDiamonds();
    const observer = new MutationObserver(() => renderDiamonds());
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