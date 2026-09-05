(() => {
  const form = document.getElementById('messageForm');
  const originalButton = document.getElementById('voiceRecordButton');
  const status = document.getElementById('voiceStatus');
  if (!form || !originalButton || originalButton.dataset.voicePublicInstalled === '1') return;

  const button = originalButton.cloneNode(false);
  button.dataset.voicePublicInstalled = '1';
  originalButton.replaceWith(button);

  let recorder = null;
  let chunks = [];
  let pendingVoiceBlob = null;
  let busy = false;

  const setStatus = (text, show = true) => {
    if (!status) return;
    status.textContent = text || '';
    status.classList.toggle('hidden', !show || !text);
  };

  async function checkVip() {
    const response = await fetch('/vip/status', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.is_vip) throw new Error('👑 ارسال ویس فقط برای کاربران VIP فعال است.');
  }

  function mimeType() {
    const types = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];
    return types.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  }

  async function startRecording() {
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) throw new Error('ضبط ویس در این مرورگر پشتیبانی نمی‌شود.');
    await checkVip();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const type = mimeType();
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks = [];
    pendingVoiceBlob = null;
    recorder.addEventListener('dataavailable', event => { if (event.data?.size) chunks.push(event.data); });
    recorder.addEventListener('stop', () => {
      stream.getTracks().forEach(track => track.stop());
      button.classList.remove('recording');
      button.textContent = '🎙️';
      if (!chunks.length) { setStatus('ضبطی ثبت نشد.', true); recorder = null; return; }
      const actualMime = String(recorder.mimeType || type || 'audio/webm').split(';')[0].trim().toLowerCase();
      pendingVoiceBlob = new Blob(chunks, { type: actualMime });
      const kb = Math.max(1, Math.round(pendingVoiceBlob.size / 1024));
      if (pendingVoiceBlob.size > 2 * 1024 * 1024) {
        pendingVoiceBlob = null;
        setStatus('❌ حجم ویس بیشتر از ۲ مگابایت است.', true);
      } else {
        setStatus(`🎙️ ویس آماده ارسال (${kb} KB) — روی ➤ بزن.`, true);
      }
      recorder = null;
    });
    recorder.start();
    button.classList.add('recording');
    button.textContent = '⏹️';
    setStatus('🔴 در حال ضبط… برای پایان دوباره روی دکمه بزن.', true);
  }

  button.addEventListener('click', async () => {
    if (busy) return;
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    busy = true;
    try { await startRecording(); }
    catch (error) { setStatus(error.message || 'ضبط ویس انجام نشد.', true); button.classList.remove('recording'); button.textContent = '🎙️'; }
    finally { busy = false; }
  });

  form.addEventListener('submit', async event => {
    if (!pendingVoiceBlob) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const privateWith = String(document.getElementById('privateWith')?.textContent || '').trim();
    if (privateWith) {
      setStatus('🎙️ فعلاً ارسال ویس فقط در اتاق عمومی فعال است.', true);
      return;
    }
    if (busy) return;
    busy = true;
    try {
      setStatus('⏳ در حال ارسال ویس…', true);
      const mime = String(pendingVoiceBlob.type || 'audio/webm').split(';')[0].trim().toLowerCase();
      const response = await fetch('/voice/upload', {
        method: 'POST',
        headers: { 'content-type': mime },
        body: pendingVoiceBlob
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'آپلود ویس انجام نشد.');
      const voiceId = data.voice_id || data.id;
      if (!voiceId) throw new Error('شناسه ویس از سرور دریافت نشد.');
      const me = localStorage.getItem('dorhami_user') || '';
      const send = await fetch('/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: me, text: `[voice:${voiceId}:${mime}]` })
      });
      const sendData = await send.json().catch(() => ({}));
      if (!send.ok) throw new Error(sendData.error || 'ارسال ویس انجام نشد.');
      pendingVoiceBlob = null;
      setStatus('✅ ویس ارسال شد.', true);
      setTimeout(() => setStatus('', false), 1200);
      document.getElementById('messageInput')?.focus();
      window.dispatchEvent(new CustomEvent('dorhami:voice-sent'));
    } catch (error) {
      setStatus(error.message || 'ارسال ویس انجام نشد.', true);
    } finally { busy = false; }
  }, true);

  function renderPlayers() {
    document.querySelectorAll('#messages .message .body').forEach(body => {
      if (body.querySelector('audio')) return;
      const text = String(body.textContent || '').trim();
      const match = text.match(/^\[voice:([0-9a-f-]{36}):([^\]]+)\]$/i);
      if (!match) return;
      body.classList.add('voice-message');
      body.textContent = '';
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = '/voice?id=' + encodeURIComponent(match[1]);
      body.appendChild(audio);
    });
  }

  renderPlayers();
  const messages = document.getElementById('messages');
  if (messages) new MutationObserver(renderPlayers).observe(messages, { subtree: true, childList: true });
})();
