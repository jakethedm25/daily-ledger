// main.js: boot, routing, app context. Zero network calls beyond same-origin cached files.
import * as store from './store.js';
import { INTERVIEW_PROFILE, validateConfig, clone, setPath, isLocked } from './config.js';
import { localDate, indexCheckins } from './engine.js';
import { h, $, sheet, sheetOpen, button } from './dom.js';
import { startTracking } from './metrics.js';
import { renderToday } from './ui/today.js';
import { renderVault } from './ui/vault.js';
import { renderSettings } from './ui/settings.js';
import { renderSetup } from './ui/setup.js';

const ROUTES = ['today', 'vault', 'settings'];
const ICONS = {
  today: 'M5 12l4 4 10-10',
  vault: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6',
};
const LABELS = { today: 'Today', vault: 'Vault', settings: 'Settings' };

const app = {
  store, config: clone(INTERVIEW_PROFILE), route: 'today', openHandled: false, nudge: undefined, updateReady: false, updating: false, reg: null,
  today() { return localDate(Date.now(), this.config.dayRolloverHour); },
  async data() {
    const [allHabits, checkins, wins, reflections, setbackRow, settings] = await Promise.all([
      store.all('habits'), store.all('checkins'), store.all('wins'), store.all('reflections'), store.get('setback', 'state'), store.settingsMap()]);
    const habits = allHabits.filter((x) => !x.archived).sort((a, b) => a.order - b.order);
    return { habits, allHabits, checkins, idx: indexCheckins(checkins), wins, reflections, setbackRow, settings, today: this.today() };
  },
  go(r) { if (location.hash === `#${r}`) render(); else location.hash = `#${r}`; },
  refresh() { return render(); },
  // dialogs run one at a time; open(done) must call done() when its sheet closes
  _q: Promise.resolve(),
  dialog(open) { const p = this._q.then(() => new Promise((res) => open(res))); this._q = p.catch(() => {}); return p; },
  async bump(name, inc = 1) { const c = await store.getSetting('counters', {}); c[name] = (c[name] || 0) + inc; await store.setSetting('counters', c); },
  async setCounter(name, val) { const c = await store.getSetting('counters', {}); c[name] = val; await store.setSetting('counters', c); },
  feedback(kind) {
    const c = this.config;
    try {
      if (navigator.vibrate) {
        if (c.haptics === 'on' && kind === 'tap') navigator.vibrate(12);
        if (kind === 'milestone' && c.haptics !== 'off') navigator.vibrate([20, 40, 20]);
      }
      if (c.sound === 'soft' && (window.AudioContext || window.webkitAudioContext)) {
        const ctx = this._ac || (this._ac = new (window.AudioContext || window.webkitAudioContext)());
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = kind === 'milestone' ? 660 : 880; g.gain.value = 0.04;
        o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.08);
      }
    } catch { /* feedback is best effort */ }
  },
  async setConfig(cfg) { this.config = cfg; await store.setSetting('config', cfg); applyConfig(cfg); },
  async updateConfig(path, value) {
    if (isLocked(this.config, path)) {
      const ok = await new Promise((res) => sheet({ title: 'This setting is locked', onClose: () => res(false), build(body, close) {
        body.append(h('p', { text: `"${path}" was locked by your interview profile. Change it anyway?` }), h('div', { class: 'seg' }, button('Keep it', { onclick: () => close('no') }), button('Change it', { kind: 'primary', onclick: () => { res(true); close('yes'); } })));
      } }));
      if (!ok) return false;
    }
    const c = clone(this.config); setPath(c, path, value);
    if (c.habitCap > c.habitCapMax) c.habitCap = c.habitCapMax;
    await this.setConfig(c); return true;
  },
  async loadConfig() {
    let c = await store.getSetting('config');
    if (!c) {
      c = clone(INTERVIEW_PROFILE);
      this.config = c;
      await store.setSetting('config', c);
      await store.setSetting('installedAt', Date.now());
      await store.setSetting('trialStartDate', this.today());
    } else { const v = validateConfig(c); c = v.ok ? v.config : clone(INTERVIEW_PROFILE); }
    this.config = c; applyConfig(c);
  },
  applyUpdate() { if (this.reg && this.reg.waiting) { this.updating = true; this.reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } },
  async checkUpdate() { if (!this.reg) return; try { await this.reg.update(); } catch { /* offline */ } this.updateReady = !!(this.reg.waiting && navigator.serviceWorker.controller); },
};

function applyConfig(c) {
  const r = document.documentElement;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  r.dataset.scheme = c.theme.mode === 'auto' ? (dark ? 'dark' : 'light') : c.theme.mode;
  r.dataset.palette = c.theme.palette; r.dataset.contrast = c.theme.contrast;
  r.dataset.density = c.density; r.dataset.hand = c.handedness; r.dataset.anim = c.animation;
  r.style.fontSize = `${Math.round(c.textScale * 100)}%`;
  try { localStorage.setItem('ledger.theme', JSON.stringify(c.theme)); } catch { /* optional mirror */ }
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.setAttribute('content', getComputedStyle(r).getPropertyValue('--accent').trim() || '#17636d');
}

function currentRoute() { const r = location.hash.slice(1); return ['today', 'vault', 'settings', 'setup'].includes(r) ? r : 'today'; }

function buildTabs() {
  const nav = $('#tabs');
  ROUTES.forEach((r) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[r]); svg.append(p);
    nav.append(h('a', { href: `#${r}`, 'data-route': r }, svg, h('span', { text: LABELS[r] })));
  });
}

let rendering = null, again = false;
function render() {
  if (rendering) { again = true; return rendering; }
  rendering = (async () => {
    do { again = false; await doRender(); } while (again);
  })().finally(() => { rendering = null; });
  return rendering;
}
async function doRender() {
  const root = $('#screen');
  const route = currentRoute();
  const same = route === app.route;
  const keep = same ? root.scrollTop : 0;
  app.route = route;
  $('#tabs').hidden = route === 'setup';
  document.querySelectorAll('#tabs a').forEach((a) => (a.dataset.route === route ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const tmp = h('div');
  const fn = { today: renderToday, vault: renderVault, settings: renderSettings, setup: renderSetup }[route];
  await fn(app, tmp);
  root.replaceChildren(...tmp.childNodes);
  root.scrollTop = keep;
}

function wireSwipe() {
  const el = $('#screen');
  let sx = 0, sy = 0;
  el.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (sheetOpen() || app.route === 'setup') return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 80 && Math.abs(dy) < 50 && Math.abs(dx) > Math.abs(dy) * 2) {
      const n = ROUTES.indexOf(app.route) + (dx < 0 ? 1 : -1);
      if (ROUTES[n]) app.go(ROUTES[n]);
    }
  }, { passive: true });
}

async function maybeNotify() {
  try {
    const d = await app.data();
    if (!d.settings.webNotify || !('Notification' in window) || Notification.permission !== 'granted' || !app.reg) return;
    const [hh, mm] = app.config.reminder.time.split(':').map(Number);
    const now = new Date();
    if (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) return;
    if (d.idx.voted.has(d.today) || d.settings.lastNotifyDate === d.today) return;
    await app.store.setSetting('lastNotifyDate', d.today);
    await app.reg.showNotification('Daily Ledger', { body: 'The tiny version counts.', icon: 'icons/icon-192.png', tag: 'daily-ledger' });
  } catch { /* best effort */ }
}

async function registerSw() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    app.reg = reg;
    const track = (sw) => sw && sw.addEventListener('statechange', () => { if (sw.state === 'installed' && navigator.serviceWorker.controller) { app.updateReady = true; render(); } });
    if (reg.waiting && navigator.serviceWorker.controller) { app.updateReady = true; render(); }
    reg.addEventListener('updatefound', () => track(reg.installing));
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (app.updating) location.reload(); });
  } catch { /* the app still works without a service worker */ }
}

async function boot() {
  await store.open();
  await app.loadConfig();
  const s = await store.settingsMap();
  try { localStorage.setItem('ledger.lastOpenDate', app.today()); } catch { /* optional */ }
  buildTabs(); wireSwipe();
  if (!s.setupProgress && !location.hash) location.hash = '#setup';
  app.lastDate = app.today();
  window.addEventListener('hashchange', render);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyConfig(app.config));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    app.openHandled = false; app.nudge = undefined; app.lastDate = app.today();
    render(); maybeNotify();
  });
  await render();
  startTracking({ store, getRollover: () => app.config.dayRolloverHour, onSessionStart: () => app.bump('sessionsSinceRandom') });
  registerSw();
  window.__ledger = app; // handy for the test harness; no network involved
}
boot();
