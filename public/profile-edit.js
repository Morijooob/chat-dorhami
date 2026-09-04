(() => {
  const KEY = 'dorhami_profile_bio';
  const getBio = () => String(localStorage.getItem(KEY) || '').trim();

  const style = document.createElement('style');
  style.textContent = `
    .profile-bio{width:100%;margin-top:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.07);border-radius:13px;background:rgba(255,255,255,.035);color:#aeb9d4;font-size:10px;line-height:1.8;text-align:right;box-sizing:border-box;min-height:36px}
    .profile-bio.empty{color:#64748b;text-align:center}
    .profile-edit-btn{display:block;width:100%;margin-top:10px;padding:10px 14px;border:1px solid rgba(124,140,255,.25);border-radius:13px;background:rgba(124,140,255,.09);color:#fff;font-weight:800;font-size:10px;cursor:pointer}
    .profile-editor{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:20px;background:rgba(3,6,18,.72);backdrop-filter:blur(10px)}
    .profile-editor.hidden{display:none}
    .profile-editor-card{width:min(390px,94vw);padding:20px;border:1px solid rgba(255,255,255,.12);border-radius:24px;background:rgba(14,19,38,.98);box-shadow:0 24px 70px rgba(0,0,0,.5)}
    .profile-editor-card h3{margin:0 0 6px;font-size:17px}.profile-editor-card p{margin:0 0 14px;color:#8f9bb8;font-size:10px}
    .profile-editor-card textarea{width:100%;height:92px;resize:none;box-sizing:border-box;padding:11px;border:1px solid rgba(255,255,255,.1);border-radius:13px;background:rgba(255,255,255,.045);color:#fff;outline:none;font:inherit;font-size:11px}
    .profile-editor-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.profile-editor-actions button{padding:10px;border:0;border-radius:12px;color:#fff;font-weight:800;cursor:pointer}.profile-editor-save{background:linear-gradient(135deg,#7c3aed,#6366f1)}.profile-editor-cancel{background:rgba(255,255,255,.08)}
  `;
  document.head.appendChild(style);

  const ensureEditor = () => {
    if (document.querySelector('#profileEditor')) return;
    const el = document.createElement('div');
    el.id = 'profileEditor'; el.className = 'profile-editor hidden';
    el.innerHTML = `<div class="profile-editor-card"><h3>ویرایش پروفایل ✨</h3><p>یک معرفی کوتاه درباره خودت بنویس.</p><textarea id="profileBioInput" maxlength="160" placeholder="مثلاً عاشق موسیقی، تکنولوژی و گپ دوستانه‌ام 😎"></textarea><div class="profile-editor-actions"><button class="profile-editor-cancel" id="profileBioCancel" type="button">انصراف</button><button class="profile-editor-save" id="profileBioSave" type="button">💾 ذخیره</button></div></div>`;
    document.body.appendChild(el);
    el.querySelector('#profileBioCancel').addEventListener('click', () => el.classList.add('hidden'));
    el.addEventListener('click', event => { if (event.target === el) el.classList.add('hidden'); });
    el.querySelector('#profileBioSave').addEventListener('click', () => {
      const input = el.querySelector('#profileBioInput');
      localStorage.setItem(KEY, String(input.value || '').trim());
      el.classList.add('hidden');
      refreshProfile();
    });
  };

  const refreshProfile = () => {
    const profile = document.querySelector('#profilePopover');
    if (!profile) return;
    const name = String(profile.querySelector('#profileUsername')?.textContent || '').trim();
    const me = localStorage.getItem('dorhami_user') || '';
    if (!name || name === 'کاربر') return;
    let bio = profile.querySelector('.profile-bio');
    if (!bio) {
      bio = document.createElement('div'); bio.className = 'profile-bio';
      const actions = profile.querySelector('.profile-actions');
      (actions || profile.querySelector('.profile-private-btn') || profile.querySelector('.profile-hint'))?.before(bio);
    }
    const value = name === me ? getBio() : '';
    const display = value || (name === me ? 'هنوز معرفی کوتاهی ننوشتی ✨' : '');
    if (bio.textContent !== display) bio.textContent = display;
    const shouldBeEmpty = !value;
    if (bio.classList.contains('empty') !== shouldBeEmpty) bio.classList.toggle('empty', shouldBeEmpty);
    let edit = profile.querySelector('.profile-edit-btn');
    if (name === me) {
      if (!edit) {
        edit = document.createElement('button'); edit.type='button'; edit.className='profile-edit-btn'; edit.textContent='✏️ ویرایش معرفی پروفایل';
        const actions = profile.querySelector('.profile-actions');
        (actions || profile.querySelector('.profile-private-btn') || profile.querySelector('.profile-hint'))?.before(edit);
        edit.addEventListener('click', () => {
          ensureEditor();
          const editor = document.querySelector('#profileEditor');
          document.querySelector('#profileBioInput').value = getBio();
          editor.classList.remove('hidden');
          setTimeout(() => document.querySelector('#profileBioInput')?.focus(), 30);
        });
      }
      edit.classList.remove('hidden');
    } else if (edit) edit.classList.add('hidden');
  };

  const observer = new MutationObserver(() => refreshProfile());
  const start = () => {
    const profile = document.querySelector('#profilePopover');
    if (!profile) return;
    observer.observe(profile, { childList:true, subtree:true, characterData:true });
    refreshProfile();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
})();