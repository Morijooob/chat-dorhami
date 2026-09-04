(() => {
  const EMOJIS = ['❤️','😂','😍','👍','🔥'];
  const keyForMessage = article => {
    const user = article.dataset.username || '';
    const text = article.querySelector('.body')?.textContent || '';
    const meta = article.querySelector('.meta')?.textContent || '';
    const room = document.querySelector('#privateBar')?.classList.contains('hidden') ? 'public' : (document.querySelector('#privateWith')?.textContent || 'private');
    const raw = `${room}|${user}|${text}|${meta}`;
    let hash = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      hash ^= raw.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `m${(hash >>> 0).toString(16).padStart(8, '0')}`;
  };

  const setCounts = (bar, reactions = {}) => {
    bar.querySelectorAll('.reaction').forEach(button => {
      const emoji = button.dataset.emoji;
      const count = Number(reactions[emoji] || 0);
      const countEl = button.querySelector('.reaction-count');
      if (countEl) countEl.textContent = count ? String(count) : '';
      button.classList.toggle('has-count', count > 0);
    });
  };

  const loadReactions = async (articles) => {
    const items = articles.map(article => ({ article, key: article.dataset.reactionKey || keyForMessage(article) }));
    items.forEach(item => { item.article.dataset.reactionKey = item.key; });
    const unique = [...new Set(items.map(item => item.key))];
    if (!unique.length) return;
    try {
      const response = await fetch(`/reactions?keys=${encodeURIComponent(unique.join(','))}&t=${Date.now()}`, { cache: 'no-store' });
      const data = await response.json();
      items.forEach(({ article, key }) => {
        const bar = article.querySelector('.reaction-bar');
        if (bar) setCounts(bar, data.reactions?.[key] || {});
      });
    } catch (error) {}
  };

  const addBars = () => {
    const articles = [...document.querySelectorAll('#messages .message')];
    const fresh = [];
    articles.forEach(article => {
      if (article.querySelector('.reaction-bar')) return;
      const bar = document.createElement('div');
      bar.className = 'reaction-bar';
      bar.innerHTML = EMOJIS.map(emoji => `<button class="reaction" type="button" data-emoji="${emoji}" aria-label="واکنش ${emoji}"><span>${emoji}</span><small class="reaction-count"></small></button>`).join('');
      article.appendChild(bar);
      bar.addEventListener('click', async event => {
        const button = event.target.closest('.reaction');
        if (!button) return;
        const key = article.dataset.reactionKey || keyForMessage(article);
        const me = localStorage.getItem('dorhami_user') || '';
        if (!me) return;
        button.disabled = true;
        try {
          const response = await fetch('/reactions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messageKey: key, username: me, emoji: button.dataset.emoji })
          });
          const data = await response.json();
          if (response.ok) setCounts(bar, data.reactions || {});
        } catch (error) {} finally {
          button.disabled = false;
        }
      });
      fresh.push(article);
    });
    if (fresh.length) loadReactions(fresh);
  };

  const observer = new MutationObserver(() => addBars());
  const start = () => {
    const messages = document.querySelector('#messages');
    if (!messages) return;
    observer.observe(messages, { childList: true, subtree: true });
    addBars();
    setInterval(() => loadReactions([...document.querySelectorAll('#messages .message')]), 5000);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
