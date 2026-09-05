(() => {
  let stars = Object.create(null);
  let loaded = false;

  async function loadStars() {
    try {
      const response = await fetch('/users?stars=' + Date.now(), { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      stars = Object.create(null);
      (data.users || []).forEach(user => {
        const name = String(user.username || '').trim();
        if (name) stars[name] = Number(user.is_starred) === 1;
      });
      loaded = true;
      renderStars();
    } catch (error) {}
  }

  function renderStars() {
    if (!loaded) return;
    document.querySelectorAll('#messages .message .meta').forEach(meta => {
      if (meta.querySelector('.dorhami-star')) return;
      const text = meta.textContent || '';
      const separator = text.indexOf(' · ');
      const name = (separator >= 0 ? text.slice(0, separator) : text).trim();
      if (!name || !stars[name]) return;
      const star = document.createElement('span');
      star.className = 'dorhami-star';
      star.textContent = ' ⭐';
      star.title = 'کاربر ویژه';
      star.setAttribute('aria-label', 'کاربر ویژه');
      meta.prepend(star);
    });
  }

  const style = document.createElement('style');
  style.textContent = '.dorhami-star{display:inline-block;margin-left:3px;font-size:.9em;line-height:1;vertical-align:middle;filter:drop-shadow(0 0 5px rgba(250,204,21,.45))}';
  document.head.appendChild(style);

  const observer = new MutationObserver(renderStars);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('DOMContentLoaded', loadStars, { once: true });
  setInterval(loadStars, 10000);
})();
