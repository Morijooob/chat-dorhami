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

  const openAdminPrivateChat = async (packageText, status) => {
    const admin = 'Morteza2026';
    try {
      const trigger = document.getElementById('usersTrigger');
      const panel = document.getElementById('userPanel');
      const search = document.getElementById('userSearch');
      if (!trigger || !panel || !search) throw new Error('بخش کاربران در دسترس نیست.');
      if (panel.classList.contains('hidden')) trigger.click();
      search.value = admin;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 180));
      const target = [...panel.querySelectorAll('.user-item')].find(button => String(button.dataset.user || '').trim() === admin);
      if (!target) throw new Error('کاربر مدیریت پیدا نشد.');
      target.click();
      await new Promise(resolve => setTimeout(resolve, 180));
      const messageInput = document.getElementById('messageInput');
      if (messageInput) {
        messageInput.value = `سلام مدیریت، درخواست خرید ${packageText} را دارم. لطفاً راهنمایی پرداخت را اعلام کنید.`;
        messageInput.focus();
      }
      if (status) status.textContent = '✅ گفتگوی خصوصی با مدیریت باز شد؛ پیام آماده ارسال است.';
    } catch (error) {
      if (status) status.textContent = `❌ ${error.message}`;
    }
  };

  const installDiamondStore = (modal, products) => {
    if (!modal || !products || modal.dataset.diamondPurchaseReady === '1') return;
    modal.dataset.diamondPurchaseReady = '1';

    const product = document.createElement('div');
    product.className = 'dorhami-store-product dorhami-diamond-store-product';
    product.innerHTML = `
      <div class="dorhami-store-product-title">💎 خرید الماس</div>
      <div class="dorhami-store-product-note">پرداخت به مدیریت؛ سپس حساب شما دستی شارژ می‌شود.</div>
      <div class="dorhami-diamond-plans">
        <button type="button" class="dorhami-diamond-plan" data-diamond-amount="50" data-diamond-price="49000">
          <span>💎 50 الماس</span><b>49,000 تومان</b>
        </button>
        <button type="button" class="dorhami-diamond-plan" data-diamond-amount="100" data-diamond-price="90000">
          <span>💎 100 الماس</span><b>90,000 تومان</b>
        </button>
      </div>
      <div class="dorhami-diamond-status"></div>`;
    products.appendChild(product);

    const status = product.querySelector('.dorhami-diamond-status');
    product.querySelectorAll('[data-diamond-amount]').forEach(button => {
      button.addEventListener('click', () => {
        const amount = Number(button.dataset.diamondAmount);
        const price = Number(button.dataset.diamondPrice);
        if (!amount || !price) return;
        product.querySelectorAll('button').forEach(b => b.disabled = true);
        status.textContent = `در حال آماده‌سازی درخواست ${amount} الماس…`;
        openAdminPrivateChat(`${amount} 💎 به مبلغ ${price.toLocaleString('fa-IR')} تومان`, status)
          .finally(() => product.querySelectorAll('button').forEach(b => b.disabled = false));
      });
    });
  };

  const installVipStore = (modal) => {
    if (!modal || modal.dataset.vipPurchaseReady === '1') return;
    const products = modal.querySelector('.dorhami-store-products');
    const vipProduct = products?.querySelector('.dorhami-store-product');
    if (!products || !vipProduct) return;
    modal.dataset.vipPurchaseReady = '1';
    const oldButton = vipProduct.querySelector('button');
    if (oldButton) oldButton.remove();
    const plans = [
      { days: 1, price: 50, label: '۱ روزه' },
      { days: 7, price: 150, label: '۷ روزه' },
      { days: 15, price: 400, label: '۱۵ روزه' },
      { days: 30, price: 700, label: '۱ ماهه 👑' }
    ];
    const box = document.createElement('div');
    box.className = 'dorhami-vip-plans';
    box.innerHTML = plans.map(p => `<button type="button" class="dorhami-vip-plan" data-vip-days="${p.days}"><span>${p.label}</span><b>💎 ${p.price}</b></button>`).join('');
    vipProduct.appendChild(box);

    const status = document.createElement('div');
    status.className = 'dorhami-vip-purchase-status';
    vipProduct.appendChild(status);

    box.querySelectorAll('[data-vip-days]').forEach(button => {
      button.onclick = async () => {
        const days = Number(button.dataset.vipDays);
        const plan = plans.find(p => p.days === days);
        if (!plan) return;
        box.querySelectorAll('button').forEach(b => b.disabled = true);
        status.textContent = 'در حال خرید VIP…';
        try {
          const response = await fetch('/store/buy-vip', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({ days })
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || 'خرید VIP انجام نشد.');
          const diamondCounter = document.getElementById('dorhamiStoreDiamonds');
          if (diamondCounter) diamondCounter.textContent = String(Number(data.diamonds || 0));
          const topDiamond = document.getElementById('diamondBalance');
          if (topDiamond) topDiamond.textContent = String(Number(data.diamonds || 0));
          const expiry = new Date(Number(data.vip_expires_at || 0)).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
          status.textContent = `✅ VIP ${plan.label} فعال شد. اعتبار تا ${expiry}`;
        } catch (error) {
          status.textContent = `❌ ${error.message}`;
        } finally {
          box.querySelectorAll('button').forEach(b => b.disabled = false);
        }
      };
    });

    installDiamondStore(modal, products);
  };

  const start = () => {
    loadDiamonds();
    const observer = new MutationObserver(() => {
      renderDiamonds();
      const modal = document.getElementById('dorhamiStoreModal');
      if (modal) installVipStore(modal);
    });
    const target = document.querySelector('#messages');
    if (target) observer.observe(target, { childList: true, subtree: true });
    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(loadDiamonds, 10000);
  };

  const style = document.createElement('style');
  style.textContent = `.${DIAMOND_CLASS}{display:inline-block;margin-inline-start:4px;font-size:.9em;line-height:1;vertical-align:middle}.dorhami-vip-plans{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}.dorhami-vip-plan{display:flex;align-items:center;justify-content:space-between;gap:5px;padding:7px 8px;border:1px solid rgba(250,204,21,.2);border-radius:10px;background:rgba(250,204,21,.07);color:#fff;cursor:pointer;font:inherit;font-size:9px}.dorhami-vip-plan:hover{background:rgba(250,204,21,.14);transform:translateY(-1px)}.dorhami-vip-plan:disabled{opacity:.55;cursor:wait}.dorhami-vip-plan b{color:#67e8f9;white-space:nowrap}.dorhami-vip-purchase-status{margin-top:7px;min-height:18px;color:#cbd5e1;font-size:8px;line-height:1.7}.dorhami-diamond-store-product{margin-top:10px}.dorhami-diamond-store-product-title{font-size:12px;font-weight:900;color:#67e8f9}.dorhami-store-product-note{margin-top:4px;color:#94a3b8;font-size:8px;line-height:1.7}.dorhami-diamond-plans{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}.dorhami-diamond-plan{display:flex;align-items:center;justify-content:space-between;gap:5px;padding:8px;border:1px solid rgba(103,232,249,.2);border-radius:10px;background:rgba(34,211,238,.06);color:#fff;cursor:pointer;font:inherit;font-size:9px}.dorhami-diamond-plan:hover{background:rgba(34,211,238,.12);transform:translateY(-1px)}.dorhami-diamond-plan:disabled{opacity:.55;cursor:wait}.dorhami-diamond-plan b{color:#fbbf24;white-space:nowrap}.dorhami-diamond-status{margin-top:7px;min-height:18px;color:#cbd5e1;font-size:8px;line-height:1.7}@media(max-width:650px){.dorhami-vip-plans,.dorhami-diamond-plans{grid-template-columns:1fr 1fr}}`;
  document.head.appendChild(style);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();