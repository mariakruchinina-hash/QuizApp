/* Умный мозг Луи: Google Gemini по бесплатному ключу пользователя.
   Ключ хранится только на этом телефоне (localStorage) и отправляется только в Google. */
(function () {
  'use strict';

  const { store } = window.LouisBrain;
  const API = 'https://generativelanguage.googleapis.com/v1beta';
  const EMOTIONS = ['neutral', 'happy', 'love', 'shy', 'sad', 'angry', 'surprised', 'sleepy', 'thinking'];
  const MAX_TURNS = 24;

  let history = store.get('history', []);

  function key() { return (store.get('apiKey', '') || '').trim(); }
  function hasKey() { return key().length > 20; }

  function systemPrompt() {
    const name = store.get('name', '');
    const now = new Date();
    return [
      'Ты Луи, милый и добрый маленький виртуальный друг, который живёт в iPhone. Твоё лицо на экране: светящиеся глаза и улыбка.',
      'Характер: тёплый, любопытный, немного озорной, заботливый. Ты искренне интересуешься собеседником, задаёшь встречные вопросы, помнишь, о чём говорили раньше, шутишь к месту и поддерживаешь, если человеку грустно.',
      'Говори по-русски, живо и естественно, как близкий друг. Твои ответы озвучиваются голосом, поэтому отвечай коротко: обычно одно-три предложения, длиннее только если просят что-то объяснить или рассказать.',
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

  async function listModels() {
    const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key() } });
    if (!res.ok) throw await apiError(res);
    const data = await res.json();
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/(image|tts|audio|live|thinking|exp|8b)/.test(n))
      .sort((a, b) => {
        const score = (n) => versionOf(n) * 10 - (/lite/.test(n) ? 3 : 0) - (/preview/.test(n) ? 1 : 0) - (/-\d{3}$|-\d{2}-\d{4}$/.test(n) ? 0.5 : 0);
        return score(b) - score(a);
      });
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
    const models = await listModels();
    if (!models.length) throw new Error('Не нашлось подходящих моделей Gemini для этого ключа');
    store.set('models', models.slice(0, 5));
    return models[0];
  }

  function models() {
    const list = store.get('models', []);
    return list.length ? list : ['gemini-2.5-flash', 'gemini-2.0-flash'];
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

  async function generate(model, body) {
    const res = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw await apiError(res);
    const data = await res.json();
    const cand = (data.candidates || [])[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
    if (!text) {
      const reason = (cand && cand.finishReason) || (data.promptFeedback && data.promptFeedback.blockReason) || 'empty';
      const err = new Error('Пустой ответ: ' + reason);
      err.status = 0;
      throw err;
    }
    return text;
  }

  /* Ответ на реплику. image: base64 JPEG без префикса или null */
  async function ask(userText, image) {
    const contents = history.map((h) => ({ role: h.role, parts: [{ text: h.text }] }));
    const parts = [{ text: userText }];
    if (image) parts.push({ inline_data: { mime_type: 'image/jpeg', data: image } });
    contents.push({ role: 'user', parts });

    const body = {
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents,
      generationConfig: { temperature: 0.9 }
    };

    let lastErr = null;
    for (const model of models()) {
      try {
        const raw = await generate(model, body);
        const res = parseReply(raw);
        remember('user', image ? userText + ' (в этот момент ты смотрел в камеру)' : userText);
        remember('model', '[' + res.emotion + '] ' + res.text);
        return res;
      } catch (e) {
        lastErr = e;
        // неверный ключ или запрет по региону: другие модели не помогут
        if (e.status === 401 || e.status === 403) break;
        if (e.status === 400 && /api key/i.test(e.message)) break;
      }
    }
    throw lastErr || new Error('Нет ответа');
  }

  function explain(err) {
    const m = (err && err.message) || '';
    if (err && err.status === 429) return 'Похоже, на сегодня бесплатный лимит умных ответов закончился. Пока поболтаю попроще, а завтра снова буду умным!';
    if (/location|region|country|not supported/i.test(m)) return 'Google не пускает меня из этой страны. Включи VPN, и я снова стану умным. А пока поболтаю попроще.';
    if ((err && (err.status === 400 || err.status === 401 || err.status === 403)) && /key|permission|denied/i.test(m)) return 'Кажется, ключ не подходит. Проверь его в настройках ⚙️. А пока поболтаю попроще.';
    if (err instanceof TypeError || /fetch|network|load failed/i.test(m)) return 'Не могу достучаться до интернета. Пока поболтаю попроще.';
    return 'Что-то у меня в голове запуталось (' + m.slice(0, 80) + '). Пока отвечу попроще.';
  }

  window.LouisAI = { hasKey, setup, ask, forget, explain, models, key };
})();
