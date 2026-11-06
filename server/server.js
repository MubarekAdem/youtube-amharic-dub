import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as addis from './addis.js';

const PORT = process.env.PORT || 8787;
const TOKEN = process.env.APP_TOKEN || 'dev-token';
await fs.mkdir('.cache', { recursive: true });

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const inflight = new Map();
async function cached(key, fn) {
  const p = `.cache/${hash(key)}.json`;
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch {}
  if (inflight.has(key)) return await inflight.get(key);
  const prom = (async () => {
    try {
      const v = await fn();
      await fs.writeFile(p, JSON.stringify(v));
      return v;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, prom);
  return await prom;
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\[(?:music|applause|laughter|cheering|screaming|sigh|groan|snicker)\]/gi, '')
    .replace(/\((?:music|applause|laughter|cheering|screaming|sigh|groan|snicker)\)/gi, '')
    .replace(/^\[?(?:\d+:)?\d+:\d+\]?\s*[-:–—]?\s*/i, '')
    .replace(/^(?:\d+\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)\s*(?:,|and)?\s*)+\.?\s*[-:–—]?\s*/i, '')
    .replace(/\[(?:\d+:)?\d+:\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

http.createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type,x-token');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.headers['x-token'] !== TOKEN) return res.writeHead(401).end('unauthorized');
  let body = '';
  for await (const c of req) body += c;
  try {
    const b = JSON.parse(body || '{}');
    const text = cleanText(b.text);
    let out;
    if (req.url === '/api/voices') {
      out = await cached('catalog:voices', () => addis.getVoices());
    } else if (req.url === '/api/translate') {
      if (!text) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: '' }));
      out = await cached('tr:' + text, async () => ({ text: await addis.translate(text, b.source) }));
    } else if (req.url === '/api/tts') {
      if (!text) return res.writeHead(400).end('empty text');
      const voice = b.voice_id || process.env.ADDIS_VOICE_ID || 'am-tewodros';
      out = await cached('tts:' + voice + ':' + text, () => addis.tts(text, voice));
    } else {
      return res.writeHead(404).end();
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  } catch (e) {
    console.error(e);
    res.writeHead(500).end(String(e.message || e));
  }
}).listen(PORT, () => console.log('listening on', PORT));
