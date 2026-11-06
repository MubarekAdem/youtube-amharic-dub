// Relays requests to YOUR backend (keeps API keys off the client).
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  // Prevent Chrome MV3 service worker from terminating during long fetches (resets 30s idle timer)
  const keepAlive = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 15000);

  (async () => {
    const { backend, token } = await chrome.storage.sync.get({
      backend: 'http://localhost:8787',
      token: 'wccevhbebvubevbjsvuebvjebybeuvbeuvbejbveu',
    });
    const r = await fetch(backend + msg.path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-token': token },
      body: JSON.stringify(msg.body),
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    send({ ok: true, data: await r.json() });
  })()
    .catch((e) => send({ ok: false, error: String(e.message || e) }))
    .finally(() => clearInterval(keepAlive));

  return true; // async response
});
