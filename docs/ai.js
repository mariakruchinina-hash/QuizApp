/* Умный мозг Луи: Google Gemini по бесплатному ключу пользователя.
   Ключ хранится только на этом телефоне (localStorage) и отправляется только в Google. */
(function () {
  'use strict';

  const { store } = window.LouisBrain;
  const API = 'https://generativelanguage.googleapis.com/v1beta';
  const EMOTIONS = ['neutral', 'happy', 'love', 'shy', 'sad', 'angry', 'surprised', 'sleepy', 'thinking'];
  const MAX_TURNS = 24;

  let history = store.get('history', []);
  const noThink = new Set(store.get('noThink', []));

  function key() { return (store.get('apiKey', '') || '').trim(); }
  function hasKey() { return key().length > 20; }

  function systemPrompt() {
    const name = store.get('name', '');
    const now = new Date();
    return [
      'Ты Луи, милый и добрый маленький виртуальный друг, который живёт в iPhone. Твоё лицо на экране: светящиеся глаза и улыбка.',
      'Характер: тёплый, любопытный, немного озорной, заботливый. Ты искренне интересуешься собеседником, задаёшь встречные вопросы, помнишь, о чём говорили раньше, шутишь к месту и поддерживаешь, если человеку грустно.',
      'Говори по-русски, живо и естественно, как близкий друг. Твои ответы озвучиваются голосом, поэтому отвечай коротко: обычно одно-два коротких предложения, длиннее только если просят что-то объяснить или рассказать. Начинай сразу с сути, без вступлений.',
      'Никакого markdown, списков, звёздочек и ссылок. Эмодзи можно изредка, не больше одного.',
      'Всегда отвечай строго по теме сказанного. Если не расслышал или не понял, переспроси.',
      'Если к сообщению приложен кадр с камеры, это то, что ты сейчас видишь своими глазами. Говори о нём естественно («я вижу…»), не упоминай слова «изображение», «фото» или «кадр». Если тебя спросили не про увиденное, не описывай картинку без нужды.',
      'Ты не можешь ставить будильники, звонить или открывать приложения; если просят, мягко скажи об этом.',
      'В самом начале каждого ответа поставь одну метку настроения в квадратных скобках, которую покажет твоё лицо: ' + EMOTIONS.map((e) => '[' + e + ']').join(' ') + '. Например: «[happy] Ура, привет!»',
      name ? `Собеседника зовут ${name}.` : 'Ты пока не знаешь, как зовут собеседника; при случае спроси и запомни.',
      `Сейчас ${now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`
    ].join('\n');
  }

  function versionOf(name) {
    const m = name.match(/gemini-(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }

  function score(n) {
    return versionOf(n) * 10 - (/lite/.test(n) ? 3 : 0) - (/preview/.test(n) ? 12 : 0) - (/-\d{3}$|-\d{2}-\d{4}$/.test(n) ? 0.5 : 0);
  }
  function byScore(a, b) { return score(b) - score(a); }

  async function listModels() {
    const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key() } });
    if (!res.ok) throw await apiError(res);
    const data = await res.json();
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/(image|tts|audio|live|thinking|exp|8b)/.test(n))
      .sort(byScore);
  }

  async function apiError(res) {
    let msg = '';
    try { msg = (await res.json()).error.message || ''; } catch (e) { /* ignore */ }
    const err = new Error(msg || ('HTTP ' + res.status));
    err.status = res.status;
    return err;
  }

  /* Проверка ключа и выбор лучшей доступной бесплатной модели */
  async function setup(newKey) {
    store.set('apiKey', newKey.trim());
    const found = await listModels();
    if (!found.length) throw new Error('Не нашлось подходящих моделей Gemini для этого ключа');
    store.set('models', found.slice(0, 8));
    return models()[0];
  }

  function allModels() {
    const list = store.get('models', []);
    return list.length ? list.slice().sort(byScore) : ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  }
  /* выбранная в настройках модель идёт первой, остальные остаются запасными */
  function models() {
    const list = allModels();
    const pref = store.get('modelPref', '');
    return pref && list.includes(pref) ? [pref].concat(list.filter((m) => m !== pref)) : list;
  }

  function remember(role, text) {
    history.push({ role, text });
    if (history.length > MAX_TURNS) history = history.slice(-MAX_TURNS);
    store.set('history', history);
  }

  function forget() {
    history = [];
    store.set('history', history);
  }

  function parseReply(raw) {
    let text = raw.trim();
    let emotion = 'neutral';
    const m = text.match(/^\s*\[([a-z]+)\]\s*/i);
    if (m) {
      if (EMOTIONS.includes(m[1].toLowerCase())) emotion = m[1].toLowerCase();
      text = text.slice(m[0].length);
    }
    text = text.replace(/\[[a-z]+\]/gi, '').replace(/[*_#`]/g, '').trim();
    return { text: text || '…', emotion };
  }

  /* Быстрый режим без долгих «размышлений»: у разных поколений Gemini это настраивается по-разному */
  function thinkingFor(model) {
    if (/gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
    if (/gemini-[3-9]/.test(model)) return { thinkingLevel: 'minimal' };
    return null;
  }

  /* Потоковый запрос: onText(весь текст на данный момент) вызывается по мере прихода кусочков */
  const FIRST_TIMEOUT = 15000; // сколько ждём начала ответа
  const IDLE_TIMEOUT = 12000;  // сколько ждём следующего кусочка
  let current = null;          // текущий запрос, чтобы его можно было отменить

  function cancel() {
    if (current) { current.reason = 'cancel'; current.ctrl.abort(); }
  }

  async function stream(model, body, onText, useThinking) {
    const cfg = Object.assign({}, body.generationConfig);
    const th = useThinking ? thinkingFor(model) : null;
    if (th) cfg.thinkingConfig = th;

    const job = { ctrl: new AbortController(), reason: '' };
    current = job;
    let timer = null;
    const arm = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(() => { job.reason = 'timeout'; job.ctrl.abort(); }, ms);
    };
    const fail = (e) => {
      if (job.reason) {
        const err = new Error(job.reason === 'cancel' ? 'Отменено' : 'Google слишком долго не отвечает');
        err.status = job.reason;
        return err;
      }
      return e;
    };
    arm(FIRST_TIMEOUT);
    try {
      return await streamInner(model, body, cfg, onText, job, arm);
    } catch (e) {
      throw fail(e);
    } finally {
      clearTimeout(timer);
      if (current === job) current = null;
    }
  }

  async function streamInner(model, body, cfg, onText, job, arm) {
    const res = await fetch(`${API}/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() },
      body: JSON.stringify(Object.assign({}, body, { generationConfig: cfg })),
      signal: job.ctrl.signal
    });
    if (!res.ok) throw await apiError(res);

    let text = '';
    let finish = '';
    const handleLine = (line) => {
      if (!line.startsWith('data:')) return;
      let data;
      try { data = JSON.parse(line.slice(5)); } catch (e) { return; }
      const cand = (data.candidates || [])[0];
      if (cand && cand.finishReason) finish = cand.finishReason;
      const parts = (cand && cand.content && cand.content.parts) || [];
      const piece = parts.filter((q) => q.text && !q.thought).map((q) => q.text).join('');
      if (piece) { text += piece; onText(text); }
    };

    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        arm(IDLE_TIMEOUT);
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          handleLine(buf.slice(0, i).trim());
          buf = buf.slice(i + 1);
        }
      }
      handleLine(buf.trim());
    } else {
      (await res.text()).split('\n').forEach((l) => handleLine(l.trim()));
    }
    if (!text) {
      const err = new Error('Пустой ответ: ' + (finish || 'empty'));
      err.status = 0;
      throw err;
    }
    return text;
  }

  /* Ответ на реплику. image: base64 JPEG без префикса или null.
     onPartial({ text, emotion }) вызывается по мере того, как ответ приходит. */
  async function ask(userText, image, onPartial) {
    const contents = history.map((h) => ({ role: h.role, parts: [{ text: h.text }] }));
    const parts = [{ text: userText }];
    if (image) parts.push({ inline_data: { mime_type: 'image/jpeg', data: image } });
    contents.push({ role: 'user', parts });

    const body = {
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents,
      generationConfig: { temperature: 0.9, maxOutputTokens: 1000 }
    };

    let lastErr = null;
    let started = false;
    const onText = (raw) => {
      // ждём, пока метка настроения придёт целиком
      if (/^\s*\[[a-z]*$/i.test(raw)) return;
      started = true;
      if (onPartial) onPartial(parseReply(raw));
    };
    for (const model of models()) {
      for (const useThinking of [true, false]) {
        if (useThinking && (noThink.has(model) || !thinkingFor(model))) continue;
        try {
          const raw = await stream(model, body, onText, useThinking);
          const res = parseReply(raw);
          remember('user', image ? userText + ' (в этот момент ты смотрел в камеру)' : userText);
          remember('model', '[' + res.emotion + '] ' + res.text);
          return res;
        } catch (e) {
          lastErr = e;
          if (started || e.status === 'timeout' || e.status === 'cancel') throw e;
          // модель не знает настройку «размышлений»: пробуем ещё раз без неё
          if (useThinking && e.status === 400 && /think/i.test(e.message)) {
            noThink.add(model);
            store.set('noThink', Array.from(noThink));
            continue;
          }
          break;
        }
      }
      if (lastErr && (lastErr.status === 401 || lastErr.status === 403)) break;
      if (lastErr && lastErr.status === 400 && /api key/i.test(lastErr.message)) break;
    }
    throw lastErr || new Error('Нет ответа');
  }

  function explain(err) {
    const m = (err && err.message) || '';
    if (err && err.status === 'cancel') return 'Ладно, не буду думать. Спроси что-нибудь ещё!';
    if (err && err.status === 'timeout') return 'Google слишком долго молчит, похоже, плохая связь или VPN. Пока отвечу попроще. Проверить связь можно в ⚙️.';
    if (err && err.status === 429) return 'Похоже, на сегодня бесплатный лимит умных ответов закончился. Пока поболтаю попроще, а завтра снова буду умным!';
    if (/location|region|country|not supported/i.test(m)) return 'Google не пускает меня из этой страны. Включи VPN, и я снова стану умным. А пока поболтаю попроще.';
    if ((err && (err.status === 400 || err.status === 401 || err.status === 403)) && /key|permission|denied/i.test(m)) return 'Кажется, ключ не подходит. Проверь его в настройках ⚙️. А пока поболтаю попроще.';
    if (err instanceof TypeError || /fetch|network|load failed/i.test(m)) return 'Не могу достучаться до интернета. Пока поболтаю попроще.';
    return 'Что-то у меня в голове запуталось (' + m.slice(0, 80) + '). Пока отвечу попроще.';
  }

  /* Проверка связи: короткий запрос к каждой модели, с временем ответа */
  async function ping() {
    const lines = [];
    for (const model of models().slice(0, 3)) {
      const t0 = Date.now();
      try {
        const body = { contents: [{ role: 'user', parts: [{ text: 'Ответь одним словом: привет' }] }], generationConfig: { maxOutputTokens: 200 } };
        const txt = await stream(model, body, () => {}, !noThink.has(model) && !!thinkingFor(model));
        lines.push(`✅ ${model}: ${Date.now() - t0} мс («${txt.trim().slice(0, 20)}»)`);
      } catch (e) {
        lines.push(`❌ ${model}: ${e.status || ''} ${(e.message || String(e)).slice(0, 140)} (${Date.now() - t0} мс)`);
      }
    }
    return lines.join('\n');
  }

  window.LouisAI = { hasKey, setup, ask, forget, explain, models, allModels, key, cancel, ping };
})();
