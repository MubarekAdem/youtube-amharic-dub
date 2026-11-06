// Calls ONE Addis TTS endpoint directly (no retries) and shows exactly what comes back.
//   node --env-file=.env raw-tts.js legacy     (older engine, /api/v1/audio)
//   node --env-file=.env raw-tts.js voices2    (Voices 2, /api/v1/voice/generations)
import fs from 'node:fs/promises';

const mode = process.argv[2] || 'legacy';
const BASE = process.env.ADDIS_BASE_URL, KEY = process.env.ADDIS_API_KEY;
const text = 'ሰላም፣ ይህ የሙከራ ድምፅ ነው።';
const req = mode === 'voices2'
  ? { path: '/api/v1/voice/generations', body: { text, voice_id: process.env.ADDIS_VOICE_ID || 'am-hamen', language: 'am', output_format: 'mp3_44100', client_request_id: crypto.randomUUID() } }
  : { path: '/api/v1/audio', body: { text, language: 'am' } };

console.log(`Calling ${mode}: POST ${BASE}${req.path}   (waits up to 170s, no retries)`);
const t0 = Date.now();
const beat = setInterval(() => console.log(`  ...still waiting ${Math.round((Date.now() - t0) / 1000)}s`), 10000);
try {
  const r = await fetch(BASE + req.path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY },
    body: JSON.stringify(req.body),
    signal: AbortSignal.timeout(170000),
  });
  const type = r.headers.get('content-type') || '';
  console.log(`HTTP ${r.status} after ${((Date.now() - t0) / 1000).toFixed(1)}s   content-type: ${type}`);
  if (type.startsWith('audio/')) {
    const buf = Buffer.from(await r.arrayBuffer());
    await fs.writeFile('raw-test.' + (type.includes('wav') ? 'wav' : 'mp3'), buf);
    console.log(`audio received: ${buf.length} bytes -> saved raw-test file (play it)`);
  } else {
    console.log('reply (first 400 chars):', (await r.text()).slice(0, 400));
  }
} catch (e) {
  console.log(`FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, e.cause?.code || e.name, '-', e.message);
}
clearInterval(beat);
process.exit(0);