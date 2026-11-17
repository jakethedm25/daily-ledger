// Optional browser acceptance run (needs Playwright + Chrome; not part of the app).
//   node tests/browser.acceptance.mjs            -> serves the app locally and drives it at 390x844
// Env: CHROME=/path/to/chrome  PW=/path/to/playwright/index.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = process.env.PW || '/opt/npm-tools/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PW).href);
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';

// ---- static server with a request log (the log is how we prove "zero network requests") ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const log = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); log.push(url.pathname);
  let f = path.join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

const results = [];
async function ctxOf(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], ...opts });
  await ctx.addInitScript(() => { window.__persistCalls = 0; try { const o = navigator.storage.persist.bind(navigator.storage); navigator.storage.persist = () => { window.__persistCalls++; return o(); }; } catch { /* ignore */ } });
  return ctx;
}
async function pageOf(ctx) {
  const page = await ctx.newPage(); page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(`console: ${m.text()}`); });
  return page;
}
const habitsDefault = [['Move', 'Put on shoes'], ['Focus', 'One quiet minute'], ['Tidy', 'Put one thing away']];
async function setup(page, habits = habitsDefault) {
  await page.goto(URL_); await page.waitForSelector('progress');
  const btn = (n) => page.getByRole('button', { name: n, exact: true });
  await btn('Continue').click();
  for (let i = 0; i < habits.length; i++) { if (i > 0) await btn('Add another').click(); await page.fill(`#hn${i}`, habits[i][0]); await page.fill(`#hm${i}`, habits[i][1]); }
  await btn('Continue').click();
  await page.getByRole('button', { name: 'After dinner' }).click();
  await btn('Continue').click();
  await btn('Skip for now').click();
  await btn('Start').click();
  await page.waitForSelector('.row-main');
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const today = (page) => ev(page, () => window.__ledger.today());
const addDays = (page, d, n) => ev(page, async ([d, n]) => (await import('/js/engine.js')).addDays(d, n), [d, n]);
async function seed(page, { votesDaysAgo = [], habitIdx = 0, createdDaysAgo = 30, wins = 0, extra } = {}) {
  await ev(page, async ({ votesDaysAgo, habitIdx, createdDaysAgo, wins }) => {
    const L = window.__ledger, E = await import('/js/engine.js'), t = L.today();
    const hs = (await L.store.all('habits')).sort((a, b) => a.order - b.order);
    for (const h of hs) await L.store.put('habits', { ...h, createdAt: Date.now() - createdDaysAgo * 86400000 });
    const rows = [];
    for (const n of votesDaysAgo) for (const h of hs) rows.push({ date: E.addDays(t, -n), habitId: h.id, status: 'done', note: null, ts: Date.now() });
    await L.store.putMany('checkins', rows);
    await L.store.setSetting('emptyVaultExplained', true); await L.store.setSetting('lastWeeklyVaultCard', t); await L.store.setSetting('lastAfterMissDate', t);
    for (let i = 0; i < wins; i++) await L.store.put('wins', { id: `w${i}`, text: `Seeded win number ${i + 1}`, source: 'manual', date: E.addDays(t, -10 - i), habitId: null, tags: [], createdAt: i });
  }, { votesDaysAgo, habitIdx, createdDaysAgo, wins });
}
async function reopen(page) { await page.reload(); await page.waitForSelector('#screen > *'); await page.waitForTimeout(150); }
const go = async (page, r) => { await page.click(`#tabs a[data-route=${r}]`); await page.waitForTimeout(120); };

// computed colour contrast of every visible, enabled control and text node in the live DOM
async function contrastScan(page) {
  return page.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(',').map((x) => parseFloat(x)); return { r, g, b, a }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const bgOf = (el) => { let e = el, stack = []; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 0.99) break; } e = e.parentElement; } let base = { r: 255, g: 255, b: 255 }; for (const c of stack.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) }; return base; };
    const bad = [];
    const els = [...document.querySelectorAll('#screen *, #tabs *, #overlay-root *')].filter((e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed');
    for (const e of els) {
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own || e.disabled || e.closest('[disabled]') || e.closest('.out')) continue;
      const cs = getComputedStyle(e); const fg = parse(cs.color); if (!fg) continue;
      const bg = bgOf(e); const L1 = lum({ r: fg.r, g: fg.g, b: fg.b }), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      if (ratio < 4.5) bad.push(`${e.tagName.toLowerCase()}.${e.className || ''} "${e.textContent.trim().slice(0, 24)}" ${ratio.toFixed(2)}`);
    }
    return bad;
  });
}
const text = (page) => page.locator('#screen').innerText();

async function acceptance(n, name, fn) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(String(n))) return;
  const t0 = Date.now();
  try { const detail = await fn(); results.push({ n, name, pass: true, detail: detail || '' }); console.log(`PASS ${String(n).padStart(2)}  ${name}${detail ? `  [${detail}]` : ''}  (${Date.now() - t0}ms)`); }
  catch (e) { results.push({ n, name, pass: false, detail: e.message }); console.log(`FAIL ${String(n).padStart(2)}  ${name}\n        ${e.message.split('\n').slice(0, 4).join('\n        ')}`); }
}
const expect = (c, m) => { if (!c) throw new Error(m); };
const noErrors = (page) => expect(page.errors.length === 0, `console/page errors: ${page.errors.join(' | ')}`);

// 1 ---------------------------------------------------------------------------------------------
await acceptance(1, 'Works offline after first visit; installable; manifest valid', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx);
  await page.goto(URL_); await page.evaluate(() => navigator.serviceWorker.ready); await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker is not controlling the page after reload');
  const cdp = await ctx.newCDPSession(page);
  const inst = await cdp.send('Page.getInstallabilityErrors'); const instErr = inst.installabilityErrors.filter((e) => e.errorId !== 'in-incognito'); expect(instErr.length === 0, `installability: ${JSON.stringify(instErr)}`); // Playwright contexts are always incognito
  const man = await cdp.send('Page.getAppManifest'); expect(!man.errors.length, `manifest errors: ${JSON.stringify(man.errors)}`);
  await ctx.setOffline(true); await page.reload(); await page.waitForSelector('#screen > *');
  expect((await text(page)).length > 20, 'nothing rendered offline');
  await ctx.setOffline(false); noErrors(page); await ctx.close();
  return 'SW controls page, offline reload renders, 0 installability errors (ignoring the harness-only in-incognito flag), 0 manifest errors';
});

// 2 ---------------------------------------------------------------------------------------------
await acceptance(2, 'Zero network requests after load', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx);
  await setup(page); await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await page.waitForSelector('.row-main'); await page.waitForTimeout(800);
  const origin = new URL(URL_).origin; const ext = [];
  page.on('request', (r) => { if (!r.url().startsWith(origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) ext.push(r.url()); });
  const afterLoad = []; page.on('request', (r) => { if (!r.url().startsWith('data:')) afterLoad.push(r.url()); });
  const before = log.length;
  await page.locator('.row-main').nth(0).click(); await page.locator('.row-main').nth(1).click();
  await go(page, 'vault'); await go(page, 'settings'); await go(page, 'today');
  await page.locator('.row-aux').first().click(); await page.waitForSelector('.sheet'); await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const appReqs = log.slice(before).filter((p) => p !== '/sw.js'); const swChecks = log.slice(before).length - appReqs.length;
  expect(appReqs.length === 0, `server saw ${appReqs.length} app request(s): ${appReqs.join(', ')}`);
  expect(afterLoad.length === 0, `page issued ${afterLoad.length} request(s): ${afterLoad.join(', ')}`);
  expect(ext.length === 0, `cross-origin requests: ${ext.join(', ')}`);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'); expect(/connect-src 'self'/.test(html), 'CSP connect-src');
  noErrors(page); await ctx.close();
  return `0 app requests during use (server log + page events); 0 cross-origin; CSP connect-src self; browser-initiated sw.js revalidations seen: ${swChecks}`;
});

// 3 ---------------------------------------------------------------------------------------------
await acceptance(3, 'One-tap check-in; quick loop < 20s; full loop < 60s', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await setup(page);
  let t = Date.now(); await page.locator('.row-main').nth(0).click();
  await page.waitForFunction(() => document.querySelector('.row[data-status=done]')); const one = Date.now() - t;
  expect(await page.locator('.row[data-status=done]').count() === 1, 'one tap should complete one habit');
  expect(await page.locator('.sheet').count() === 0, 'no dialog should interrupt a quick check-in');
  await page.locator('.row-main').nth(0).click(); await page.waitForTimeout(150); // clear (undo-able) to time a clean loop
  t = Date.now(); for (let i = 0; i < 3; i++) await page.locator('.row-main').nth(i).click();
  await page.waitForFunction(() => document.querySelectorAll('.row[data-status=done]').length === 3); const quick = Date.now() - t;
  await page.getByRole('button', { name: 'Full', exact: true }).click(); await page.waitForTimeout(150);
  for (let i = 0; i < 3; i++) await page.locator('.row-main').nth(i).click(); // clears all (taps toggle)
  await page.waitForTimeout(200);
  t = Date.now(); const taps = [];
  for (let i = 0; i < 3; i++) { await page.locator('.row-main').nth(i).click(); taps.push('habit'); }
  await page.waitForSelector('.sheet [aria-label="Mood (1 to 5)"]'); await page.getByRole('button', { name: '4 Good' }).click(); taps.push('mood'); await page.getByRole('button', { name: 'Save', exact: true }).click(); taps.push('save');
  await page.waitForFunction(() => !document.querySelector('.sheet')); const full = Date.now() - t;
  await page.evaluate(() => window.__ledger.store.clear('checkins')); await page.getByRole('button', { name: 'Quick', exact: true }).click(); await page.waitForTimeout(200);
  const inPage = await page.evaluate(async () => { const wait = (f) => new Promise((r) => { const t = () => (f() ? r() : requestAnimationFrame(t)); t(); }); await window.__ledger.refresh(); const t0 = performance.now(); for (let i = 0; i < 3; i++) { document.querySelectorAll('.row-main')[i].click(); await wait(() => document.querySelectorAll('.row[data-status=done]').length === i + 1); } return Math.round(performance.now() - t0); });
  expect(quick < 20000 && full < 60000, `quick ${quick}ms full ${full}ms`);
  noErrors(page); await ctx.close();
  return `1 tap per habit; quick loop = 3 taps, app responds in ${inPage}ms total (Playwright-scripted incl. waits: ${quick}ms); full loop = ${taps.length} taps (scripted ${full}ms); single tap ${one}ms`;
});

// 4 ---------------------------------------------------------------------------------------------
await acceptance(4, 'Data persists across reloads; persist() requested', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await setup(page);
  expect(await page.evaluate(() => window.__persistCalls) === 0, 'persist() should wait for the first check-in');
  await page.locator('.row-main').nth(0).click(); await page.waitForSelector('.row[data-status=done]');
  expect(await page.evaluate(() => window.__persistCalls) >= 1, 'navigator.storage.persist() was not requested after the first check-in');
  await reopen(page); expect(await page.locator('.row[data-status=done]').count() === 1, 'check-in did not survive reload');
  expect((await page.locator('.row-main b').allInnerTexts()).join() === 'Move,Focus,Tidy', 'habits did not survive reload');
  noErrors(page); await ctx.close();
  return 'persist() called after first check-in; state survives reload';
});

// 5 ---------------------------------------------------------------------------------------------
await acceptance(5, 'Export then Import (replace) on a clean profile reproduces identical data', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await setup(page);
  await seed(page, { votesDaysAgo: [1, 2, 4], wins: 3 });
  await page.locator('.row-main').nth(0).click(); await page.waitForSelector('.row[data-status=done]');
  await page.locator('.row-aux').nth(1).click(); await page.fill('.sheet textarea', 'Ran the full loop, felt steady'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForTimeout(300);
  await go(page, 'settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export everything (JSON)' }).click()]);
  const file = await dl.path(); const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(exported.app === 'daily-ledger' && exported.stores.checkins.length > 5 && exported.stores.wins.length >= 4, 'export looks wrong');
  const ctx2 = await ctxOf(); const p2 = await pageOf(ctx2); await p2.goto(URL_); await p2.waitForSelector('progress');
  await p2.evaluate(() => { location.hash = '#settings'; }); await p2.waitForSelector('#import-file', { state: 'attached' });
  await p2.setInputFiles('#import-file', file); await p2.waitForSelector('.sheet');
  await p2.getByRole('button', { name: 'Replace', exact: true }).click(); await p2.waitForTimeout(500);
  const after = await p2.evaluate(() => window.__ledger.store.snapshot());
  const diffs = Object.keys(exported.stores).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(exported.stores[k]));
  expect(!diffs.length, `stores differ: ${diffs.map((k) => `${k} exported=${JSON.stringify(exported.stores[k]).slice(0, 300)} imported=${JSON.stringify(after[k]).slice(0, 300)}`).join(' || ')}`);
  await p2.waitForSelector('.row-main'); expect((await p2.locator('.row-main b').allInnerTexts()).join() === 'Move,Focus,Tidy', 'UI does not show imported habits');
  const rows = Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.length]));
  noErrors(page); noErrors(p2); await ctx.close(); await ctx2.close();
  return `identical across ${JSON.stringify(rows)}`;
});

// 6 ---------------------------------------------------------------------------------------------
await acceptance(6, 'Backup banner appears when lastExportAt is over 7 days old', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await setup(page);
  await page.evaluate(() => window.__ledger.store.setSetting('lastExportAt', Date.now() - 3 * 86400000)); await reopen(page);
  expect(!(await text(page)).includes('cheap insurance'), 'banner shown at 3 days');
  await page.evaluate(() => window.__ledger.store.setSetting('lastExportAt', Date.now() - 8 * 86400000)); await reopen(page);
  expect((await text(page)).includes('cheap insurance'), 'banner missing at 8 days');
  await reopen(page); expect(!(await text(page)).includes('cheap insurance'), 'banner should show at most once per day');
  await page.evaluate(() => window.__ledger.store.setSetting('lastBackupNudgeAt', null)); await reopen(page);
  await page.getByRole('button', { name: 'Later' }).click(); await page.waitForTimeout(300); expect(!(await text(page)).includes('cheap insurance'), 'banner not dismissible');
  noErrors(page); await ctx.close();
  return 'hidden at 3d, shown at 8d, once per day, dismissible';
});

// 7 ---------------------------------------------------------------------------------------------
await acceptance(7, 'config.json import maps every key; invalid files rejected; defaults fill gaps', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await setup(page); await go(page, 'settings');
  const open = async () => { await page.getByRole('button', { name: 'Import interview config…' }).click(); await page.waitForSelector('.sheet textarea'); };
  await open(); await page.fill('.sheet textarea', '{not json'); await page.getByRole('button', { name: 'Preview' }).click();
  expect((await page.locator('.sheet').innerText()).includes('not valid JSON'), 'bad JSON not rejected clearly');
  await page.fill('.sheet textarea', JSON.stringify({ schema: 1, tone: 'loud', reminder: { time: '8pm' } })); await page.getByRole('button', { name: 'Preview' }).click();
  const rej = await page.locator('.sheet').innerText(); expect(rej.includes('rejected') && rej.includes('tone') && rej.includes('reminder.time'), `rejection text: ${rej}`);
  expect(await page.getByRole('button', { name: 'Apply' }).count() === 0, 'Apply must not be offered for an invalid file');
  const cfg = await page.evaluate(async () => { const K = await import('/js/config.js'); const res = await (await fetch('/tests/fixtures/results.json')).json(); return { d: K.deriveConfig(res).config, P: K.INTERVIEW_PROFILE }; });
  const custom = { ...cfg.d, source: 'custom', theme: { mode: 'dark', palette: 'warm', contrast: 'high' }, tone: 'coach', vaultReplay: ['manual', 'random'], reminder: { mode: 'ics', time: '21:15' }, setbackAfterDays: 4, bogusKey: 1 };
  await page.fill('.sheet textarea', JSON.stringify(custom)); await page.getByRole('button', { name: 'Preview' }).click();
  expect((await page.locator('.sheet').innerText()).includes('bogusKey'), 'unknown key not warned');
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await page.waitForTimeout(250);
  const applied = await page.evaluate(() => window.__ledger.config);
  expect(applied.theme.mode === 'dark' && applied.theme.palette === 'warm' && applied.tone === 'coach' && applied.reminder.time === '21:15' && applied.setbackAfterDays === 4 && applied.vaultReplay.join() === 'manual,random' && !('bogusKey' in applied), `applied: ${JSON.stringify(applied)}`);
  expect(await page.evaluate(() => document.documentElement.dataset.scheme + document.documentElement.dataset.palette) === 'darkwarm', 'theme not applied live');
  await page.getByRole('button', { name: 'Reset to my interview profile' }).click(); await page.getByRole('button', { name: 'Reset', exact: true }).click(); await page.waitForTimeout(250);
  expect(await page.evaluate(() => JSON.stringify(window.__ledger.config)) === JSON.stringify(cfg.P), 'reset did not restore the interview profile');
  noErrors(page); await ctx.close();
  return 'bad JSON + invalid values rejected with reasons; unknown key warned; valid file applied; reset restores profile';
});

// 8 ---------------------------------------------------------------------------------------------
await acceptance(8, 'Habit cap enforced; starts at 3 and grows only by deliberate action', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await page.goto(URL_); await page.waitForSelector('progress');
  await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.waitForSelector('#hn0');
  for (let i = 1; i <= 4; i++) { const b = page.getByRole('button', { name: 'Add another', exact: true }); if (await b.isEnabled()) { await b.click(); await page.waitForSelector(`#hn${i}`); } }
  expect(await page.locator('[id^=hn]').count() === 3, 'setup allowed more than 3 habits'); expect(await page.getByRole('button', { name: 'Add another', exact: true }).isDisabled(), 'Add another should be disabled at the cap');
  await page.fill('#hn0', 'A'); await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.getByRole('button', { name: 'Skip for now' }).click(); await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForSelector('.row-main'); await go(page, 'settings');
  await page.getByRole('button', { name: 'Add a habit' }).click(); for (const n of ['B', 'C']) { await page.fill('#hname', n); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForTimeout(250); if (n === 'B') await page.getByRole('button', { name: 'Add a habit' }).click(); }
  expect(await page.getByRole('button', { name: 'Add a habit' }).count() === 0, 'Add a habit still offered at the cap');
  expect(/habits \(3 of 3\)/i.test(await text(page)), 'cap label missing');
  await page.getByRole('button', { name: 'Raise the limit to 4' }).click(); await page.getByRole('button', { name: 'Raise it', exact: true }).click(); await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__ledger.config.habitCap) === 4, 'limit did not rise by one step');
  for (let cap = 4; cap < 8; cap++) {
    await page.getByRole('button', { name: 'Add a habit' }).click(); await page.fill('#hname', `H${cap}`); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForTimeout(250);
    const r = page.getByRole('button', { name: `Raise the limit to ${cap + 1}` }); if (await r.count()) { await r.click(); await page.getByRole('button', { name: 'Raise it', exact: true }).click(); await page.waitForTimeout(250); }
  }
  expect(await page.evaluate(() => window.__ledger.config.habitCap) === 8, 'cap should have climbed to 8 one deliberate step at a time');
  await page.getByRole('button', { name: 'Add a habit' }).click(); await page.fill('#hname', 'H8'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForTimeout(300);
  expect((await text(page)).includes('maximum of 8'), 'maximum of 8 not enforced'); expect(await page.getByRole('button', { name: 'Add a habit' }).count() === 0, 'can add past 8');
  noErrors(page); await ctx.close();
  return 'setup caps at 3; Settings add blocked at cap; +1 only via confirm; hard stop at 8';
});

// 9 ---------------------------------------------------------------------------------------------
await acceptance(9, 'Never-miss-twice shows minVersion after exactly one missed day; completion counts as a full vote', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await setup(page);
  await seed(page, { votesDaysAgo: [2, 3, 4] }); await reopen(page);
  const rows = await page.locator('.row').count(); expect(rows === 3, 'rows');
  expect(await page.getByRole('button', { name: /Tiny version of Move/ }).count() === 1, 'tiny-version offer missing after one missed day');
  expect((await text(page)).includes('Put on shoes'), 'minVersion text not shown');
  const before = await page.evaluate(async () => { const L = window.__ledger, E = await import('/js/engine.js'); const d = await L.data(); return E.cumulativeDays(d.idx, d.today); });
  await page.getByRole('button', { name: /Tiny version of Move/ }).click(); await page.waitForSelector('.row[data-status=min]');
  const after = await page.evaluate(async () => { const L = window.__ledger, E = await import('/js/engine.js'); const d = await L.data(); return E.cumulativeDays(d.idx, d.today); });
  expect(after === before + 1, `cumulative ${before} -> ${after}`);
  await page.evaluate(() => window.__ledger.store.clear('checkins')); await seed(page, { votesDaysAgo: [1, 2] }); await reopen(page);
  expect(await page.getByRole('button', { name: /Tiny version of/ }).count() === 0, 'offer shown when nothing was missed');
  noErrors(page); await ctx.close();
  return 'offer at 1 gap day; tiny = full vote (+1 day); no offer with no gap';
});

// 10 --------------------------------------------------------------------------------------------
await acceptance(10, 'Setback after configured missed days; shows what was built; no banned words', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await setup(page);
  await seed(page, { votesDaysAgo: [4, 5, 6], wins: 3 }); await page.evaluate(() => window.__ledger.store.setSetting('lastWeeklyVaultCard', window.__ledger.today())); await reopen(page);
  const head = await page.locator('section[aria-label="Welcome back"]').innerText();
  expect(head.includes('Welcome back') && /3 days counted in the last 60/.test(head) && /3 wins saved/.test(head) && /best streak 3/.test(head), `setback header: ${head}`);
  const all = await text(page); expect(!/\b(lost|failed|fail|broke|broken|shame)\b/i.test(all), `banned word in: ${all}`);
  expect(await page.locator('.row-main small').first().innerText() === 'Tiny version: Put on shoes', 'comeback options not shown as tiny versions');
  const sbefore = await page.evaluate(() => window.__ledger.store.get('setback', 'state')); expect(sbefore && sbefore.active, 'setback row missing');
  await page.locator('.sheet .btn, .sheet button').first().waitFor({ state: 'attached', timeout: 1500 }).catch(() => {});
  if (await page.locator('.sheet').count()) await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  await page.locator('.row-main').first().click(); await page.waitForSelector('.sheet');
  expect((await page.locator('.sheet').innerText()).includes('what got in the way'), 'optional chips prompt missing');
  await page.getByRole('button', { name: 'Busy day' }).click(); await page.waitForTimeout(300);
  const s = await page.evaluate(() => window.__ledger.store.get('setback', 'state')); expect(!s.active && s.blocker === 'Busy day' && s.taskText === 'Put on shoes', `after: ${JSON.stringify(s)}`);
  expect(!(await text(page)).includes('Welcome back'), 'header should return to normal after the tiny step');
  // threshold honoured: 2 days is not enough at default 3; 4 days needed when set to 4
  await page.evaluate(() => window.__ledger.store.clear('checkins')); await page.evaluate(() => window.__ledger.store.clear('setback')); await seed(page, { votesDaysAgo: [3, 4] }); await reopen(page);
  expect(!(await text(page)).includes('Welcome back'), '2 empty days must not trigger at the default 3');
  await page.evaluate(() => window.__ledger.store.clear('checkins')); await seed(page, { votesDaysAgo: [4, 5] }); await reopen(page);
  expect((await text(page)).includes('Welcome back'), '3 empty days should trigger');
  noErrors(page); await ctx.close();
  return 'header leads with built stats + tiny options; chips optional; resolves on return; copy scan clean';
});

// 11 --------------------------------------------------------------------------------------------
await acceptance(11, 'Each module toggle fully removes or restores its UI without errors', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await setup(page);
  await seed(page, { votesDaysAgo: [4, 5], wins: 3 }); await page.evaluate(() => window.__ledger.store.setSetting('lastWeeklyVaultCard', window.__ledger.today())); await reopen(page);
  expect((await text(page)).includes('Welcome back'), 'setback should be on by default');
  await go(page, 'settings'); await page.getByRole('button', { name: 'Setback (welcome-back card)' }).click(); await page.waitForTimeout(250); await go(page, 'today');
  expect(!(await text(page)).includes('Welcome back') && await page.locator('section[aria-label="Welcome back"]').count() === 0, 'setback UI remained after toggle off');
  await go(page, 'settings'); await page.getByRole('button', { name: 'Setback (welcome-back card)' }).click(); await page.waitForTimeout(250); await go(page, 'today');
  expect((await text(page)).includes('Welcome back'), 'setback UI not restored');
  // reflect
  await page.evaluate(() => window.__ledger.store.clear('checkins')); await page.evaluate(() => window.__ledger.store.clear('setback')); await reopen(page);
  await page.getByRole('button', { name: 'Full', exact: true }).click(); await page.waitForTimeout(150);
  await go(page, 'settings'); await page.getByRole('button', { name: 'Reflect (full mode only)' }).click(); await page.waitForTimeout(250); await go(page, 'today');
  for (let i = 0; i < 3; i++) await page.locator('.row-main').nth(i).click();
  await page.waitForTimeout(500); expect(await page.locator('.sheet').count() === 0 && !(await text(page)).includes('Reflect'), 'reflect UI remained after toggle off');
  for (let i = 0; i < 3; i++) await page.locator('.row-main').nth(i).click(); await page.waitForTimeout(250);
  await go(page, 'settings'); await page.getByRole('button', { name: 'Reflect (full mode only)' }).click(); await page.waitForTimeout(250); await go(page, 'today');
  for (let i = 0; i < 3; i++) await page.locator('.row-main').nth(i).click();
  await page.waitForSelector('.sheet'); expect((await page.locator('.sheet').innerText()).includes('A quick look back'), 'reflect not restored');
  noErrors(page); await ctx.close();
  return 'setback + reflect: off removes, on restores, no console errors';
});

// 12 --------------------------------------------------------------------------------------------
await acceptance(12, 'Reduced motion disables animation; dark / light / auto work', async () => {
  const ctx = await ctxOf({ reducedMotion: 'reduce', colorScheme: 'dark' }); const page = await pageOf(ctx); await setup(page);
  const sch = () => page.evaluate(() => document.documentElement.dataset.scheme);
  expect(await sch() === 'dark', `auto + dark OS => ${await sch()}`);
  await page.locator('.row-main').nth(0).click(); await page.waitForTimeout(100);
  const anim = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).animationName !== 'none').length); expect(anim === 0, `${anim} animated elements under reduced motion`);
  await page.locator('.row-aux').first().click(); await page.waitForSelector('.sheet');
  const sh = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('.sheet')); return [s.animationName, s.transitionDuration]; }); expect(sh[0] === 'none', `sheet animation ${sh}`); await page.keyboard.press('Escape');
  const colours = {}; for (const m of ['light', 'dark', 'oled', 'auto']) { await page.evaluate((m) => window.__ledger.updateConfig('theme.mode', m), m); colours[m] = await page.evaluate(() => [document.documentElement.dataset.scheme, getComputedStyle(document.body).backgroundColor]); }
  expect(colours.light[0] === 'light' && colours.dark[0] === 'dark' && colours.oled[0] === 'oled' && colours.auto[0] === 'dark', JSON.stringify(colours));
  expect(colours.light[1] !== colours.dark[1] && colours.oled[1] === 'rgb(0, 0, 0)', JSON.stringify(colours));
  const lightCtx = await ctxOf({ colorScheme: 'light' }); const p2 = await pageOf(lightCtx); await p2.goto(URL_); await p2.waitForSelector('progress'); expect(await p2.evaluate(() => document.documentElement.dataset.scheme) === 'light', 'auto + light OS');
  const full = await p2.evaluate(() => { document.documentElement.dataset.anim = 'subtle'; return [...document.styleSheets[0].cssRules].some((r) => r.media && /prefers-reduced-motion/.test(r.media.mediaText)); }); expect(full, 'reduced-motion rule missing');
  noErrors(page); await ctx.close(); await lightCtx.close();
  return 'reduced-motion: 0 animated elements, sheet has no animation; auto/light/dark/oled verified';
});

// 13 --------------------------------------------------------------------------------------------
await acceptance(13, 'Primary actions in the bottom 40% of 390x844; targets >= 56px', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await setup(page);
  const boxes = await page.evaluate(() => [...document.querySelectorAll('#screen .row-main, #screen .row-aux, #screen .seg button, #tabs a')].map((e) => { const r = e.getBoundingClientRect(); return { t: e.className || e.tagName, top: r.top, h: r.height, w: r.width }; }));
  const limit = 844 * 0.6; const bad = boxes.filter((b) => b.top < limit - 0.5);
  expect(!bad.length, `above the thumb zone: ${JSON.stringify(bad)}`); expect(boxes.every((b) => b.h >= 56 - 0.01 && b.w >= 56 - 0.01), `small targets: ${JSON.stringify(boxes.filter((b) => b.h < 56 || b.w < 56))}`);
  const gaps = await page.evaluate(() => { const r = [...document.querySelectorAll('.row')].map((e) => e.getBoundingClientRect()); return r.slice(1).map((b, i) => b.top - r[i].bottom); }); expect(gaps.every((g) => g >= 8 - 0.01), `row gaps ${gaps}`);
  const checks = {};
  for (const r of ['today', 'vault', 'settings']) {
    await go(page, r); await page.waitForTimeout(100);
    const small = await page.evaluate(() => [...document.querySelectorAll('#screen button, #screen select, #screen input:not([type=file]), #screen textarea, #tabs a')].filter((e) => e.offsetParent !== null).map((e) => ({ t: (e.textContent || e.getAttribute('aria-label') || e.tagName).slice(0, 24), h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width })).filter((x) => x.h < 55.99 || (x.t.length && x.w < 55.99 && !/select|input/i.test(x.t))));
    checks[r] = small; expect(small.length === 0, `${r}: undersized targets ${JSON.stringify(small)}`);
  }
  await go(page, 'vault'); const pull = await page.getByRole('button', { name: 'Pull a win' }).boundingBox(); expect(pull.y >= limit - 0.5, `Pull a win at y=${pull.y}`);
  await go(page, 'today'); await page.locator('.row-aux').first().click(); await page.waitForSelector('.sheet'); const sb = await page.evaluate(() => [...document.querySelectorAll('.sheet button')].map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, h: r.height }))); expect(sb.every((b) => b.top >= limit - 0.5 && b.h >= 55.99), `sheet buttons ${JSON.stringify(sb)}`);
  const cs = []; cs.push(...(await contrastScan(page)).map((x) => `sheet: ${x}`)); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  for (const r of ['today', 'vault', 'settings']) { await go(page, r); cs.push(...(await contrastScan(page)).map((x) => `${r}: ${x}`)); }
  await go(page, 'vault'); await page.getByRole('button', { name: 'Add a win' }).click(); await page.waitForSelector('.sheet'); cs.push(...(await contrastScan(page)).map((x) => `win sheet: ${x}`)); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  expect(cs.length === 0, `low-contrast text (<4.5:1): ${cs.join(' | ')}`);
  const sa = await page.evaluate(() => getComputedStyle(document.querySelector('#tabs')).paddingBottom !== undefined && /safe-area-inset-bottom/.test([...document.styleSheets[0].cssRules].map((r) => r.cssText).join('')));
  expect(sa, 'safe-area insets not used');
  noErrors(page); await ctx.close();
  return `rows start at y=${Math.round(boxes.filter((b) => /row-main/.test(b.t))[0].top)} (limit ${Math.round(limit)}); every button/select/input/tab on all 3 screens >= 56px; 8px gaps; computed text contrast >= 4.5:1 on Today, Vault, Settings and sheets`;
});

// 14 --------------------------------------------------------------------------------------------
await acceptance(14, 'Wins auto-created from notes; "Pull a win" returns a random existing win', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await setup(page);
  await go(page, 'vault'); await page.getByRole('button', { name: 'Pull a win' }).click(); await page.waitForSelector('.sheet'); expect((await page.locator('.sheet').innerText()).includes('Wins come from notes'), 'empty-state explanation missing'); await page.getByRole('button', { name: 'Got it' }).click(); await page.waitForTimeout(250);
  await go(page, 'today'); const notes = ['Walked in the rain', 'Quiet minute worked', 'Desk is clear'];
  for (let i = 0; i < 3; i++) { await page.locator('.row-aux').nth(i * 2 + 0 === 0 ? 0 : 0).click().catch(() => {}); }
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) { const aux = page.getByRole('button', { name: /^Note or options for/ }).nth(i); await aux.click(); await page.waitForSelector('.sheet textarea'); await page.fill('.sheet textarea', notes[i]); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForTimeout(350); }
  const wins = await page.evaluate(() => window.__ledger.store.all('wins')); expect(wins.length === 3 && wins.every((w) => w.source === 'auto' && notes.includes(w.text)), `wins ${JSON.stringify(wins)}`);
  await go(page, 'vault'); for (const n of notes) expect((await text(page)).includes(n), `vault missing ${n}`);
  const seen = new Set(); for (let i = 0; i < 30 && seen.size < 3; i++) { await page.getByRole('button', { name: 'Pull a win' }).click(); await page.waitForSelector('.sheet'); const t = await page.locator('.sheet .card').innerText(); const hit = notes.find((n) => t.includes(n)); expect(hit, `pulled text not an existing win: ${t}`); seen.add(hit); await page.getByRole('button', { name: 'Close', exact: true }).click(); await page.waitForTimeout(250); }
  expect(seen.size === 3, `only ${seen.size} distinct wins in 30 pulls`);
  const c = await page.evaluate(() => window.__ledger.store.getSetting('counters', {})); expect(c.vaultPullsManual >= 3, 'manual pulls not counted');
  noErrors(page); await ctx.close();
  return `3 notes -> 3 auto wins; ${seen.size}/3 distinct wins surfaced by random pulls; empty state explained`;
});

// 15 --------------------------------------------------------------------------------------------
await acceptance(15, 'Metrics match seeded fake sessions; nothing is transmitted', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await setup(page);
  await page.evaluate(async () => { const L = window.__ledger, E = await import('/js/engine.js'), t = L.today(); await L.store.clear('sessions'); await L.store.setSetting('trialStartDate', E.addDays(t, -4)); const secs = [20, 40, 60, 80, 100]; for (let i = 0; i < 5; i++) await L.store.put('sessions', { date: E.addDays(t, -4 + i), startTs: i, endTs: i + 1, seconds: secs[i], interacted: true }); await L.store.setSetting('counters', { setbackTriggers: 2, setbackReturns: 1, vaultPullsManual: 4, vaultPullsAuto: 3, sessionsSinceRandom: 0 }); });
  const before = log.length; await go(page, 'settings'); const t = await text(page);
  expect(t.includes('5 of 5 days opened'), `days opened line: ${t.match(/\d+ of \d+ days opened[^.]*/)}`); expect(t.includes('Median session 60s'), 'median');
  expect(t.includes('Setback shown 2, returns 1') && t.includes('4 manual, 3 automatic'), 'counts');
  const li = await page.locator('ul[aria-label="Last 14 days"] li').allInnerTexts(); expect(li.length === 5 && li.every((x) => /opened/.test(x)), `last-14 list: ${li}`);
  await page.getByRole('button', { name: 'Copy trial summary' }).click(); const clip = await page.evaluate(() => navigator.clipboard.readText()); expect(/Median session: 60s/.test(clip) && /Days opened: 5 of 5/.test(clip), `clipboard: ${clip}`);
  await page.evaluate(async () => { const L = window.__ledger, E = await import('/js/engine.js'), t = L.today(); await L.store.clear('sessions'); await L.store.setSetting('trialStartDate', E.addDays(t, -13)); await L.store.put('sessions', { date: t, startTs: 1, endTs: 2, seconds: 200, interacted: true }); }); await reopen(page); await go(page, 'settings');
  expect(/pace under 10 of 14/.test(await text(page)) && /over 90s/.test(await text(page)), 'flags not shown'); expect(log.length === before, 'a request was made while viewing metrics');
  noErrors(page); await ctx.close();
  return 'counts, median, last-14 list and flags match seeded data; summary copied locally; 0 requests';
});

// 16 --------------------------------------------------------------------------------------------
await acceptance(16, 'node tests/engine.test.js passes', async () => {
  const r = spawnSync('node', ['tests/engine.test.js'], { cwd: root, encoding: 'utf8' }); const last = r.stdout.trim().split('\n').pop();
  expect(r.status === 0, r.stdout.slice(-600)); return last;
});

// 17 --------------------------------------------------------------------------------------------
await acceptance(17, 'Gate-derived config matches the ID mapping for a seeded results.json', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await page.goto(URL_);
  const r = await page.evaluate(async () => { const K = await import('/js/config.js'); const res = await (await fetch('/tests/fixtures/results.json')).json(); const d = K.deriveConfig(res); return { ok: JSON.stringify({ ...d.config, source: 'interview' }) === JSON.stringify(K.INTERVIEW_PROFILE), n: d.trace.length, conflicts: d.conflicts.length }; });
  expect(r.ok, 'derived config differs from INTERVIEW_PROFILE'); await ctx.close(); return `${r.n} keys traced; ${r.conflicts} conflicts listed; multi-letter cases in node tests`;
});

// 18 --------------------------------------------------------------------------------------------
await acceptance(18, 'Reflect hidden in quick mode; mood 1-2 triggers a vault replay', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await setup(page);
  await seed(page, { votesDaysAgo: [1], wins: 4 }); await page.evaluate(() => window.__ledger.store.setSetting('lastWeeklyVaultCard', window.__ledger.today())); await reopen(page);
  for (let i = 0; i < 3; i++) await page.locator('.row-main').nth(i).click(); await page.waitForTimeout(500);
  expect(await page.locator('.sheet').count() === 0, 'reflect sheet opened in quick mode');
  for (let i = 0; i < 3; i++) await page.locator('.row-main').nth(i).click(); await page.waitForTimeout(300); // clear
  await page.getByRole('button', { name: 'Full', exact: true }).click(); await page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) await page.locator('.row-main').nth(i).click(); await page.waitForSelector('.sheet');
  const s = await page.locator('.sheet:not(.out)').innerText(); expect(s.includes('A quick look back') && s.includes('What I did') && s.includes('Mood'), 'reflect content');
  await page.getByRole('button', { name: '2 Down' }).click(); expect((await page.locator('.sheet:not(.out)').innerText()).includes("What's a more accurate way to say that?"), 'reframe line missing for low rating');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForSelector('.sheet:not(.out):has-text("rough one to log")');
  expect(/Seeded win number/.test(await page.locator('.sheet:not(.out)').innerText()), 'replayed text is not a vault win'); await page.getByRole('button', { name: 'Close', exact: true }).click();
  const r = await page.evaluate(() => window.__ledger.store.all('reflections')); expect(r.length === 1 && r[0].mood === 2, JSON.stringify(r));
  // a mood of 4 must not replay
  await page.evaluate(async () => { const L = window.__ledger; await L.store.clear('reflections'); await L.store.clear('checkins'); }); await reopen(page);
  for (let i = 0; i < 3; i++) await page.locator('.row-main').nth(i).click();
  await page.waitForSelector('.sheet:not(.out)'); await page.getByRole('button', { name: '4 Good' }).click(); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForTimeout(600);
  expect(await page.locator('.sheet:not(.out)').count() === 0, 'mood 4 should not replay');
  noErrors(page); await ctx.close(); return 'no reflect in quick; rating 2 -> reframe line + lowMood replay of a real win; rating 4 -> none';
});

// 19 --------------------------------------------------------------------------------------------
await acceptance(19, 'Each vaultReplay trigger fires only when enabled; weekly once per week; random capped', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await setup(page);
  const cfgOnly = (arr) => page.evaluate((a) => window.__ledger.updateConfig('vaultReplay', a), arr);
  const open = async () => { await page.evaluate(() => window.__ledger.store.setSetting('lastAfterMissDate', null)); await reopen(page); await page.waitForTimeout(300); return page.locator('.sheet').count(); };
  await seed(page, { votesDaysAgo: [2, 3], wins: 4 }); // exactly one missed day (yesterday)
  const today_ = await today(page); await page.evaluate((t) => window.__ledger.store.setSetting('lastWeeklyVaultCard', t), today_);
  await cfgOnly(['manual']); expect(await open() === 0, 'afterMiss fired while disabled');
  await cfgOnly(['manual', 'afterMiss']); expect(await open() === 1 && (await page.locator('.sheet').innerText()).includes('before the tiny version'), 'afterMiss did not fire when enabled'); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  expect(await open() === 1, 'afterMiss should fire on the first open of each day (cleared marker)'); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  await page.evaluate(() => window.__ledger.store.setSetting('lastAfterMissDate', window.__ledger.today())); await reopen(page); await page.waitForTimeout(300); expect(await page.locator('.sheet').count() === 0, 'afterMiss repeated the same day');
  // weekly
  await cfgOnly(['manual', 'weekly']); await page.evaluate(async () => { const E = await import('/js/engine.js'); await window.__ledger.store.setSetting('lastWeeklyVaultCard', E.addDays(window.__ledger.today(), -8)); });
  await reopen(page); await page.waitForTimeout(300); expect(await page.locator('.sheet').count() === 1 && (await page.locator('.sheet').innerText()).includes('new week'), 'weekly did not fire'); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  await reopen(page); await page.waitForTimeout(300); expect(await page.locator('.sheet').count() === 0, 'weekly fired twice in one week');
  await cfgOnly(['manual']); await page.evaluate(async () => { const E = await import('/js/engine.js'); await window.__ledger.store.setSetting('lastWeeklyVaultCard', E.addDays(window.__ledger.today(), -8)); }); await reopen(page); await page.waitForTimeout(300); expect(await page.locator('.sheet').count() === 0, 'weekly fired while disabled');
  // random: only on check-in, only after 7 sessions
  await cfgOnly(['manual', 'random']); await page.evaluate(() => { Math.random = () => 0.1; window.__ledger.store.setSetting('counters', { sessionsSinceRandom: 3 }); }); await page.locator('.row-main').nth(0).click(); await page.waitForTimeout(400);
  expect(await page.locator('.sheet').count() === 0, 'random fired under the 7-session cap');
  await page.locator('.row-main').nth(0).click(); await page.waitForTimeout(200); await page.evaluate(() => window.__ledger.store.setSetting('counters', { sessionsSinceRandom: 7 })); await page.locator('.row-main').nth(0).click(); await page.waitForSelector('.sheet', { timeout: 3000 });
  const c = await page.evaluate(() => window.__ledger.store.getSetting('counters', {})); expect(c.sessionsSinceRandom === 0, `cap counter not reset: ${JSON.stringify(c)}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  await cfgOnly(['manual']); await page.evaluate(() => window.__ledger.store.setSetting('counters', { sessionsSinceRandom: 50 })); await page.locator('.row-main').nth(0).click(); await page.waitForTimeout(200); await page.locator('.row-main').nth(0).click(); await page.waitForTimeout(400); expect(await page.locator('.sheet').count() === 0, 'random fired while disabled');
  noErrors(page); await ctx.close(); return 'afterMiss/weekly/random each fire only when enabled; weekly once per week; random respects 7-session cap and rng (lowMood: see #18)';
});

// 20 --------------------------------------------------------------------------------------------
await acceptance(20, 'Reminder .ics downloads at 20:00 by default; before noon shows a warning', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); await setup(page); await go(page, 'settings');
  expect(await page.inputValue('#reminder-time') === '20:00', 'default time is not 20:00');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download daily reminder (.ics)' }).click()]);
  expect(dl.suggestedFilename() === 'daily-ledger.ics', dl.suggestedFilename()); const ics = fs.readFileSync(await dl.path(), 'utf8');
  expect(/DTSTART:\d{8}T200000/.test(ics) && /RRULE:FREQ=DAILY/.test(ics) && /BEGIN:VALARM/.test(ics) && (ics.match(/BEGIN:VEVENT/g) || []).length === 1, ics);
  expect(ics.includes('After dinner'), 'anchor routine not tied to the reminder');
  expect((await page.locator('.warn[role=alert]').first().innerText()) === '', 'warning shown at 20:00');
  await page.fill('#reminder-time', '08:30'); await page.dispatchEvent('#reminder-time', 'change'); await page.waitForTimeout(200);
  expect((await page.locator('#reminder-time ~ .warn, .field .warn').first().innerText()).includes('before noon'), 'no early warning');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download daily reminder (.ics)' }).click()]); expect(/T083000/.test(fs.readFileSync(await dl2.path(), 'utf8')), 'ics did not follow the chosen time');
  noErrors(page); await ctx.close(); return '20:00 default, single daily VEVENT with alarm, anchor in description, warning before noon';
});

// 21 --------------------------------------------------------------------------------------------
await acceptance(21, 'First-run setup: progress bar, resumable, under 5 minutes', async () => {
  const ctx = await ctxOf(); const page = await pageOf(ctx); const t0 = Date.now(); await page.goto(URL_); await page.waitForSelector('progress');
  const pr = async () => page.evaluate(() => { const p = document.querySelector('progress'); return [p.value, p.max, p.getAttribute('aria-label')]; });
  const low = []; low.push(...(await contrastScan(page)).map((x) => `s1: ${x}`)); expect(await page.locator('#tabs').isHidden(), 'tab bar should be hidden during setup');
  expect((await pr()).slice(0, 2).join() === '1,5', `progress ${await pr()}`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.waitForFunction(() => document.querySelector('progress').value === 2); expect((await pr())[0] === 2, 'step 2'); await page.fill('#hn0', 'Move'); await page.fill('#hm0', 'Shoes on'); low.push(...(await contrastScan(page)).map((x) => `s2: ${x}`));
  await page.getByRole('button', { name: 'Save and finish later' }).click(); await page.waitForSelector('text=Setup paused at step 2 of 5');
  await reopen(page); await page.getByRole('button', { name: 'Resume' }).click(); await page.waitForSelector('progress');
  expect((await pr())[0] === 2 && await page.inputValue('#hn0') === 'Move' && await page.inputValue('#hm0') === 'Shoes on', 'resume lost progress or draft');
  await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.getByRole('button', { name: 'After dinner' }).click(); await page.getByRole('button', { name: 'Continue', exact: true }).click(); await low.push(...(await contrastScan(page)).map((x) => `s3-4: ${x}`)); await page.getByRole('button', { name: 'Skip for now' }).click(); await page.waitForFunction(() => document.querySelector('progress').value === 5); expect((await pr())[0] === 5, 'last step'); low.push(...(await contrastScan(page)).map((x) => `s5: ${x}`)); expect(low.length === 0, `low-contrast text in setup: ${low.join(' | ')}`);
  await page.getByRole('button', { name: 'Start' }).click(); await page.waitForSelector('.row-main');
  const sp = await page.evaluate(() => window.__ledger.store.getSetting('setupProgress')); expect(sp.done === true, 'setup not marked done');
  const secs = Math.round((Date.now() - t0) / 1000); expect(secs < 300, `${secs}s`);
  expect(!(await text(page)).includes('Setup paused'), 'resume banner persisted after finishing');
  noErrors(page); await ctx.close(); return `5 steps with progress bar, pause + resume keeps draft; scripted walkthrough ${secs}s (limit 300s)`;
});

await browser.close(); server.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} acceptance tests passed`);
fs.writeFileSync(path.join(root, 'tests', 'last-acceptance-run.json'), JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
