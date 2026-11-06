// Runs in the PAGE world so it can read YouTube's player data.
window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.type !== 'AMDUB_REQ') return;
  const pr = document.getElementById('movie_player')?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  window.postMessage({
    type: 'AMDUB_TRACKS',
    videoId: pr?.videoDetails?.videoId,
    tracks: tracks.map((t) => ({ url: t.baseUrl, lang: t.languageCode, asr: t.kind === 'asr' })),
  }, '*');
});

// Fallback: same data as YouTube's "Show transcript" panel (works when timedtext URLs are blocked).
async function innertube(path, body) {
  const key = window.ytcfg?.get?.('INNERTUBE_API_KEY');
  const context = window.ytcfg?.get?.('INNERTUBE_CONTEXT');
  const r = await fetch(`/youtubei/v1/${path}?key=${key}&prettyPrint=false`, {
    method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context, ...body }),
  });
  if (!r.ok) throw new Error(`${path} ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
function findParams(o) {
  if (!o || typeof o !== 'object') return null;
  if (o.getTranscriptEndpoint?.params) return o.getTranscriptEndpoint.params;
  for (const k in o) { const p = findParams(o[k]); if (p) return p; }
  return null;
}
async function getTranscript(videoId) {
  const params = findParams(await innertube('next', { videoId }));
  if (!params) throw new Error('this video has no transcript');
  const t = await innertube('get_transcript', { params });
  const events = [];
  (function walk(o) {
    if (!o || typeof o !== 'object') return;
    const s = o.transcriptSegmentRenderer;
    if (s) {
      events.push({ tStartMs: +s.startMs, dDurationMs: +s.endMs - +s.startMs, segs: [{ utf8: (s.snippet?.runs || []).map((r) => r.text).join('') }] });
      return;
    }
    for (const k in o) walk(o[k]);
  })(t);
  if (!events.length) throw new Error('transcript was empty');
  return events;
}
window.addEventListener('message', async (e) => {
  if (e.source !== window || e.data?.type !== 'AMDUB_TRANSCRIPT') return;
  try {
    window.postMessage({ type: 'AMDUB_TRANSCRIPT_RES', events: await getTranscript(e.data.videoId) }, '*');
  } catch (err) {
    window.postMessage({ type: 'AMDUB_TRANSCRIPT_RES', error: String(err.message || err) }, '*');
  }
});
