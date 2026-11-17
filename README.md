# Daily Ledger

A private, offline, phone-first habit and motivation app for one person. No accounts, no servers, no network calls after the first load. Everything lives in your phone's browser storage (IndexedDB) and leaves only when you export it.

Plain ES modules. No build step, no framework, no npm dependencies, no CDN.

## Install (do this before entering any data)

iPhone (Safari):
1. Open the deployed URL in Safari.
2. Share → **Add to Home Screen**.
3. Open it **from the Home Screen icon** and do the first-run setup there.

Why before data: an iPhone Home Screen app keeps its own storage, separate from Safari. Data entered in a Safari tab will not be in the installed app.

Android (Chrome): menu → **Install app**, then open it from the icon.

Home-screen widgets are not possible for web apps on iOS. The icon is your launch point.

## Deploy (static HTTPS)

The folder is the site. Upload it as-is to any static host that serves HTTPS (GitHub Pages, Netlify, Cloudflare Pages, any web server). Service workers need HTTPS (or `localhost`).

Requirements:
- Serve `index.html` at the root. Subfolder hosting works because all paths are relative.
- Serve `manifest.webmanifest` as `application/manifest+json` (most hosts already do).
- Do not add analytics, fonts or scripts. The CSP is `default-src 'self'` and will block them.

Local try-out:

```
python3 -m http.server 8080      # then open http://localhost:8080
```

## Update flow

The app never swaps versions behind your back.

1. Change files and bump the version in **both** `sw.js` (`VERSION`) and `js/config.js` (`APP_VERSION`). The cache name is `daily-ledger-v<VERSION>`.
2. Deploy.
3. On the phone: **Settings → App → Check for update**. When it says an update is ready, tap **Update now**. The page reloads on the new version. Your data is untouched.

A plain reload does not activate a waiting update. If you skip this, the old version keeps working.

## Backups

Settings → **Export backup** produces one JSON file (Share sheet on iPhone, download elsewhere). **Import** supports replace or merge. A banner nudges once a day when your last export is over 7 days old. Export before any update and before clearing browser data.

`config.json` (settings only, no entries) can be exported and imported separately. Changing locked settings asks for confirmation.

## Tests

```
node tests/engine.test.js                 # 56 logic tests, no dependencies
node tests/browser.acceptance.mjs         # 21 acceptance tests (needs Playwright + Chrome)
node tests/browser.update-flow.mjs        # service worker update flow
```

The browser tests default to `/usr/bin/google-chrome`. Override with `CHROME=` and `PW=` (path to Playwright's `index.mjs`).

## Files

```
index.html  manifest.webmanifest  sw.js
css/app.css
js/  boot.js main.js engine.js config.js store.js io.js metrics.js copy.js dom.js
js/ui/  today.js vault.js setup.js settings.js setback.js reflect.js
config/  default.json interview.json
icons/  tests/
```

`config/*.json` mirror the constants in `js/config.js`; a test fails if they drift.

## Known limits

- Web notifications are best-effort (only while the app is open or recently active). The daily **.ics reminder** is the reliable option.
- Browsers can evict storage under pressure. The app requests persistent storage after your first check-in, and the backup nudge is the safety net.
- Real-iPhone behaviour (install, Share sheet, storage) is not covered by the automated tests. Check it yourself on day 1.
