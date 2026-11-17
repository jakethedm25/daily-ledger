// Optional: proves a new service worker version WAITS until the user taps "Update", and data survives it.
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(pathToFileURL(process.env.PW || '/opt/npm-tools/node_modules/playwright/index.mjs').href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-upd-'));
fs.cpSync(root, tmp, { recursive: true, filter: (s) => !s.includes('node_modules') && !s.includes('/.git') });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); const f = path.join(tmp, u.pathname === '/' ? 'index.html' : u.pathname); if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'x', 'cache-control': 'no-cache' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const btn = (n) => page.getByRole('button', { name: n, exact: true });
const ok = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('PASS', m); };
await page.goto(url); await page.waitForSelector('progress'); await btn('Continue').click(); await page.fill('#hn0', 'Move'); await btn('Continue').click(); await btn('Continue').click(); await btn('Skip for now').click(); await btn('Start').click(); await page.waitForSelector('.row-main');
await page.locator('.row-main').first().click(); await page.waitForSelector('.row[data-status=done]');
await page.evaluate(() => window.__ledger.store.setSetting('emptyVaultExplained', true)); // skip the one-time vault explainer
await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await page.waitForSelector('.row-main');
const caches1 = await page.evaluate(() => caches.keys()); ok(caches1.join() === 'daily-ledger-v1.0.0', `first install cached ${caches1}`);
// ship a new version
fs.writeFileSync(path.join(tmp, 'sw.js'), fs.readFileSync(path.join(tmp, 'sw.js'), 'utf8').replace("const VERSION = '1.0.0'", "const VERSION = '1.0.1'"));
fs.writeFileSync(path.join(tmp, 'css/app.css'), fs.readFileSync(path.join(tmp, 'css/app.css'), 'utf8') + '\n/* v1.0.1 */\n');
await page.getByRole('link', { name: 'Settings' }).click(); await page.getByRole('button', { name: 'Check for update' }).click();
await page.waitForSelector('text=An update is ready', { timeout: 8000 }).catch(() => {});
const waiting = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { waiting: !!r.waiting, active: !!r.active }; });
ok(waiting.waiting && waiting.active, 'new version is installed and WAITING (old one still active, not swapped silently)');
const cachesMid = await page.evaluate(() => caches.keys()); ok(cachesMid.length === 2, `both caches present while waiting: ${cachesMid}`);
const controllerBefore = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL);
await page.reload(); await page.waitForSelector('text=Update now');
const stillWaiting = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting); ok(stillWaiting, 'a plain reload does not activate the update');
await Promise.all([page.waitForNavigation({ waitUntil: 'load' }).catch(() => {}), page.getByRole('button', { name: 'Update now' }).click()]);
await page.waitForTimeout(800); await page.goto(url + '#today'); await page.waitForSelector('.row-main');
const after = await page.evaluate(async () => ({ keys: await caches.keys(), waiting: !!(await navigator.serviceWorker.getRegistration()).waiting }));
ok(after.keys.join() === 'daily-ledger-v1.0.1' && !after.waiting, `after tapping Update: only ${after.keys} remains`);
ok((await page.locator('.row[data-status=done]').count()) === 1, 'data survived the update');
ok(errs.length === 0, `no page errors ${errs.join()}`);
await browser.close(); server.close();
