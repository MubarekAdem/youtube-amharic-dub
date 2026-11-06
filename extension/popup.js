const $ = (id) => document.getElementById(id);

let currentMode = 'amharic';

// Load stored settings
async function init() {
  const c = await chrome.storage.sync.get({
    enabled: true,
    backend: 'http://localhost:8787',
    token: 'wccevhbebvubevbjsvuebvjebybeuvbeuvbejbveu',
    audioMode: 'amharic',
    duckVol: 0.12,
    voiceId: 'am-tewodros',
  });

  $('enabled').checked = Boolean(c.enabled);
  $('backend').value = c.backend || 'http://localhost:8787';
  $('token').value = c.token || '';
  $('voice-id').value = c.voiceId || 'am-tewodros';

  const volPercent = Math.round((c.duckVol ?? 0.12) * 100);
  $('duck-vol').value = volPercent;
  $('duck-val-txt').textContent = volPercent + '%';

  setModeUI(c.audioMode || 'amharic');
  checkServerHealth(c.backend, c.token);
}

// Mode UI Switcher
function setModeUI(mode) {
  currentMode = mode;
  if (mode === 'amharic') {
    $('btn-mode-amh').className = 'seg-btn amh active';
    $('btn-mode-orig').className = 'seg-btn orig';
  } else {
    $('btn-mode-amh').className = 'seg-btn amh';
    $('btn-mode-orig').className = 'seg-btn orig active';
  }
}

$('btn-mode-amh').onclick = () => {
  setModeUI('amharic');
  chrome.storage.sync.set({ audioMode: 'amharic' });
  showBanner('Active audio track: አማርኛ Dub', 'success', 2000);
};

$('btn-mode-orig').onclick = () => {
  setModeUI('original');
  chrome.storage.sync.set({ audioMode: 'original' });
  showBanner('Active audio track: Original Audio', 'success', 2000);
};

// Duck Volume Slider
$('duck-vol').oninput = (e) => {
  $('duck-val-txt').textContent = e.target.value + '%';
};

// Toggle Token Visibility
$('toggle-token-vis').onclick = () => {
  const input = $('token');
  if (input.type === 'password') {
    input.type = 'text';
  } else {
    input.type = 'password';
  }
};

// Show feedback banner
let bannerTimer = null;
function showBanner(text, type, duration = 3000) {
  const b = $('feedback');
  const icon = $('feedback-icon');
  const txt = $('feedback-text');

  clearTimeout(bannerTimer);
  b.className = 'feedback-banner ' + type;
  txt.textContent = text;

  if (type === 'success') icon.textContent = '✓';
  else if (type === 'error') icon.textContent = '✕';
  else if (type === 'testing') icon.textContent = '●';

  b.style.display = 'flex';

  if (duration > 0) {
    bannerTimer = setTimeout(() => {
      b.style.display = 'none';
    }, duration);
  }
}

// Check Server Health
async function checkServerHealth(url, token) {
  const statusEl = $('server-status');
  const statusTxt = $('status-text');
  const backend = (url || $('backend').value || '').replace(/\/$/, '');
  const tok = token ?? $('token').value;

  statusEl.className = 'live-status';
  statusTxt.textContent = 'Checking...';

  try {
    const t0 = Date.now();
    const res = await fetch(backend + '/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-token': tok },
      body: JSON.stringify({ text: 'hi', source: 'en' }),
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const ms = Date.now() - t0;
      statusEl.className = 'live-status online';
      statusTxt.textContent = `Online (${ms}ms)`;
      return { ok: true, ms };
    } else {
      statusEl.className = 'live-status offline';
      statusTxt.textContent = `HTTP ${res.status}`;
      return { ok: false, error: `HTTP ${res.status}: ${await res.text()}` };
    }
  } catch (e) {
    statusEl.className = 'live-status offline';
    statusTxt.textContent = 'Offline';
    return { ok: false, error: e.message || String(e) };
  }
}

// Test Button
$('test-btn').onclick = async () => {
  const backend = $('backend').value.trim().replace(/\/$/, '');
  const token = $('token').value.trim();

  if (!backend) return showBanner('Enter backend URL first', 'error');

  showBanner('Testing connection to server...', 'testing', 0);
  const health = await checkServerHealth(backend, token);

  if (health.ok) {
    showBanner(`Connected! Server responded in ${health.ms}ms`, 'success', 3500);
  } else {
    showBanner(`Connection failed: ${health.error}`, 'error', 4000);
  }
};

// Save Settings Button
$('save-btn').onclick = async () => {
  const enabled = $('enabled').checked;
  const backend = $('backend').value.trim().replace(/\/$/, '');
  const token = $('token').value.trim();
  const duckVol = Number($('duck-vol').value) / 100;
  const voiceId = $('voice-id').value;

  await chrome.storage.sync.set({
    enabled,
    backend,
    token,
    audioMode: currentMode,
    duckVol,
    voiceId,
  });

  showBanner('Settings saved! YouTube tab will update.', 'success', 2500);
  checkServerHealth(backend, token);
};

// Auto-save toggle on master switch click
$('enabled').onchange = () => {
  chrome.storage.sync.set({ enabled: $('enabled').checked });
};

// Auto-save voice selection on change
$('voice-id').onchange = () => {
  const sel = $('voice-id');
  const label = sel.options[sel.selectedIndex].text;
  chrome.storage.sync.set({ voiceId: sel.value });
  showBanner('Voice changed to ' + label, 'success', 2500);
};

init();
