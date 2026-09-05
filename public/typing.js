(() => {
  const input = document.querySelector('#messageInput');
  const composer = document.querySelector('#messageForm');
  if (!input || !composer) return;

  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator hidden';
  indicator.setAttribute('aria-live', 'polite');
  indicator.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span><span class="typing-text"></span>';
  composer.parentNode.insertBefore(indicator, composer);

  const voiceButton = document.createElement('button');
  voiceButton.type = 'button';
  voiceButton.id = 'voiceRecordButton';
  voiceButton.className = 'voice-record-button';
  voiceButton.setAttribute('aria-label', 'ضبط ویس VIP');
  voiceButton.title = 'ضبط ویس VIP';
  voiceButton.textContent = '🎙️';
  composer.insertBefore(voiceButton, composer.firstChild);

  const voiceStatus = document.createElement('div');
  voiceStatus.id = 'voiceStatus';
  voiceStatus.className = 'voice-status hidden';
  composer.parentNode.insertBefore(voiceStatus, composer);

  const style = document.createElement('style');
  style.textContent = `
    .composer{align-items:center}
    .voice-record-button{width:50px;height:46px;flex:none;border:1px solid rgba(167,139,250,.22);border-radius:13px;background:rgba(124,58,237,.16);color:#fff;font-size:20px;cursor:pointer;transition:.18s}
    .voice-record-button:hover{transform:translateY(-1px);background:rgba(124,58,237,.28)}
    .voice-record-button.recording{background:rgba(239,68,68,.22);border-color:rgba(248,113,113,.55);animation:voicePulse 1.1s ease-in-out infinite}
    .voice-record-button:disabled{opacity:.65;cursor:wait}
    .voice-status{padding:7px 14px;text-align:center;color:#c4b5fd;font-size:10px;background:rgba(124,58,237,.07);border-top:1px solid rgba(255,255,255,.05)}
    .voice-status.hidden{display:none}
    @keyframes voicePulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.08)}50%{box-shadow:0 0 0 6px rgba(239,68,68,.12)}}
    @media(max-width:520px){.voice-record-button{width:46px;height:46px}.composer{gap:7px}.composer input{min-width:0}}
  `;
  document.head.appendChild(style);

  let stopTimer = null;
  let pollTimer = null;
  let lastContext = '';
  let mediaRecorder = null;
  let voiceChunks = [];
  let recordedVoiceBlob = null;

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

  function setVoiceStatus(text, show = true) {
    voiceStatus.textContent = text || '';
    voiceStatus.classList.toggle('hidden', !show || !text);
  }

  async function checkVip() {
    const response = await fetch('/vip/status', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.is_vip) {
      throw new Error('👑 ارسال ویس فقط برای کاربران VIP فعال است.');
    }
  }

  function pickMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    return types.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
  }

  async function startRecording() {
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('ضبط ویس در این مرورگر پشتیبانی نمی‌شود.');
    }
    await checkVip();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = pickMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    voiceChunks = [];
    recordedVoiceBlob = null;
    mediaRecorder.addEventListener('dataavailable', event => {
      if (event.data?.size) voiceChunks.push(event.data);
    });
    mediaRecorder.addEventListener('stop', () => {
      stream.getTracks().forEach(track => track.stop());
      if (!voiceChunks.length) {
        setVoiceStatus('ضبطی ثبت نشد.', true);
        return;
      }
      recordedVoiceBlob = new Blob(voiceChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const sizeKb = Math.max(1, Math.round(recordedVoiceBlob.size / 1024));
      setVoiceStatus(`🎙️ ویس ضبط شد (${sizeKb} KB) — مرحله ارسال در قدم بعدی اضافه می‌شود.`, true);
      voiceButton.classList.remove('recording');
      voiceButton.textContent = '🎙️';
      mediaRecorder = null;
    });
    mediaRecorder.start();
    voiceButton.classList.add('recording');
    voiceButton.textContent = '⏹️';
    setVoiceStatus('🔴 در حال ضبط… برای پایان دوباره روی دکمه بزن.', true);
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  }

  voiceButton.addEventListener('click', async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      stopRecording();
      return;
    }
    voiceButton.disabled = true;
    try {
      await startRecording();
    } catch (error) {
      setVoiceStatus(error.message || 'ضبط ویس انجام نشد.', true);
      voiceButton.classList.remove('recording');
      voiceButton.textContent = '🎙️';
    } finally {
      voiceButton.disabled = false;
    }
  });

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
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  });

  pollTyping();
  pollTimer = setInterval(pollTyping, 5000);

  const managerScript = document.createElement('script');
  managerScript.src = '/manager.js?v=20260905-manager1';
  managerScript.defer = true;
  document.head.appendChild(managerScript);
})();