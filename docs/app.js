(function () {
  'use strict';

  const { reply: simpleReply, greeting, store, pick } = window.LouisBrain;
  const AI = window.LouisAI;

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const face = $('face');
  const faceWrap = $('faceWrap');
  const gaze = $('gaze');
  const eyes = [$('eyeL'), $('eyeR')];
  const mouth = $('mouth');
  const chat = $('chat');
  const status = $('status');
  const input = $('text');
  const btnMic = $('btnMic');
  const btnFaceMic = $('btnFaceMic');
  const btnSound = $('btnSound');
  const btnFace = $('btnFace');
  const btnCam = $('btnCam');
  const cam = $('cam');
  const badge = $('brainBadge');

  /* ---------- Лицо и эмоции ---------- */
  const MOUTHS = {
    neutral: 'M180 200 Q200 215 220 200',
    happy: 'M170 195 Q200 230 230 195',
    love: 'M175 195 Q200 225 225 195',
    shy: 'M188 203 Q200 210 212 203',
    sad: 'M178 212 Q200 196 222 212',
    angry: 'M180 210 Q200 200 220 210',
    surprised: 'M190 205 Q200 190 210 205 Q200 222 190 205',
    sleepy: 'M188 205 L212 205',
    thinking: 'M182 206 Q195 200 218 202',
    listening: 'M186 202 Q200 212 214 202',
    talk: 'M178 198 Q200 228 222 198 Q200 206 178 198'
  };
  const EMOTIONS = Object.keys(MOUTHS).filter((k) => k !== 'talk');
  let emotion = 'neutral';
  let emotionTimer = null;
  let sleeping = false;
  let speaking = false;
  let listening = false;
  let busy = false;

  function setEmotion(e, holdMs) {
    if (!EMOTIONS.includes(e)) e = 'neutral';
    EMOTIONS.forEach((k) => face.classList.remove(k));
    if (e !== 'neutral') face.classList.add(e);
    emotion = e;
    if (!speaking) mouth.setAttribute('d', MOUTHS[e]);
    clearTimeout(emotionTimer);
    if (holdMs && e !== 'sleepy') emotionTimer = setTimeout(() => setEmotion(listening ? 'listening' : 'neutral'), holdMs);
  }

  function blink() {
    if (sleeping) return;
    eyes.forEach((el) => el.classList.add('closed'));
    setTimeout(() => eyes.forEach((el) => el.classList.remove('closed')), 130);
  }
  (function blinkLoop() {
    blink();
    if (Math.random() < 0.2) setTimeout(blink, 260);
    setTimeout(blinkLoop, 2200 + Math.random() * 4000);
  })();

  function look(x, y) { gaze.style.transform = `translate(${x}px, ${y}px)`; }
  (function wanderLoop() {
    if (!sleeping && !listening && !busy && Math.random() < 0.6) {
      look(Math.round((Math.random() - 0.5) * 40), Math.round((Math.random() - 0.5) * 18));
      setTimeout(() => { if (!listening) look(0, 0); }, 900 + Math.random() * 1200);
    }
    setTimeout(wanderLoop, 3000 + Math.random() * 4000);
  })();

  function bounce() {
    faceWrap.classList.remove('bounce');
    void faceWrap.offsetWidth;
    faceWrap.classList.add('bounce');
  }

  /* сон после долгой тишины */
  let idleTimer = null;
  function goSleep() {
    if (convo) return;
    sleeping = true;
    setEmotion('sleepy');
    status.textContent = 'Луи дремлет. Коснись, чтобы разбудить';
  }
  function wake() {
    if (!sleeping) return false;
    sleeping = false;
    setEmotion('surprised', 1200);
    status.textContent = '';
    bounce();
    return true;
  }
  function poke() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(goSleep, 3 * 60 * 1000);
  }

  /* ---------- Голос Луи (встроенный в iPhone синтез речи) ---------- */
  let soundOn = store.get('sound', true);
  let talkAnim = null;
  let ruVoice = null;

  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const voices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith('ru'));
    ruVoice = voices.find((v) => /milena|милена/i.test(v.name)) || voices.find((v) => v.localService) || voices[0] || null;
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }

  function startTalking() {
    speaking = true;
    let open = false;
    clearInterval(talkAnim);
    talkAnim = setInterval(() => {
      open = !open;
      mouth.setAttribute('d', open ? MOUTHS.talk : MOUTHS[emotion]);
    }, 160 + Math.random() * 60);
  }
  function stopTalking() {
    speaking = false;
    clearInterval(talkAnim);
    mouth.setAttribute('d', MOUTHS[emotion]);
  }

  function cleanForSpeech(text) {
    return text
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
      .replace(/\n+/g, '. ')
      .replace(/[«»()]/g, '');
  }

  /* say(text, done): done вызывается, когда Луи договорил */
  function say(text, done) {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      stopTalking();
      if (done) done();
    };
    if (!soundOn || !('speechSynthesis' in window)) {
      startTalking();
      setTimeout(finish, Math.min(5000, 400 + text.length * 40));
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(cleanForSpeech(text));
    u.lang = 'ru-RU';
    if (ruVoice) u.voice = ruVoice;
    u.pitch = 1.45;
    u.rate = 1.03;
    u.onstart = startTalking;
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
    // страховка, если iOS не прислал onend
    const guard = setInterval(() => {
      if (finished) { clearInterval(guard); return; }
      if (!speechSynthesis.speaking && !speechSynthesis.pending) { clearInterval(guard); finish(); }
    }, 700);
  }

  function renderSound() { btnSound.textContent = soundOn ? '🔊' : '🔇'; }
  renderSound();
  btnSound.addEventListener('click', () => {
    soundOn = !soundOn;
    store.set('sound', soundOn);
    renderSound();
    if (!soundOn && 'speechSynthesis' in window) speechSynthesis.cancel();
    if (soundOn) say('Я снова могу говорить!');
  });

  /* ---------- Переписка ---------- */
  function addMsg(text, who) {
    const el = document.createElement('div');
    el.className = 'msg ' + who;
    el.textContent = text;
    chat.appendChild(el);
    chat.scrollTop = chat.scrollHeight;
    const msgs = chat.querySelectorAll('.msg');
    if (msgs.length > 120) msgs[0].remove();
  }

  function louisSays(res, done) {
    addMsg(res.text, 'louis');
    setEmotion(res.emotion || 'neutral', res.emotion === 'sleepy' ? 0 : 6000);
    if (res.bounce || res.emotion === 'love') bounce();
    if (app.classList.contains('face-only')) status.textContent = res.text;
    say(res.text, done);
    if (res.sleep) setTimeout(goSleep, 4000);
    if (res.timer) {
      setTimeout(() => {
        wake();
        louisSays({ text: res.timer.message, emotion: 'surprised', bounce: true });
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      }, res.timer.ms);
    }
  }

  function updateBadge() { badge.textContent = AI.hasKey() ? 'ИИ' : ''; }
  updateBadge();

  let aiWarned = false;

  async function handle(text) {
    text = text.trim();
    if (!text || busy) return;
    busy = true;
    wake();
    poke();
    addMsg(text, 'me');
    setEmotion('thinking');
    look(0, -6);

    const t = text.toLowerCase().replace(/ё/g, 'е');
    const nameMatch = t.match(/(?:меня зовут|зови меня|мое имя)\s+([а-яa-z-]{2,20})/);
    if (nameMatch) store.set('name', nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1));
    const wantsTimer = /(таймер|засеки|напомни.*через|разбуди.*через)/.test(t);
    const bye = /^(пока|до свидания|спокойной ночи|хватит|стоп)/.test(t);

    let res = null;
    if (AI.hasKey() && !wantsTimer) {
      status.textContent = 'Думаю…';
      try {
        res = await AI.ask(text, snap());
        aiWarned = false;
      } catch (err) {
        if (!aiWarned) {
          aiWarned = true;
          addMsg(AI.explain(err), 'louis');
        }
      }
      if (status.textContent === 'Думаю…') status.textContent = '';
    } else {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 300));
    }
    if (!res) res = simpleReply(text);

    look(0, 0);
    busy = false;
    if (bye) convo = false;
    louisSays(res, () => { if (convo) listen(); });
  }

  $('inputBar').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = input.value;
    input.value = '';
    handle(t);
  });

  $('chips').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') handle(e.target.textContent);
  });

  /* касание лица */
  faceWrap.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target === cam || busy) return;
    poke();
    if (wake()) { louisSays({ text: pick(['Ой, я задремал! Привет!', 'М-м? Я тут, я не спал!']), emotion: 'happy' }); return; }
    if (listening) return;
    const r = face.getBoundingClientRect();
    look(Math.round(((e.clientX - r.left) / r.width - 0.5) * 50), Math.round(((e.clientY - r.top) / r.height - 0.5) * 24));
    const lines = [
      ['Хи-хи, щекотно!', 'happy'], ['Ой! 😳', 'surprised'], ['Мне нравится, когда ты рядом 💜', 'love'],
      ['Эй, это мой нос!', 'shy'], ['Ещё, ещё!', 'happy']
    ];
    const [text, emo] = pick(lines);
    bounce();
    louisSays({ text, emotion: emo });
  });

  /* ---------- Постоянный диалог: слушает → отвечает → снова слушает ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let convo = false;
  let silentRounds = 0;

  function setListening(on) {
    listening = on;
    if (on) { setEmotion('listening'); look(0, -4); status.textContent = 'Слушаю…'; }
    else {
      if (emotion === 'listening') setEmotion('neutral');
      look(0, 0);
      if (/^Слушаю/.test(status.textContent)) status.textContent = '';
    }
  }
  function renderMic() {
    btnMic.classList.toggle('on', convo);
    btnFaceMic.classList.toggle('on', convo);
    btnMic.textContent = convo ? '⏹' : '🎤';
    btnFaceMic.textContent = convo ? '⏹' : '🎤';
  }

  function stopConvo(msg) {
    convo = false;
    renderMic();
    if (rec) { try { rec.abort(); } catch (e) { /* ignore */ } }
    setListening(false);
    if (msg) status.textContent = msg;
  }

  function listen() {
    if (!convo || listening || busy) return;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    rec = new SR();
    rec.lang = 'ru-RU';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    let denied = false;

    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      status.textContent = 'Слушаю… ' + (finalText + interim).trim();
    };
    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') denied = true;
    };
    rec.onend = () => {
      setListening(false);
      if (denied) {
        stopConvo();
        louisSays({ text: 'Мне не дали включить микрофон. Нажми 🎤 ещё раз, а если не выйдет, разреши микрофон для Safari в Настройках iPhone или пользуйся диктовкой на клавиатуре.', emotion: 'sad' });
        return;
      }
      const text = finalText.trim();
      if (text) {
        silentRounds = 0;
        handle(text);
      } else if (convo) {
        silentRounds++;
        if (silentRounds >= 6) stopConvo('Я замолчал, чтобы не мешать. Нажми 🎤, чтобы поболтать');
        else setTimeout(listen, 250);
      }
    };
    try {
      rec.start();
      setListening(true);
    } catch (err) {
      stopConvo('Нажми 🎤, чтобы я снова слушал');
    }
  }

  function toggleConvo() {
    wake();
    poke();
    if (!SR) {
      louisSays({ text: 'Здесь мне не удалось включить микрофон. Нажми на поле ввода и используй кнопку диктовки 🎙 на клавиатуре iPhone, это тоже работает!', emotion: 'shy' });
      if (!app.classList.contains('face-only')) input.focus();
      return;
    }
    if (convo) { stopConvo(); return; }
    convo = true;
    silentRounds = 0;
    renderMic();
    if (!busy) listen();
  }
  btnMic.addEventListener('click', toggleConvo);
  btnFaceMic.addEventListener('click', toggleConvo);

  /* ---------- Камера: глаза Луи ---------- */
  let stream = null;
  const canvas = document.createElement('canvas');

  async function toggleCam() {
    if (stream) {
      stream.getTracks().forEach((tr) => tr.stop());
      stream = null;
      cam.srcObject = null;
      cam.classList.remove('on');
      btnCam.classList.remove('on');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      louisSays({ text: 'Тут у меня нет доступа к камере.', emotion: 'sad' });
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
      cam.srcObject = stream;
      await cam.play().catch(() => {});
      cam.classList.add('on');
      btnCam.classList.add('on');
      if (AI.hasKey()) louisSays({ text: 'Ой, теперь я тебя вижу! 👀', emotion: 'surprised' });
      else louisSays({ text: 'Камера включена, но чтобы понимать, что я вижу, мне нужен ключ. Открой ⚙️ настройки.', emotion: 'shy' });
    } catch (err) {
      stream = null;
      louisSays({ text: 'Не получилось включить камеру. Разреши доступ к камере для Safari в Настройках iPhone.', emotion: 'sad' });
    }
  }
  btnCam.addEventListener('click', toggleCam);

  function snap() {
    if (!stream || !cam.videoWidth) return null;
    const scale = Math.min(1, 640 / Math.max(cam.videoWidth, cam.videoHeight));
    canvas.width = Math.round(cam.videoWidth * scale);
    canvas.height = Math.round(cam.videoHeight * scale);
    canvas.getContext('2d').drawImage(cam, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.75).split(',')[1];
  }

  /* ---------- Настройки ---------- */
  const dlg = $('settings');
  const keyInput = $('apiKey');
  const keyStatus = $('keyStatus');

  function showKeyStatus(text, cls) {
    keyStatus.textContent = text;
    keyStatus.className = 'key-status ' + (cls || '');
  }

  $('btnSettings').addEventListener('click', () => {
    keyInput.value = AI.key();
    showKeyStatus(AI.hasKey() ? 'Ключ сохранён, Луи умный. Модель: ' + AI.models()[0] : 'Ключ не задан, Луи отвечает простыми фразами.', AI.hasKey() ? 'ok' : '');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  });

  $('btnSaveKey').addEventListener('click', async () => {
    const k = keyInput.value.trim();
    if (k.length < 20) { showKeyStatus('Это не похоже на ключ. Он длинный и начинается с AIza…', 'err'); return; }
    showKeyStatus('Проверяю ключ…');
    try {
      const model = await AI.setup(k);
      showKeyStatus('Готово! Луи теперь умный. Модель: ' + model, 'ok');
      updateBadge();
    } catch (err) {
      showKeyStatus(AI.explain(err).replace(/ ?А пока.*$| ?Пока поболтаю.*$| ?Пока отвечу.*$/, ''), 'err');
      updateBadge();
    }
  });

  $('btnRemoveKey').addEventListener('click', () => {
    store.set('apiKey', '');
    store.set('models', []);
    keyInput.value = '';
    showKeyStatus('Ключ удалён. Луи отвечает простыми фразами.');
    updateBadge();
  });

  $('btnForget').addEventListener('click', () => {
    AI.forget();
    showKeyStatus('Готово, я начну разговор с чистого листа.', 'ok');
  });

  /* ---------- Режим подставки: только лицо, экран не гаснет ---------- */
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
      else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { /* не поддерживается */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (app.classList.contains('face-only') || convo)) keepAwake(true);
  });

  function setFaceOnly(on) {
    app.classList.toggle('face-only', on);
    btnFace.textContent = on ? '💬' : '⤢';
    btnFace.title = on ? 'Показать переписку' : 'Режим подставки: только лицо';
    status.textContent = on ? 'Коснись меня или нажми 🎤' : '';
    keepAwake(on);
    store.set('faceOnly', on);
  }
  btnFace.addEventListener('click', () => setFaceOnly(!app.classList.contains('face-only')));

  /* ---------- Старт ---------- */
  setFaceOnly(store.get('faceOnly', false));
  setTimeout(() => {
    const g = greeting();
    addMsg(g.text, 'louis');
    setEmotion(g.emotion, 4000);
    bounce();
    if (!AI.hasKey() && !store.get('keyHintShown', false)) {
      store.set('keyHintShown', true);
      setTimeout(() => addMsg('Подсказка: чтобы я стал по-настоящему умным и видел камеру, нажми ⚙️ вверху и добавь бесплатный ключ Google. Это займёт пару минут.', 'louis'), 900);
    }
  }, 400);
  poke();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
