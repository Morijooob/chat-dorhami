(() => {
  let crowns = Object.create(null);
  let loaded = false;

  async function loadCrowns() {
    try {
      const response = await fetch('/users?crowns=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      crowns = Object.create(null);
      (data.users || []).forEach(user => {
        const name = String(user.username || '').trim();
        if (name) crowns[name] = Number(user.is_crowned) === 1;
      });
      loaded = true;
      renderCrowns();
    } catch (error) {}
  }

  function renderCrowns() {
    if (!loaded) return;
    document.querySelectorAll('#messages .message').forEach(message => {
      const meta = message.querySelector('.meta');
      if (!meta) return;

      const name = String(message.dataset.username || '').trim();
      if (!name) return;

      const old = meta.querySelector('.dorhami-crown');
      if (old) old.remove();

      if (!crowns[name]) return;

      const crown = document.createElement('span');
      crown.className = 'dorhami-crown';
      crown.textContent = ' 👑';
      crown.title = 'کاربر برگزیده';
      crown.setAttribute('aria-label', 'کاربر برگزیده');
      meta.appendChild(crown);
    });
  }

  const style = document.createElement('style');
  style.textContent = '.dorhami-crown{display:inline-block;margin-right:3px;font-size:.9em;line-height:1;vertical-align:middle;filter:drop-shadow(0 0 5px rgba(168,85,247,.5))}';
  document.head.appendChild(style);

  const observer = new MutationObserver(renderCrowns);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('DOMContentLoaded', loadCrowns, { once: true });
  setInterval(loadCrowns, 10000);
})();