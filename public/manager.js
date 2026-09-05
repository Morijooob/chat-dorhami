(() => {
  const MANAGER = 'Morteza2026';
  const STYLE_ID = 'dorhami-manager-style';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .manager-badge{display:inline-flex;align-items:center;justify-content:center;gap:4px;margin-right:5px;padding:3px 7px;border-radius:999px;border:1px solid rgba(251,191,36,.48);background:linear-gradient(135deg,rgba(251,191,36,.18),rgba(245,158,11,.08));color:#fcd34d;font-size:8px;font-weight:900;vertical-align:middle;box-shadow:0 0 12px rgba(251,191,36,.16),inset 0 1px rgba(255,255,255,.12);white-space:nowrap}
      .manager-badge .manager-crown{font-size:10px;filter:drop-shadow(0 0 5px rgba(251,191,36,.75));animation:managerCrown 1.8s ease-in-out infinite}
      .manager-avatar{position:relative!important;border:2px solid rgba(251,191,36,.9)!important;box-shadow:0 0 0 3px rgba(251,191,36,.12),0 0 22px rgba(251,191,36,.3),0 5px 18px rgba(0,0,0,.25)!important}
      .manager-avatar:before{content:'👑';position:absolute;top:-12px;right:-7px;font-size:14px;line-height:1;filter:drop-shadow(0 0 6px rgba(251,191,36,.75));animation:managerCrown 1.8s ease-in-out infinite;z-index:3}
      .manager-profile-title{display:flex!important;align-items:center;justify-content:center;gap:5px}
      .manager-profile-title .manager-badge{margin-right:0;margin-left:0}
      @keyframes managerCrown{0%,100%{transform:translateY(0) rotate(-3deg);opacity:.9}50%{transform:translateY(-2px) rotate(3deg);opacity:1}}
      @media (prefers-reduced-motion:reduce){.manager-badge .manager-crown,.manager-avatar:before{animation:none}}
    `;
    document.head.appendChild(style);
  }

  function isManager(name) {
    return String(name || '').trim() === MANAGER;
  }

  function badge() {
    const el = document.createElement('span');
    el.className = 'manager-badge';
    el.innerHTML = '<span class="manager-crown">👑</span><span>مدیرکل</span>';
    return el;
  }

  function decorate() {
    const mine = document.getElementById('myProfile');
    const mineName = document.getElementById('myProfileName');
    if (mine && mineName && isManager(mineName.textContent)) {
      mine.querySelector('.avatar')?.classList.add('manager-avatar');
      if (!mine.querySelector('.manager-badge')) mine.appendChild(badge());
    }

    document.querySelectorAll('.message').forEach(message => {
      const name = message.dataset.username || message.querySelector('.meta')?.textContent?.split('·')[0]?.trim();
      if (!isManager(name)) return;
      message.querySelector('.message-avatar')?.classList.add('manager-avatar');
      const meta = message.querySelector('.meta');
      if (meta && !meta.querySelector('.manager-badge')) meta.appendChild(badge());
    });

    const profileName = document.getElementById('profileUsername');
    const profileAvatar = document.getElementById('profileAvatar');
    if (profileName && isManager(profileName.textContent)) {
      profileAvatar?.classList.add('manager-avatar');
      profileName.classList.add('manager-profile-title');
      if (!profileName.querySelector('.manager-badge')) profileName.appendChild(badge());
      const status = document.getElementById('profileStatus');
      if (status && status.textContent !== 'مدیرکل دورهمی') status.textContent = 'مدیرکل دورهمی';
      const kicker = document.getElementById('profileKickerText');
      if (kicker && kicker.textContent !== 'مدیرکل دورهمی') kicker.textContent = 'مدیرکل دورهمی';
    }
  }

  async function makeManagerVip() {
    try {
      const current = localStorage.getItem('dorhami_user') || '';
      if (!isManager(current)) return;
      const response = await fetch('/admin/user-vip', {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({username: MANAGER, is_vip: 1})
      });
      if (!response.ok) return;
    } catch (_) {}
  }

  function start() {
    installStyle();
    decorate();
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, {subtree:true, childList:true});
    makeManagerVip();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
