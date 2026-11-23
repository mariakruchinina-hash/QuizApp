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
  let lastLouisText = '';
  let recentLouis = [];
  let speechEndedAt = 0;
  function rememberLouis(t) { recentLouis = recentLouis.filter((x) => x !== t).concat([t]).slice(-4); }
  let lastTiming = '';

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
  const voiceCfg = { uri: store.get('voiceURI', ''), pitch: store.get('pitch', 1.1), rate: store.get('rate', 1.05) };

  function ruVoices() {
    if (!('speechSynthesis' in window)) return [];
    return speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith('ru'));
  }
  function voiceQuality(v) {
    const id = (v.name + ' ' + v.voiceURI).toLowerCase();
    if (/premium|высок/.test(id)) return 3;
    if (/enhanced|улучш|neural/.test(id)) return 2;
    if (/compact|eloquence/.test(id)) return 0;
    return 1;
  }
  function pickVoice() {
    const voices = ruVoices();
    ruVoice = voices.find((v) => v.voiceURI === voiceCfg.uri) ||
      voices.slice().sort((a, b) => voiceQuality(b) - voiceQuality(a))[0] || null;
    fillVoiceSelect();
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }

  function startTalking() {
    if (speaking) return;
    speaking = true;
    let open = false;
    clearInterval(talkAnim);
    talkAnim = setInterval(() => {
      open = !open;
      mouth.setAttribute('d', open ? MOUTHS.talk : MOUTHS[emotion]);
    }, 150 + Math.random() * 60);
  }
  function stopTalking() {
    if (speaking) speechEndedAt = Date.now();
    speaking = false;
    clearInterval(talkAnim);
    mouth.setAttribute('d', MOUTHS[emotion]);
  }

  function cleanForSpeech(text) {
    return text
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
      .replace(/\n+/g, '. ')
      .replace(/[«»()]/g, '')
      .trim();
  }

  function makeUtterance(text) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU';
    if (ruVoice) u.voice = ruVoice;
    u.pitch = voiceCfg.pitch;
    u.rate = voiceCfg.rate;
    return u;
  }

  /* Говорилка, которой можно подкидывать фразы по мере того, как они готовы.
     done вызывается, когда сказано всё и больше фраз не будет. */
  function createSpeaker(done) {
    let pending = 0;
    let closed = false;
    let finished = false;
    let fakeUntil = 0;
    let silentChecks = 0;
    const tryFinish = () => {
      if (finished || !closed || pending > 0) return;
      const wait = Math.max(0, fakeUntil - Date.now());
      if (wait) { setTimeout(tryFinish, wait + 20); return; }
      finished = true;
      stopTalking();
      if (done) done();
    };
    const useVoice = soundOn && 'speechSynthesis' in window;
    if (useVoice) speechSynthesis.cancel();
    const guard = setInterval(() => {
      if (finished) { clearInterval(guard); return; }
      // страховка, если iOS потерял onend
      if (useVoice && pending > 0 && !speechSynthesis.speaking && !speechSynthesis.pending) {
        silentChecks++;
        if (silentChecks >= 2) { pending = 0; tryFinish(); }
      } else silentChecks = 0;
    }, 1500);
    return {
      push(text) {
        text = cleanForSpeech(text);
        if (!text) return;
        if (!useVoice) {
          startTalking();
          fakeUntil = Math.max(fakeUntil, Date.now()) + Math.min(5000, 300 + text.length * 45);
          return;
        }
        pending++;
        const u = makeUtterance(text);
        u.onstart = startTalking;
        u.onend = u.onerror = () => { pending = Math.max(0, pending - 1); if (pending === 0 && !closed) stopTalking(); tryFinish(); };
        speechSynthesis.speak(u);
      },
      end() { closed = true; tryFinish(); }
    };
  }

  function say(text, done) {
    const sp = createSpeaker(done);
    sp.push(text);
    sp.end();
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
    return el;
  }

  function louisSays(res, done) {
    lastLouisText = res.text; rememberLouis(res.text);
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

    const after = () => { if (convo) setTimeout(listen, 900); };
    if (AI.hasKey() && !wantsTimer) {
      status.textContent = 'Думаю…';
      let bubble = null;
      let spoken = 0;
      let lastEmotion = '';
      const t0 = Date.now();
      let firstAt = 0;
      const wantsLook = /(вид|смотр|гляд|выгляж|что это|что у меня|покаж|кто это|кто здесь|цвет|пальц|прочита|узна|замеч|оцени|какой я|какая я|во что|одет|на мне|в руке|в руках)/.test(t);
      const image = wantsLook ? snap() : null;
      const speaker = createSpeaker(after);
      // отдаём голосу законченные предложения, не дожидаясь конца ответа
      const feed = (text, final) => {
        const rest = text.slice(spoken);
        let cut = -1;
        if (final) cut = rest.length;
        else {
          const re = /[.!?…]+["»)]*\s+|[,;:—]\s+(?=\S{2,})/g;
          let m;
          while ((m = re.exec(rest))) {
            const end = m.index + m[0].length;
            const isSentence = /[.!?…]/.test(m[0]);
            // запятая годится для паузы только в длинном куске
            if (isSentence || end > 60) cut = end;
          }
        }
        if (cut > 0) { speaker.push(rest.slice(0, cut)); spoken += cut; }
      };
      try {
        const res = await AI.ask(text, image, (part) => {
          if (!bubble) {
            status.textContent = '';
            look(0, 0);
            bubble = addMsg('', 'louis');
          }
          bubble.textContent = part.text;
          lastLouisText = part.text;
          if (!firstAt) firstAt = Date.now();
          chat.scrollTop = chat.scrollHeight;
          if (app.classList.contains('face-only')) status.textContent = part.text;
          if (part.emotion !== lastEmotion) {
            lastEmotion = part.emotion;
            setEmotion(part.emotion, 0);
            if (part.emotion === 'love') bounce();
          }
          feed(part.text, false);
        });
        if (!bubble) bubble = addMsg('', 'louis');
        bubble.textContent = res.text;
        lastLouisText = res.text; rememberLouis(res.text);
        lastTiming = `Последний ответ: Google начал отвечать через ${((firstAt - t0) / 1000).toFixed(1)} с${image ? ' (с кадром камеры)' : ''}, модель ${AI.models()[0]}`;
        feed(res.text, true);
        setEmotion(res.emotion, 6000);
        aiWarned = false;
        busy = false;
        if (bye) convo = false;
        speaker.end();
        return;
      } catch (err) {
        if (bubble) {
          // ответ оборвался на середине: договариваем то, что уже пришло
          feed(bubble.textContent, true);
          busy = false;
          speaker.end();
          return;
        }
        speaker.end();
        if (status.textContent === 'Думаю…') status.textContent = '';
        if (!aiWarned) {
          aiWarned = true;
          addMsg(AI.explain(err), 'louis');
        }
      }
    } else {
      await new Promise((r) => setTimeout(r, 250 + Math.random() * 250));
    }
    const res = simpleReply(text);
    look(0, 0);
    busy = false;
    if (bye) convo = false;
    louisSays(res, after);
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
    if (e.target.closest('button') || e.target === cam) return;
    if (busy) { AI.cancel(); return; }
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

  /* Похоже ли услышанное на то, что только что сказал сам Луи (эхо из динамика) */
  function isEcho(text) {
    if (!recentLouis.length) return false;
    const norm = (x) => x.toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = (x) => norm(x).split(' ').filter((w) => w.length > 2);
    const heardNorm = norm(text);
    const heard = words(text);
    for (const said of recentLouis) {
      const saidNorm = norm(said);
      // услышанное целиком входит в то, что Луи сказал (обрывок его фразы)
      if (heardNorm.length >= 6 && saidNorm.includes(heardNorm)) return true;
      if (!heard.length) continue;
      const set = new Set(words(said));
      const hit = heard.filter((w) => set.has(w)).length;
      if (heard.length >= 2 && hit / heard.length >= 0.5) return true;
    }
    return false;
  }

  function listen() {
    if (!convo || listening || busy) return;
    // не включаем микрофон, пока Луи ещё говорит, иначе он услышит сам себя
    if (speaking || ('speechSynthesis' in window && speechSynthesis.speaking) || Date.now() - speechEndedAt < 800) { setTimeout(listen, 300); return; }
    rec = new SR();
    rec.lang = 'ru-RU';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let heard = '';
    let done = false;
    let denied = false;
    let quiet = null;

    // iPhone долго ждёт тишины сам; мы решаем быстрее: 1,1 с без новых слов значит «договорил»
    const finishNow = () => {
      if (done) return;
      done = true;
      clearTimeout(quiet);
      try { rec.stop(); } catch (e) { /* ignore */ }
      setListening(false);
      gotPhrase(heard.trim());
    };

    rec.onresult = (ev) => {
      let all = '';
      for (let i = 0; i < ev.results.length; i++) all += ev.results[i][0].transcript;
      heard = all;
      status.textContent = 'Слушаю… ' + all.trim();
      clearTimeout(quiet);
      if (all.trim()) quiet = setTimeout(finishNow, 1100);
    };
    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') denied = true;
    };
    rec.onend = () => {
      clearTimeout(quiet);
      if (done) return;
      done = true;
      setListening(false);
      if (denied) {
        stopConvo();
        louisSays({ text: 'Мне не дали включить микрофон. Нажми 🎤 ещё раз, а если не выйдет, разреши микрофон для Safari в Настройках iPhone или пользуйся диктовкой на клавиатуре.', emotion: 'sad' });
        return;
      }
      gotPhrase(heard.trim());
    };
    try {
      rec.start();
      setListening(true);
    } catch (err) {
      stopConvo('Нажми 🎤, чтобы я снова слушал');
    }
  }

  function gotPhrase(text) {
    if (text && isEcho(text)) text = '';
    if (text) {
      silentRounds = 0;
      handle(text);
    } else if (convo) {
      silentRounds++;
      if (silentRounds >= 6) stopConvo('Я замолчал, чтобы не мешать. Нажми 🎤, чтобы поболтать');
      else setTimeout(listen, 250);
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
    const scale = Math.min(1, 448 / Math.max(cam.videoWidth, cam.videoHeight));
    canvas.width = Math.round(cam.videoWidth * scale);
    canvas.height = Math.round(cam.videoHeight * scale);
    canvas.getContext('2d').drawImage(cam, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
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
    pickVoice();
    showVoiceVals();
    $('pingOut').textContent = lastTiming;
    fillModelSelect();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  });

  /* выбор голоса */
  function fillVoiceSelect() {
    const sel = $('voiceSel');
    if (!sel) return;
    const voices = ruVoices().slice().sort((a, b) => voiceQuality(b) - voiceQuality(a));
    sel.innerHTML = '';
    if (!voices.length) {
      sel.add(new Option('Русские голоса не найдены', ''));
      return;
    }
    voices.forEach((v) => {
      const q = voiceQuality(v);
      const mark = q >= 3 ? ' ★★' : q === 2 ? ' ★' : '';
      sel.add(new Option(v.name + mark, v.voiceURI, false, ruVoice && v.voiceURI === ruVoice.voiceURI));
    });
  }
  function showVoiceVals() {
    $('pitch').value = voiceCfg.pitch;
    $('rate').value = voiceCfg.rate;
    $('pitchVal').textContent = Number(voiceCfg.pitch).toFixed(2);
    $('rateVal').textContent = Number(voiceCfg.rate).toFixed(2);
  }
  $('voiceSel').addEventListener('change', (e) => {
    voiceCfg.uri = e.target.value;
    store.set('voiceURI', voiceCfg.uri);
    pickVoice();
    say('Привет! Теперь я говорю вот так.');
  });
  $('pitch').addEventListener('input', (e) => { voiceCfg.pitch = parseFloat(e.target.value); store.set('pitch', voiceCfg.pitch); showVoiceVals(); });
  $('rate').addEventListener('input', (e) => { voiceCfg.rate = parseFloat(e.target.value); store.set('rate', voiceCfg.rate); showVoiceVals(); });
  $('btnTryVoice').addEventListener('click', () => say('Привет! Я Луи. Мне очень нравится с тобой болтать.'));

  function fillModelSelect() {
    const sel = $('modelSel');
    sel.innerHTML = '';
    const cur = AI.models()[0];
    AI.allModels().forEach((m) => {
      const note = /lite/.test(m) ? ' (самая быстрая)' : /preview/.test(m) ? ' (экспериментальная)' : '';
      sel.add(new Option(m + note, m, false, m === cur));
    });
  }
  $('modelSel').addEventListener('change', (e) => {
    store.set('modelPref', e.target.value);
    showKeyStatus('Модель: ' + e.target.value, 'ok');
  });

  $('btnPing').addEventListener('click', async () => {
    const out = $('pingOut');
    if (!AI.hasKey()) { out.textContent = 'Сначала сохрани ключ.'; return; }
    out.textContent = 'Проверяю…';
    out.textContent = await AI.ping();
  });

  $('btnSaveKey').addEventListener('click', async () => {
    const k = keyInput.value.trim();
    if (k.length < 20) { showKeyStatus('Это не похоже на ключ. Он длинный и начинается с AIza…', 'err'); return; }
    showKeyStatus('Проверяю ключ…');
    try {
      const model = await AI.setup(k);
      showKeyStatus('Готово! Луи теперь умный. Модель: ' + model, 'ok');
      fillModelSelect();
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
