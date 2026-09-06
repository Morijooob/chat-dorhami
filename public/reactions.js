(() => {
  // واکنش‌های روی پیام‌ها عمداً غیرفعال شده‌اند تا درخواست‌های اضافی
  // به سرور/Cloudflare ایجاد نشود. قابلیت‌های پروفایل این فایل حفظ شده است.

  const enhanceProfile = () => {
    const profile = document.querySelector('#profilePopover');
    if (!profile || profile.classList.contains('hidden') || profile.querySelector('.profile-actions')) return;

    const usernameEl = profile.querySelector('#profileUsername');
    if (!usernameEl) return;

    const actions = document.createElement('div');
    actions.className = 'profile-actions';
    actions.innerHTML =
      '<button class="profile-action" type="button" data-profile-action="copy">📋 کپی نام کاربری</button>' +
      '<button class="profile-action" type="button" data-profile-action="share">📤 اشتراک پروفایل</button>';

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
          setTimeout(() => {
            button.textContent = '📋 کپی نام کاربری';
            button.classList.remove('copied');
          }, 1400);
        } catch (error) {}
      } else if (navigator.share) {
        try {
          await navigator.share({
            title: 'پروفایل دورهمی',
            text: `پروفایل ${name} در چت دورهمی`
          });
        } catch (error) {}
      } else {
        try {
          await navigator.clipboard.writeText(`پروفایل ${name} در چت دورهمی`);
        } catch (error) {}
        button.textContent = '✅ متن پروفایل کپی شد';
        setTimeout(() => {
          button.textContent = '📤 اشتراک پروفایل';
        }, 1400);
      }
    });
  };

  const start = () => {
    enhanceProfile();

    const profile = document.querySelector('#profilePopover');
    if (profile) {
      new MutationObserver(enhanceProfile).observe(profile, {
        childList: true,
        subtree: true,
        attributes: true
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
