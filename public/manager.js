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

  function badge() {
    const el = document.createElement('span');
    el.className = 'manager-badge';
    el.innerHTML = '<span class="manager-crown">👑</span><span>مدیرکل</span>';
    return el;
  }

  let verifiedManager = false;
  let lastKnownUser = '';
  let vipActivationInFlight = false;

  function currentLocalUser() {
    return String(localStorage.getItem('dorhami_user') || '').trim();
  }

  async function verifyManager() {
    try {
      const response = await fetch('/profile/me?t=' + Date.now(), { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      const serverUser = String(data.username || '').trim();
      lastKnownUser = serverUser;
      verifiedManager = response.ok && serverUser === MANAGER && currentLocalUser() === MANAGER;
      return verifiedManager;
    } catch (_) {
      verifiedManager = false;
      lastKnownUser = '';
      return false;
    }
  }

  function clearManagerDecorations() {
    document.querySelectorAll('.manager-badge').forEach(el => el.remove());
    document.querySelectorAll('.manager-avatar').forEach(el => el.classList.remove('manager-avatar'));
    document.querySelectorAll('.manager-profile-title').forEach(el => el.classList.remove('manager-profile-title'));
  }

  function decorateOwnProfile() {
    if (!verifiedManager) {
      clearManagerDecorations();
      return;
    }

    const mine = document.getElementById('myProfile');
    const mineName = document.getElementById('myProfileName');
    if (mine && mineName && currentLocalUser() === MANAGER) {
      mine.querySelector('.avatar')?.classList.add('manager-avatar');
      if (!mine.querySelector('.manager-badge')) mine.appendChild(badge());
    }

    const profileName = document.getElementById('profileUsername');
    const profileAvatar = document.getElementById('profileAvatar');
    const status = document.getElementById('profileStatus');
    const kicker = document.getElementById('profileKickerText');
    if (profileName && profileName.textContent.trim() === MANAGER) {
      profileAvatar?.classList.add('manager-avatar');
      profileName.classList.add('manager-profile-title');
      if (!profileName.querySelector('.manager-badge')) profileName.appendChild(badge());
      if (status) status.textContent = 'مدیرکل دورهمی';
      if (kicker) kicker.textContent = 'مدیرکل دورهمی';
    }

    document.querySelectorAll('.message[data-username="Morteza2026"] .message-avatar').forEach(el => {
      el.classList.add('manager-avatar');
    });
  }

  async function makeManagerVip() {
    if (!verifiedManager || vipActivationInFlight) return;
    vipActivationInFlight = true;
    try {
      await fetch('/admin/user-vip', {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({username: MANAGER, is_vip: 1})
      });
    } catch (_) {} finally {
      vipActivationInFlight = false;
    }
  }

  async function refreshIdentityAndDecorate() {
    const localUser = currentLocalUser();
    if (localUser !== MANAGER) {
      verifiedManager = false;
      lastKnownUser = localUser;
      clearManagerDecorations();
      return;
    }
    if (lastKnownUser !== MANAGER || !verifiedManager) await verifyManager();
    if (!verifiedManager) {
      clearManagerDecorations();
      return;
    }
    decorateOwnProfile();
    makeManagerVip();
  }

  async function start() {
    installStyle();
    await verifyManager();
    if (verifiedManager) {
      decorateOwnProfile();
      makeManagerVip();
    } else {
      clearManagerDecorations();
    }

    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(refreshIdentityAndDecorate, 40);
    });
    observer.observe(document.body, {subtree:true, childList:true});

    setInterval(refreshIdentityAndDecorate, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();