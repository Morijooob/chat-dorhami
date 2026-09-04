(() => {
  const EMOJIS = ['❤️','😂','😍','👍','🔥'];

  const style = document.createElement('style');
  style.textContent = `
    .reaction-bar{display:flex;align-items:center;gap:5px;margin-top:7px;min-height:30px;position:relative}
    .reaction-trigger{width:30px;height:30px;padding:0;border:1px solid rgba(255,255,255,.1);border-radius:50%;background:rgba(255,255,255,.045);color:#fff;font-size:15px;line-height:1;cursor:pointer;transition:.15s ease}
    .reaction-trigger:hover,.reaction-trigger.open{transform:scale(1.06);background:rgba(124,140,255,.14);border-color:rgba(167,139,250,.35)}
    .reaction-picker{position:absolute;z-index:50;bottom:36px;right:0;display:flex;gap:4px;padding:6px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(15,20,40,.97);box-shadow:0 14px 35px rgba(0,0,0,.45);backdrop-filter:blur(12px)}
    .reaction-picker.hidden{display:none}
    .reaction-choice{width:34px;height:34px;padding:0;border:0;border-radius:12px;background:transparent;font-size:18px;cursor:pointer;transition:.12s ease}
    .reaction-choice:hover{background:rgba(124,140,255,.16);transform:scale(1.12)}
    .reaction{display:none;align-items:center;gap:3px;height:29px;padding:0 7px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(255,255,255,.045);color:#fff;cursor:pointer}
    .reaction.has-count{display:inline-flex;background:rgba(124,140,255,.1);border-color:rgba(167,139,250,.28)}
    .reaction span{font-size:14px;line-height:1}.reaction-count{font-size:9px;color:#c4b5fd;font-weight:900;line-height:1}
    .reaction:disabled{opacity:.65;cursor:wait}
    .profile-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;margin-top:12px}
    .profile-action{padding:10px 8px;border:1px solid rgba(255,255,255,.09);border-radius:12px;background:rgba(255,255,255,.045);color:#fff;font-size:10px;font-weight:800;cursor:pointer;transition:.15s ease}
    .profile-action:hover{transform:translateY(-1px);background:rgba(124,140,255,.12);border-color:rgba(167,139,250,.25)}
    .profile-action.copied{background:rgba(52,211,153,.14);border-color:rgba(52,211,153,.3)}
  `;
  document.head.appendChild(style);

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

  const loadReactions = async articles => {
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
      bar.innerHTML = `<button class="reaction-trigger" type="button" aria-label="انتخاب واکنش">☺️</button><div class="reaction-picker hidden">${EMOJIS.map(emoji => `<button class="reaction-choice" type="button" data-emoji="${emoji}" aria-label="واکنش ${emoji}">${emoji}</button>`).join('')}</div>${EMOJIS.map(emoji => `<button class="reaction" type="button" data-emoji="${emoji}" aria-label="واکنش ${emoji}"><span>${emoji}</span><small class="reaction-count"></small></button>`).join('')}`;
      article.appendChild(bar);
      const trigger = bar.querySelector('.reaction-trigger');
      const picker = bar.querySelector('.reaction-picker');
      trigger.addEventListener('click', event => {
        event.stopPropagation();
        document.querySelectorAll('.reaction-picker').forEach(other => { if (other !== picker) other.classList.add('hidden'); });
        picker.classList.toggle('hidden');
        trigger.classList.toggle('open', !picker.classList.contains('hidden'));
      });
      picker.addEventListener('click', async event => {
        const choice = event.target.closest('.reaction-choice');
        if (!choice) return;
        const key = article.dataset.reactionKey || keyForMessage(article);
        const me = localStorage.getItem('dorhami_user') || '';
        if (!me) return;
        choice.disabled = true;
        try {
          const response = await fetch('/reactions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messageKey: key, username: me, emoji: choice.dataset.emoji })
          });
          const data = await response.json();
          if (response.ok) setCounts(bar, data.reactions || {});
        } catch (error) {} finally {
          choice.disabled = false;
          picker.classList.add('hidden');
          trigger.classList.remove('open');
        }
      });
      fresh.push(article);
    });
    if (fresh.length) loadReactions(fresh);
  };

  const enhanceProfile = () => {
    const profile = document.querySelector('#profilePopover');
    if (!profile || profile.classList.contains('hidden') || profile.querySelector('.profile-actions')) return;
    const usernameEl = profile.querySelector('#profileUsername');
    if (!usernameEl) return;
    const actions = document.createElement('div');
    actions.className = 'profile-actions';
    actions.innerHTML = '<button class="profile-action" type="button" data-profile-action="copy">📋 کپی نام کاربری</button><button class="profile-action" type="button" data-profile-action="share">📤 اشتراک پروفایل</button>';
    const hint = profile.querySelector('.profile-hint');
    (hint || profile.lastElementChild)?.before(actions);
    actions.addEventListener('click', async event => {
      const button = event.target.closest('.profile-action');
      if (!button) return;
      const name = String(usernameEl.textContent || '').trim();
      if (!name || name === 'کاربر') return;
      if (button.dataset.profileAction === 'copy') {
        try {
          await navigator.clipboard.writeText(name);
          button.textContent = '✅ نام کاربری کپی شد';
          button.classList.add('copied');
          setTimeout(() => { button.textContent = '📋 کپی نام کاربری'; button.classList.remove('copied'); }, 1400);
        } catch (error) {}
      } else if (navigator.share) {
        try { await navigator.share({ title: 'پروفایل دورهمی', text: `پروفایل ${name} در چت دورهمی` }); } catch (error) {}
      } else {
        try { await navigator.clipboard.writeText(`پروفایل ${name} در چت دورهمی`); } catch (error) {}
        button.textContent = '✅ متن پروفایل کپی شد';
        setTimeout(() => { button.textContent = '📤 اشتراک پروفایل'; }, 1400);
      }
    });
  };

  document.addEventListener('click', event => {
    if (event.target.closest('.reaction-bar')) return;
    document.querySelectorAll('.reaction-picker').forEach(picker => picker.classList.add('hidden'));
    document.querySelectorAll('.reaction-trigger').forEach(button => button.classList.remove('open'));
  });

  let savedScrollTop = 0;
  let wasNearBottom = true;
  const rememberScroll = () => {
    const messages = document.querySelector('#messages');
    if (!messages) return;
    savedScrollTop = messages.scrollTop;
    wasNearBottom = messages.scrollHeight - messages.clientHeight - messages.scrollTop < 80;
  };
  const restoreScroll = () => {
    const messages = document.querySelector('#messages');
    if (!messages) return;
    if (wasNearBottom) messages.scrollTop = messages.scrollHeight;
    else messages.scrollTop = savedScrollTop;
  };
  const messagesEl = document.querySelector('#messages');
  messagesEl?.addEventListener('scroll', rememberScroll, { passive: true });
  rememberScroll();

  const observer = new MutationObserver(() => {
    restoreScroll();
    addBars();
    enhanceProfile();
  });
  const start = () => {
    const messages = document.querySelector('#messages');
    if (!messages) return;
    observer.observe(messages, { childList: true, subtree: true });
    const profile = document.querySelector('#profilePopover');
    if (profile) new MutationObserver(enhanceProfile).observe(profile, { childList: true, subtree: true, attributes: true });
    addBars();
    enhanceProfile();
    setInterval(() => loadReactions([...document.querySelectorAll('#messages .message')]), 5000);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
