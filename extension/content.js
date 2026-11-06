(() => {
  if (window.__amdub) return;
  window.__amdub = true;

  const CONCURRENCY = 1;   // Addis AI processes 1 TTS generation at a time
  const AHEAD = 120;       // seconds to prefetch ahead of playhead
  const MAX_SPEEDUP = 1.35;
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let st = fresh();

  function fresh() {
    return {
      token: 0,
      seekToken: 0,
      segs: [],
      busy: 0,
      last: 0,
      cur: null,
      origVol: null,
      on: false,
      timer: null,
      lang: 'en',
      lastErr: '',
      lastBadge: 0,
      ducked: false,
      lastSpeakTime: 0,
      mode: 'amharic',    // 'amharic' | 'original'
      duckVol: 0.12,
      collapsed: false,
      voiceId: 'am-tewodros',
      vListeners: [],
    };
  }

  // ---- bridge to page world ----
  const inj = document.createElement('script');
  inj.src = chrome.runtime.getURL('page-bridge.js');
  (document.head || document.documentElement).appendChild(inj);

  function getTracks() {
    return new Promise((res) => {
      const h = (e) => {
        if (e.source === window && e.data?.type === 'AMDUB_TRACKS') { window.removeEventListener('message', h); res(e.data); }
      };
      window.addEventListener('message', h);
      window.postMessage({ type: 'AMDUB_REQ' }, '*');
      setTimeout(() => { window.removeEventListener('message', h); res({ tracks: [] }); }, 2000);
    });
  }

  async function api(path, body) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await chrome.runtime.sendMessage({ path, body });
        if (!r?.ok) throw new Error(r?.error || 'no response');
        return r.data;
      } catch (err) {
        const msg = String(err?.message || err);
        if (attempt === 0 && (msg.includes('message channel closed') || msg.includes('asynchronous response'))) {
          await sleep(600);
          continue;
        }
        throw err;
      }
    }
  }

  // ---- Styles Injection for On-Page Switcher ----
  function injectStyles() {
    if ($('#amdub-styles')) return;
    const style = document.createElement('style');
    style.id = 'amdub-styles';
    style.textContent = `
      #amdub-dock {
        position: fixed;
        left: 20px;
        bottom: 24px;
        z-index: 9999999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Ethiopic", sans-serif;
        box-sizing: border-box;
        user-select: none;
        -webkit-user-select: none;
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
      }
      #amdub-dock * {
        box-sizing: border-box;
      }

      /* Expanded Dock */
      .amdub-dock-expanded {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(13, 17, 28, 0.94);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        padding: 5px 8px 5px 10px;
        border-radius: 9999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55), 0 2px 8px rgba(0, 0, 0, 0.35);
      }

      .amdub-brand-area {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .amdub-logo-badge {
        background: linear-gradient(135deg, #059669 0%, #10b981 100%);
        color: #ffffff;
        font-size: 11px;
        font-weight: 700;
        padding: 3px 6px;
        border-radius: 6px;
        box-shadow: 0 2px 6px rgba(16, 185, 129, 0.35);
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .amdub-live-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        transition: background-color 0.2s, box-shadow 0.2s;
      }
      .amdub-live-dot.active {
        background: #10b981;
        box-shadow: 0 0 8px #10b981;
      }
      .amdub-live-dot.idle {
        background: #3b82f6;
        box-shadow: 0 0 6px #3b82f6;
      }

      /* Switch Track */
      .amdub-switch-track {
        display: flex;
        align-items: center;
        background: rgba(0, 0, 0, 0.45);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 9999px;
        padding: 3px;
        gap: 2px;
      }

      .amdub-tab {
        border: none;
        background: transparent;
        color: #94a3b8;
        font-size: 11.5px;
        font-weight: 500;
        padding: 4px 10px;
        border-radius: 9999px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 5px;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .amdub-tab:hover {
        color: #ffffff;
      }

      .amdub-tab.active-amh {
        background: #059669;
        color: #ffffff;
        font-weight: 600;
        box-shadow: 0 2px 10px rgba(16, 185, 129, 0.45);
      }

      .amdub-tab.active-orig {
        background: #2563eb;
        color: #ffffff;
        font-weight: 600;
        box-shadow: 0 2px 10px rgba(37, 99, 235, 0.45);
      }

      .amdub-tab-icon {
        font-size: 11px;
      }

      /* Info Pill */
      .amdub-info-pill {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.06);
        padding: 4px 9px;
        border-radius: 9999px;
        max-width: 175px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .amdub-info-text {
        font-size: 11px;
        color: #cbd5e1;
        font-weight: 500;
      }

      .amdub-mini-btn {
        border: none;
        background: transparent;
        color: #64748b;
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.2s, background-color 0.2s;
      }
      .amdub-mini-btn:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.1);
      }

      /* Collapsed Pill */
      .amdub-dock-collapsed {
        background: transparent;
      }

      .amdub-pill-btn {
        display: flex;
        align-items: center;
        gap: 7px;
        background: rgba(13, 17, 28, 0.94);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        padding: 5px 12px 5px 7px;
        border-radius: 9999px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        cursor: pointer;
        transition: transform 0.2s, border-color 0.2s;
      }
      .amdub-pill-btn:hover {
        transform: translateY(-2px);
        border-color: rgba(16, 185, 129, 0.4);
      }

      .amdub-collapsed-label {
        font-size: 11.5px;
        font-weight: 600;
        color: #e2e8f0;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---- Audio Switcher Widget ----
  function renderWidget(customMsg) {
    if (!st.on && !customMsg) {
      $('#amdub-dock')?.remove();
      return;
    }

    injectStyles();
    let dock = $('#amdub-dock');
    if (!dock) {
      dock = document.createElement('div');
      dock.id = 'amdub-dock';
      document.body.appendChild(dock);
    }

    const readyCount = st.segs.filter((s) => s.state === 'ready').length;
    const loadingCount = st.segs.filter((s) => s.state === 'loading').length;
    const errCount = st.segs.filter((s) => s.state === 'error').length;
    const total = st.segs.length;

    let statusText = customMsg;
    if (!statusText) {
      if (st.mode === 'amharic') {
        statusText = `${readyCount}/${total} ready${loadingCount ? ` (${loadingCount} buff)` : ''}${errCount ? ` · ${errCount} err` : ''}`;
      } else {
        statusText = `Original (${readyCount} ready)`;
      }
    }

    if (st.collapsed) {
      dock.className = 'amdub-dock-collapsed';
      dock.innerHTML = `
        <div class="amdub-pill-btn" id="amdub-expand-btn" title="Click to open Amharic Dub audio switcher">
          <span class="amdub-logo-badge">አማ</span>
          <span class="amdub-live-dot ${st.mode === 'amharic' ? 'active' : 'idle'}"></span>
          <span class="amdub-collapsed-label">${st.mode === 'amharic' ? 'Dubbing' : 'Original'}</span>
        </div>
      `;
      dock.querySelector('#amdub-expand-btn').onclick = () => {
        st.collapsed = false;
        renderWidget();
      };
      return;
    }

    dock.className = 'amdub-dock-expanded';
    dock.innerHTML = `
      <div class="amdub-brand-area" title="Amharic Dub for YouTube">
        <span class="amdub-logo-badge">አማ</span>
        <span class="amdub-live-dot ${st.mode === 'amharic' ? 'active' : 'idle'}"></span>
      </div>

      <div class="amdub-switch-track">
        <button type="button" id="amdub-btn-amh" class="amdub-tab ${st.mode === 'amharic' ? 'active-amh' : ''}">
          <span class="amdub-tab-icon">🔊</span>
          <span class="amdub-tab-txt">አማርኛ Dub</span>
        </button>
        <button type="button" id="amdub-btn-orig" class="amdub-tab ${st.mode === 'original' ? 'active-orig' : ''}">
          <span class="amdub-tab-icon">🔈</span>
          <span class="amdub-tab-txt">Original</span>
        </button>
      </div>

      <div class="amdub-info-pill" title="${st.lastErr ? st.lastErr : statusText}">
        <span class="amdub-info-text">${statusText}</span>
      </div>

      <button type="button" id="amdub-collapse-btn" class="amdub-mini-btn" title="Minimize switcher">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
    `;

    dock.querySelector('#amdub-btn-amh').onclick = () => setAudioMode('amharic');
    dock.querySelector('#amdub-btn-orig').onclick = () => setAudioMode('original');
    dock.querySelector('#amdub-collapse-btn').onclick = () => {
      st.collapsed = true;
      renderWidget();
    };
  }

  function setAudioMode(mode) {
    if (st.mode === mode) return;
    st.mode = mode;
    chrome.storage.sync.set({ audioMode: mode });
    const v = $('video');
    if (mode === 'original') {
      stopCur();
      if (v && st.origVol != null) v.volume = st.origVol;
      st.ducked = false;
    } else {
      updateDucking(v);
      if (v && !v.paused) {
        const curT = v.currentTime;
        const active = st.segs.find((s) => s.start <= curT && curT < s.end);
        if (active && active.state === 'ready') {
          play(active, v, curT);
        }
      }
    }
    renderWidget();
  }

  // ---- clean captions (strip timestamps, accessibility labels, sound tags) ----
  function cleanText(text) {
    if (!text) return '';
    return text
      // Remove sound tags like [Music], [Applause], (laughter)
      .replace(/\[(?:music|applause|laughter|cheering|screaming|sigh|groan|snicker)\]/gi, '')
      .replace(/\((?:music|applause|laughter|cheering|screaming|sigh|groan|snicker)\)/gi, '')
      // Remove leading timestamp like 0:13, 03:11, 1:02:15, [0:13], (0:13)
      .replace(/^\[?(?:\d+:)?\d+:\d+\]?\s*[-:–—]?\s*/i, '')
      // Remove accessibility spoken timestamp like '3 minutes, 11 seconds', '13 seconds', '0 seconds'
      .replace(/^(?:\d+\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)\s*(?:,|and)?\s*)+\.?\s*[-:–—]?\s*/i, '')
      // Also remove any embedded bracketed timestamps like [00:12:34]
      .replace(/\[(?:\d+:)?\d+:\d+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ---- captions -> sentence-ish segments ----
  function merge(events) {
    const out = [];
    let cur = null;
    for (const e of events) {
      if (!e.segs) continue;
      const raw = e.segs.map((s) => s.utf8).join('').replace(/\s+/g, ' ').trim();
      const text = cleanText(raw);
      if (!text) continue;
      const s = e.tStartMs / 1000, en = (e.tStartMs + (e.dDurationMs || 2000)) / 1000;
      if (cur && (s - cur.end > 1.5 || cur.text.length > 200 || en - cur.start > 14 || /[.!?…]$/.test(cur.text))) { out.push(cur); cur = null; }
      if (cur) { cur.text += ' ' + text; cur.end = en; }
      else cur = { start: s, end: en, text, state: 'new', played: false };
    }
    if (cur) out.push(cur);
    return out;
  }

  // Last resort: open YouTube's own transcript panel and read the rows on screen.
  async function scrapePanel() {
    const rows = () => document.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model');
    const findBtn = () =>
      document.querySelector('ytd-video-description-transcript-section-renderer button')
      || [...document.querySelectorAll('button')].find((x) => /transcript/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.textContent || '')));
    scrapePanel.dbg = '';
    if (!rows().length) {
      let btn = null;
      for (let i = 0; i < 12 && !btn; i++) { // the page may still be drawing: retry ~10s
        document.querySelector('#description-inline-expander #expand, ytd-text-inline-expander #expand, #description-inner #expand')?.click();
        await sleep(800);
        btn = findBtn();
      }
      if (!btn) { scrapePanel.dbg = 'no "Show transcript" button found (video may have no transcript)'; return []; }
      btn.click();
      for (let i = 0; i < 40 && !rows().length; i++) await sleep(250);
      if (!rows().length) { scrapePanel.dbg = 'clicked transcript button but no rows appeared'; return []; }
    }
    const parsed = [];
    for (const el of rows()) {
      const timeEl = el.querySelector('.segment-timestamp, [class*="timestamp"]');
      const timeStr = (timeEl?.innerText || el.innerText.split('\n')[0] || '').trim();
      const m = timeStr.match(/^(?:(\d+):)?(\d+):(\d+)$/);
      if (!m) continue;
      const start = (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3];

      const textEl = el.querySelector('.segment-text, [class*="segment-text"], [class*="snippet"]');
      let rawText = '';
      if (textEl && textEl !== timeEl) {
        rawText = textEl.innerText.trim();
      } else {
        const lines = el.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
        const contentLines = lines.filter((l) =>
          !/^(?:(?:\d+:)?\d+:)?\d+$/.test(l) &&
          !/^(?:\d+\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)\s*(?:,|and)?\s*)+\.?$/i.test(l)
        );
        rawText = contentLines.join(' ');
      }
      const text = cleanText(rawText);
      if (!text) continue;
      parsed.push({ start, text });
    }
    try { document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"] #visibility-button button')?.click(); } catch {}
    return parsed.map((p, i) => ({
      tStartMs: p.start * 1000,
      dDurationMs: ((parsed[i + 1]?.start ?? p.start + 3) - p.start) * 1000,
      segs: [{ utf8: p.text }],
    }));
  }

  // Try the direct caption URL first; YouTube often blocks it, so fall back to the transcript API.
  async function getEvents(t, videoId) {
    if (t) {
      try {
        const txt = await (await fetch(t.url + '&fmt=json3')).text();
        const ev = txt ? JSON.parse(txt).events : null;
        if (ev?.length) return { events: ev };
      } catch (e) { console.warn('[amdub] timedtext blocked, trying transcript API', e); }
    }
    const api = await new Promise((res) => {
      const done = (v) => { window.removeEventListener('message', h); res(v); };
      const h = (e) => { if (e.source === window && e.data?.type === 'AMDUB_TRANSCRIPT_RES') done(e.data); };
      window.addEventListener('message', h);
      window.postMessage({ type: 'AMDUB_TRANSCRIPT', videoId }, '*');
      setTimeout(() => done({ error: 'timeout' }), 15000);
    });
    if (api.events) return api;
    console.warn('[amdub] transcript API failed:', api.error, '-> trying on-page transcript panel');
    const scraped = await scrapePanel();
    return scraped.length ? { events: scraped } : { error: api.error + ' | panel: ' + (scrapePanel.dbg || 'no rows') };
  }

  // ---- Video Event Hooks for 0ms Sync & Seeking ----
  function detachVideoListeners() {
    if (st.vListeners) {
      for (const [el, evt, fn] of st.vListeners) {
        try { el.removeEventListener(evt, fn); } catch {}
      }
      st.vListeners = [];
    }
  }

  function attachVideoListeners(v) {
    detachVideoListeners();
    if (!v) return;

    const onSeekStart = () => {
      stopCur();
      st.seekToken++;
      const curT = v.currentTime;
      for (const s of st.segs) {
        s.played = s.end <= curT;
      }
      updateDucking(v);
    };

    const onSeekEnd = () => {
      const curT = v.currentTime;
      for (const s of st.segs) {
        s.played = s.end <= curT;
      }
      if (st.on && st.mode === 'amharic' && !v.paused) {
        const active = st.segs.find((s) => s.start <= curT && curT < s.end);
        if (active && active.state === 'ready') {
          play(active, v, curT);
        }
      }
      processPrefetchQueue(curT);
    };

    const onPause = () => {
      if (st.cur?.audio && !st.cur.audio.paused) {
        st.cur.audio.pause();
      }
      updateDucking(v);
    };

    const onPlay = () => {
      const curT = v.currentTime;
      if (st.on && st.mode === 'amharic') {
        if (st.cur?.audio && st.cur.audio.paused && !st.cur.audio.ended) {
          st.cur.audio.play().catch(() => {});
        } else {
          const active = st.segs.find((s) => s.start <= curT && curT < s.end);
          if (active && active.state === 'ready') {
            play(active, v, curT);
          }
        }
      }
      processPrefetchQueue(curT);
    };

    const onRateChange = () => {
      if (st.cur?.audio) {
        st.cur.audio.playbackRate = (st.cur.fit || 1) * v.playbackRate;
      }
    };

    const listeners = [
      [v, 'seeking', onSeekStart],
      [v, 'seeked', onSeekEnd],
      [v, 'pause', onPause],
      [v, 'play', onPlay],
      [v, 'ratechange', onRateChange],
    ];

    for (const [el, evt, fn] of listeners) {
      el.addEventListener(evt, fn);
      st.vListeners.push([el, evt, fn]);
    }
  }

  // ---- Dynamic Ducking Engine ----
  function updateDucking(v) {
    if (!v) return;
    if (st.mode !== 'amharic') {
      if (st.ducked) {
        st.ducked = false;
        if (st.origVol != null) v.volume = st.origVol;
      }
      return;
    }

    const isSpeaking = Boolean(st.cur && !st.cur.audio.paused && !st.cur.audio.ended);
    if (isSpeaking) {
      st.lastSpeakTime = Date.now();
    }

    const shouldDuck = isSpeaking || (Date.now() - st.lastSpeakTime < 600);

    if (shouldDuck) {
      if (!st.ducked) {
        st.ducked = true;
        if (st.origVol == null) st.origVol = v.volume;
        v.volume = Math.min(st.origVol, st.duckVol || 0.12);
      }
    } else {
      if (st.ducked) {
        st.ducked = false;
        if (st.origVol != null) v.volume = st.origVol;
      }
    }
  }

  // ---- Strict Chronological Priority Queue ----
  function getPrefetchQueue(t) {
    const candidates = [];
    for (const s of st.segs) {
      const canRetry = s.state === 'error' && (s.tries || 0) < 3 && Date.now() - (s.errAt || 0) > 4000;
      if ((s.state === 'new' || canRetry) && s.end >= t && s.start <= t + AHEAD) {
        candidates.push(s);
      }
    }

    candidates.sort((a, b) => {
      const aActive = (a.start <= t && t < a.end);
      const bActive = (b.start <= t && t < b.end);
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;

      const aDist = a.start >= t ? (a.start - t) : (1000 + (t - a.start));
      const bDist = b.start >= t ? (b.start - t) : (1000 + (t - b.start));
      return aDist - bDist;
    });

    return candidates;
  }

  function processPrefetchQueue(t) {
    if (st.busy >= CONCURRENCY) return;
    const queue = getPrefetchQueue(t);
    for (const s of queue) {
      if (st.busy >= CONCURRENCY) break;
      st.busy++;
      prep(s, st.token).finally(() => {
        st.busy--;
        const curV = $('video');
        if (curV) processPrefetchQueue(curV.currentTime);
      });
    }
  }

  async function load() {
    stop();
    if (location.pathname !== '/watch') return;
    const { enabled, audioMode, duckVol, voiceId } = await chrome.storage.sync.get({
      enabled: true,
      audioMode: 'amharic',
      duckVol: 0.12,
      voiceId: 'am-tewodros',
    });
    if (!enabled) return;
    st.mode = audioMode || 'amharic';
    st.duckVol = Number(duckVol) || 0.12;
    st.voiceId = voiceId || 'am-tewodros';

    const me = ++st.token;
    renderWidget('Finding captions...');
    let info = { tracks: [] };
    for (let i = 0; i < 5 && !info.tracks.length; i++) { info = await getTracks(); if (!info.tracks.length) await sleep(1000); }
    if (me !== st.token) return;
    const t = info.tracks.find((x) => !x.asr && x.lang.startsWith('en')) || info.tracks.find((x) => !x.asr) || info.tracks.find((x) => x.lang.startsWith('en')) || info.tracks[0];
    if (t?.lang.startsWith('am')) return renderWidget('Video is already Amharic');
    const videoId = info.videoId || new URLSearchParams(location.search).get('v');
    const res = await getEvents(t, videoId);
    if (me !== st.token) return;
    if (!res.events) { console.warn('[amdub] no captions:', res.error); return renderWidget('No captions: ' + res.error); }
    st.segs = merge(res.events);
    if (!st.segs.length) return renderWidget('Captions were empty');
    st.lang = t?.lang || 'auto'; st.on = true;
    renderWidget(`Dubbing ${st.segs.length} segs`);

    const v = $('video');
    if (v) {
      st.origVol = v.volume;
      attachVideoListeners(v);
    }
    st.timer = setInterval(tick, 100);
    if (v) processPrefetchQueue(v.currentTime);
  }

  function stopCur() {
    if (st.cur) {
      try {
        st.cur.audio.pause();
        st.cur.audio.onended = null;
      } catch {}
      st.cur = null;
    }
  }

  function stop() {
    clearInterval(st.timer);
    detachVideoListeners();
    stopCur();
    const v = $('video');
    if (v && st.origVol != null) v.volume = st.origVol;
    const token = st.token;
    st = fresh();
    st.token = token + 1;
    $('#amdub-dock')?.remove();
  }

  // ---- translate + TTS one segment ----
  async function prep(seg, token) {
    seg.state = 'loading';
    try {
      const tr = await api('/api/translate', { text: seg.text, source: st.lang });
      const tts = await api('/api/tts', { text: tr.text, voice_id: st.voiceId || 'am-tewodros' });
      if (token !== st.token) return;

      const a = new Audio(`data:${tts.mime};base64,${tts.audio}`);
      await new Promise((res, rej) => { a.onloadedmetadata = res; a.onerror = rej; });
      seg.audio = a;
      seg.state = 'ready';

      // LATE-ARRIVAL RECOVERY:
      // If the playhead is currently inside this segment and nothing is playing,
      // start immediately from the exact calculated offset!
      const curV = $('video');
      if (curV && !curV.paused && st.on && st.mode === 'amharic') {
        const curT = curV.currentTime;
        if (seg.start <= curT && curT < seg.end && (!st.cur || st.cur !== seg)) {
          play(seg, curV, curT);
        }
      }
    } catch (e) {
      seg.state = 'error';
      seg.tries = (seg.tries || 0) + 1;
      seg.errAt = Date.now();
      st.lastErr = String(e.message || e).slice(0, 140);
      console.warn('[amdub]', e);
    }
  }

  function play(seg, v, targetTime) {
    stopCur();
    seg.played = true;
    st.cur = seg;

    const t = targetTime != null ? targetTime : v.currentTime;
    const avail = Math.max(0.2, seg.end - seg.start);
    const fit = Math.min(MAX_SPEEDUP, Math.max(1, seg.audio.duration / avail));
    seg.fit = fit;
    seg.audio.playbackRate = fit * v.playbackRate;

    // Calculate exact mid-segment offset
    const elapsedVideo = Math.max(0, t - seg.start);
    const audioOffset = elapsedVideo * fit;

    // If offset is past the end of the audio, clip is done for this timestamp
    if (audioOffset >= seg.audio.duration - 0.2) {
      st.cur = null;
      return;
    }

    try {
      seg.audio.currentTime = audioOffset;
    } catch {}

    seg.audio.onended = () => {
      if (st.cur === seg) {
        st.cur = null;
        updateDucking(v);
      }
    };

    seg.audio.play().then(() => {
      updateDucking(v);
    }).catch((e) => {
      st.lastErr = 'play failed: ' + e.name;
      console.warn('[amdub] play failed', e);
    });
  }

  function tick() {
    const v = $('video');
    if (!v || !st.on) return;
    const t = v.currentTime;

    // 1. Dynamic Ducking
    updateDucking(v);

    // 2. Widget UI update
    if (Date.now() - st.lastBadge > 800) {
      st.lastBadge = Date.now();
      renderWidget();
    }

    // 3. Fallback seek detection
    if (Math.abs(t - st.last) > 1.8) {
      stopCur();
      st.seekToken++;
      st.segs.forEach((s) => (s.played = s.end <= t));
      updateDucking(v);
    }
    st.last = t;

    // 4. Playback State Sync & Clock Drift Correction
    if (st.cur && st.cur.audio) {
      if (v.paused || st.mode !== 'amharic') {
        if (!st.cur.audio.paused) st.cur.audio.pause();
      } else {
        if (st.cur.audio.paused && !st.cur.audio.ended) {
          st.cur.audio.play().catch(() => {});
        }
        // Continuous lip-sync drift correction (if drifted by > 350ms)
        const expectedAudioTime = (t - st.cur.start) * (st.cur.fit || 1);
        const actualAudioTime = st.cur.audio.currentTime;
        const drift = Math.abs(actualAudioTime - expectedAudioTime);
        if (drift > 0.35 && expectedAudioTime < st.cur.audio.duration - 0.1) {
          try { st.cur.audio.currentTime = Math.max(0, expectedAudioTime); } catch {}
        }
      }
    }

    // 5. Prefetch in strict chronological priority
    processPrefetchQueue(t);

    if (v.paused || st.mode !== 'amharic') return;

    // 6. Play active segment if not already playing
    if (!st.cur) {
      const s = st.segs.find((x) => !x.played && x.start <= t && t < x.end);
      if (s && s.state === 'ready') {
        play(s, v, t);
      }
    }
  }

  window.addEventListener('yt-navigate-finish', load);
  chrome.storage.onChanged.addListener((c) => {
    if (c.enabled !== undefined) {
      if (c.enabled.newValue) load();
      else stop();
    }
    if (c.audioMode !== undefined && c.audioMode.newValue) {
      setAudioMode(c.audioMode.newValue);
    }
    if (c.duckVol !== undefined && c.duckVol.newValue != null) {
      st.duckVol = Number(c.duckVol.newValue);
      const v = $('video');
      if (v && st.ducked && st.origVol != null) {
        v.volume = Math.min(st.origVol, st.duckVol);
      }
    }
    if (c.voiceId !== undefined && c.voiceId.newValue) {
      st.voiceId = c.voiceId.newValue;
    }
  });
  load();
})();
