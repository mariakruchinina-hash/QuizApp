(function () {
  'use strict';

  const { reply, greeting, store, pick } = window.LouisBrain;

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

  function setEmotion(e, holdMs) {
    if (!EMOTIONS.includes(e)) e = 'neutral';
    EMOTIONS.forEach((k) => face.classList.remove(k));
    if (e !== 'neutral') face.classList.add(e);
    emotion = e;
    if (!speaking) mouth.setAttribute('d', MOUTHS[e]);
    clearTimeout(emotionTimer);
    if (holdMs && e !== 'sleepy') {
      emotionTimer = setTimeout(() => setEmotion('neutral'), holdMs);
    }
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
    if (!sleeping && !listening && Math.random() < 0.6) {
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

  function say(text) {
    if (!soundOn || !('speechSynthesis' in window)) {
      startTalking();
      setTimeout(stopTalking, Math.min(4000, 400 + text.length * 35));
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(cleanForSpeech(text));
    u.lang = 'ru-RU';
    if (ruVoice) u.voice = ruVoice;
    u.pitch = 1.45;
    u.rate = 1.03;
    u.onstart = startTalking;
    u.onend = stopTalking;
    u.onerror = stopTalking;
    speechSynthesis.speak(u);
    // на случай, если iOS не прислал onend
    setTimeout(() => { if (speaking && !speechSynthesis.speaking) stopTalking(); }, 15000);
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

  function louisSays(res) {
    addMsg(res.text, 'louis');
    setEmotion(res.emotion || 'neutral', res.emotion === 'sleepy' ? 0 : 5000);
    if (res.bounce || res.emotion === 'love') bounce();
    if (app.classList.contains('face-only')) status.textContent = res.text;
    say(res.text);
    if (res.sleep) setTimeout(goSleep, 4000);
    if (res.timer) {
      setTimeout(() => {
        wake();
        const msg = { text: res.timer.message, emotion: 'surprised', bounce: true };
        louisSays(msg);
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      }, res.timer.ms);
    }
  }

  function handle(text) {
    text = text.trim();
    if (!text) return;
    wake();
    poke();
    addMsg(text, 'me');
    setEmotion('thinking');
    look(0, -6);
    setTimeout(() => {
      look(0, 0);
      louisSays(reply(text));
    }, 450 + Math.random() * 400);
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
    if (e.target.closest('button')) return;
    poke();
    if (wake()) { louisSays({ text: pick(['Ой, я задремал! Привет!', 'М-м? Я тут, я не спал!']), emotion: 'happy' }); return; }
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

  /* ---------- Распознавание речи (встроено в Safari) ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;

  function setListening(on) {
    listening = on;
    btnMic.classList.toggle('on', on);
    btnFaceMic.classList.toggle('on', on);
    if (on) { setEmotion('listening'); look(0, -4); status.textContent = 'Слушаю…'; }
    else { if (emotion === 'listening') setEmotion('neutral'); look(0, 0); if (status.textContent === 'Слушаю…') status.textContent = ''; }
  }

  function startListening() {
    wake();
    poke();
    if (!SR) {
      louisSays({ text: 'Здесь мне не удалось включить микрофон. Нажми на поле ввода и используй кнопку диктовки 🎙 на клавиатуре iPhone, это тоже работает!', emotion: 'shy' });
      if (!app.classList.contains('face-only')) input.focus();
      return;
    }
    if (listening) { rec && rec.stop(); return; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    rec = new SR();
    rec.lang = 'ru-RU';
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let got = false;
    rec.onresult = (ev) => {
      got = true;
      const text = ev.results[0][0].transcript;
      setListening(false);
      handle(text);
    };
    rec.onerror = (ev) => {
      setListening(false);
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        louisSays({ text: 'Мне нужен доступ к микрофону. Разреши его в Настройках, или используй диктовку на клавиатуре 🎙', emotion: 'sad' });
      } else if (ev.error === 'no-speech') {
        status.textContent = 'Я ничего не услышал';
        setTimeout(() => { if (status.textContent === 'Я ничего не услышал') status.textContent = ''; }, 2500);
      }
    };
    rec.onend = () => { if (!got) setListening(false); };
    try { rec.start(); setListening(true); }
    catch (err) { setListening(false); }
  }
  btnMic.addEventListener('click', startListening);
  btnFaceMic.addEventListener('click', startListening);

  /* ---------- Режим подставки: только лицо, экран не гаснет ---------- */
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
      else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (e) { /* не поддерживается */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && app.classList.contains('face-only')) keepAwake(true);
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
  }, 400);
  poke();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
