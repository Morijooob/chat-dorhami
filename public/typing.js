(() => {
  const input = document.querySelector('#messageInput');
  const composer = document.querySelector('#messageForm');
  if (!input || !composer) return;

  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator hidden';
  indicator.setAttribute('aria-live', 'polite');
  indicator.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span><span class="typing-text"></span>';
  composer.parentNode.insertBefore(indicator, composer);

  let stopTimer = null;
  let pollTimer = null;
  let lastContext = '';

  const currentUser = () => localStorage.getItem('dorhami_user') || '';

  function getContext() {
    const privateUser = String(document.querySelector('#privateWith')?.textContent || '').trim();
    const me = currentUser();
    if (!privateUser || !me || privateUser === me) return 'public';
    return 'private:' + [me, privateUser].sort((a, b) => a.localeCompare(b)).join('|');
  }

  async function sendTyping(isTyping) {
    const username = currentUser();
    if (!username) return;
    const context = getContext();
    lastContext = context;
    try {
      await fetch('/typing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, context, typing: isTyping })
      });
    } catch (error) {}
  }

  function hideIndicator() {
    indicator.classList.add('hidden');
    indicator.querySelector('.typing-text').textContent = '';
  }

  function showUsers(users) {
    const clean = [...new Set((users || []).filter(Boolean))];
    if (!clean.length) {
      hideIndicator();
      return;
    }
    const text = clean.length === 1
      ? `${clean[0]} در حال نوشتن…`
      : `${clean.slice(0, 2).join(' و ')} در حال نوشتن…`;
    indicator.querySelector('.typing-text').textContent = text;
    indicator.classList.remove('hidden');
  }

  async function pollTyping() {
    const me = currentUser();
    if (!me) return;
    const context = getContext();
    if (context !== lastContext) {
      lastContext = context;
      hideIndicator();
    }
    try {
      const response = await fetch(`/typing?context=${encodeURIComponent(context)}&me=${encodeURIComponent(me)}&t=${Date.now()}`, { cache: 'no-store' });
      const data = await response.json();
      if (getContext() === context) showUsers(data.users || []);
    } catch (error) {}
  }

  input.addEventListener('input', () => {
    if (!currentUser()) return;
    sendTyping(true);
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => sendTyping(false), 1200);
  });

  composer.addEventListener('submit', () => {
    clearTimeout(stopTimer);
    sendTyping(false);
  });

  window.addEventListener('beforeunload', () => {
    const username = currentUser();
    if (!username) return;
    const context = getContext();
    try {
      navigator.sendBeacon('/typing', new Blob([JSON.stringify({ username, context, typing: false })], { type: 'application/json' }));
    } catch (error) {}
  });

  pollTyping();
  pollTimer = setInterval(pollTyping, 1500);
})();