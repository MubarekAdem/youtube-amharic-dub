# Amharic Dub for YouTube: the version from when it first worked

1. `cd server`, copy `.env.example` to `.env` (or copy your existing .env), then `node --env-file=.env server.js`
2. Chrome -> chrome://extensions -> Developer mode -> Load unpacked -> select the `extension` folder
3. Popup: Backend URL http://localhost:8787, Access token = APP_TOKEN, Save
4. Open ONE YouTube tab (refresh it after loading/reloading the extension)

To silence the original audio completely, change 0.12 to 0 in extension/content.js (search for "0.12").
