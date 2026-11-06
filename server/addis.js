// ALL provider-specific code lives here.

const BASE = process.env.ADDIS_BASE_URL;          // e.g. https://api.addisassistant.com
const KEY = process.env.ADDIS_API_KEY;

async function call(path, payload) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Addis ${r.status}: ${await r.text()}`);
  return r;
}

export async function translate(text, source = 'en') {
  // Option A: your own OpenAI-compatible gateway (set TRANSLATE_PROVIDER=gateway)
  if (process.env.TRANSLATE_PROVIDER === 'gateway') {
    const r = await fetch(process.env.GATEWAY_URL + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.GATEWAY_KEY },
      body: JSON.stringify({
        model: process.env.GATEWAY_MODEL,
        messages: [
          { role: 'system', content: 'Translate the user text into natural spoken Amharic (Ge\'ez script). Output only the translation.' },
          { role: 'user', content: text },
        ],
      }),
    });
    return (await r.json()).choices[0].message.content.trim();
  }
  // Option B: Addis AI chat endpoint, used as a translator via a prompt
  const prompt =
    `Translate the following ${source === 'auto' ? '' : source + ' '}text into natural spoken Amharic (Ge'ez script). ` +
    `Output ONLY the Amharic translation, with no explanations, notes or quotes.\n\n${text}`;
  const r = await call(process.env.ADDIS_TRANSLATE_PATH || '/api/v1/chat_generate', { prompt, target_language: 'am' });
  const j = await r.json();
  const out = (j.response_text || j.text || j.result || j.data?.response_text || j.data?.text || '').trim();
  if (!out) throw new Error('No translation in Addis response: ' + JSON.stringify(j).slice(0, 300));
  return out;
}

// Addis AI limits concurrency to 1 generation at a time
const MAX_TTS = Number(process.env.ADDIS_TTS_CONCURRENCY) || 1;
let active = 0;
const waiters = [];
async function limited(fn) {
  if (active >= MAX_TTS) await new Promise((r) => waiters.push(r));
  else active++;
  try { return await fn(); } finally { const next = waiters.shift(); if (next) next(); else active--; }
}

export const tts = (text, voiceId) => limited(() => ttsOnce(text, voiceId));

async function ttsOnce(rawText, voiceId) {
  const text = (rawText || '').trim().slice(0, 4000);
  if (!text) throw new Error('Empty text for TTS');
  const t0 = Date.now();
  // Addis Voices 2: POST /api/v1/voice/generations -> clip metadata + signed audio_url
  const payload = {
    text,
    voice_id: voiceId || process.env.ADDIS_VOICE_ID || 'am-tewodros',
    language: 'am',
    output_format: 'mp3_44100',
    client_request_id: crypto.randomUUID(), // reused across retries of THIS generation only
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(BASE + '/api/v1/voice/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify(payload),
    });
    // in progress / rate limited / transient: wait, then retry with the SAME client_request_id
    if ([202, 409, 429].includes(r.status) || r.status >= 500) {
      let wait = Number(r.headers.get('retry-after'));
      let isConcurrent = false;
      try {
        const body = await r.clone().json();
        if (body.error?.code === 'CONCURRENT_GENERATION_LIMIT') isConcurrent = true;
        if (!wait || isNaN(wait)) wait = Number(body.retry_after ?? body.error?.retry_after);
      } catch {}
      if (isConcurrent) {
        wait = 3;
      } else {
        wait = Math.min(wait || (2 * 1.5 ** attempt), 20);
      }
      console.warn(`[addis tts] attempt ${attempt + 1} got ${r.status}${isConcurrent ? ' (concurrent limit)' : ''}, waiting ${wait}s...`);
      await new Promise((res) => setTimeout(res, wait * 1000));
      continue;
    }
    if (!r.ok) throw new Error(`Addis TTS ${r.status}: ${await r.text()}`); // don't retry validation errors
    const j = await r.json();
    const clip = j.data ?? j.clip ?? j;
    if (clip.audio_url) { // the docs say replays may omit inline audio, so always prefer the signed URL
      const a = await fetch(clip.audio_url);
      if (!a.ok) throw new Error('Addis audio download failed ' + a.status);
      console.log(`[tts] generated in ${((Date.now() - t0) / 1000).toFixed(1)}s (${text.length} chars)`);
      return { audio: Buffer.from(await a.arrayBuffer()).toString('base64'), mime: a.headers.get('content-type')?.split(';')[0] || 'audio/mpeg' };
    }
    const inline = Object.values(clip).find((v) => typeof v === 'string' && v.startsWith('data:audio'));
    if (inline) {
      const [h, b64] = inline.split(',');
      console.log(`[tts] generated in ${((Date.now() - t0) / 1000).toFixed(1)}s (${text.length} chars)`);
      return { audio: b64, mime: h.slice(5).split(';')[0] };
    }
    throw new Error('No audio in Addis response: ' + JSON.stringify(j).slice(0, 300));
  }
  throw new Error('Addis TTS: gave up after retries');
}
