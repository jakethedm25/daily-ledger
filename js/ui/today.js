// today.js: the checklist. One tap = done. Primary actions sit in the bottom 40% (thumb zone).
import { h, clear, button, sheet, toast } from '../dom.js';
import * as E from '../engine.js';
import * as C from '../copy.js';
import { evalSetback, setbackHeader, setbackReturn } from './setback.js';
import { reflectAvailable, openReflect } from './reflect.js';
import { showReplay, explainEmptyVault } from './vault.js';
import { backupNudgeDue } from '../io.js';
import { exportJson } from './settings.js';

const SVG = 'http://www.w3.org/2000/svg';
const MILESTONES = [7, 30, 100];

export function currentMode(app, d) {
  const l = app.config.loopLength;
  if (l !== 'choose') return l;
  const m = d.settings.dayMode;
  return m && m.date === d.today ? m.mode : 'quick';
}

function recFor(d, habit) { return d.checkins.find((c) => c.date === d.today && c.habitId === habit.id) || null; }

/** Write (or clear, status=null) today's check-in for a habit and run the follow-up moments. */
export async function setStatus(app, habit, status, extra = {}) {
  const d = await app.data();
  const date = d.today;
  const prev = recFor(d, habit);
  const wasCounted = d.idx.voted.has(date);
  const sbRow = d.setbackRow;
  if (status === null) {
    await app.store.del('checkins', [date, habit.id]);
  } else {
    const rec = { date, habitId: habit.id, status, note: null, ts: Date.now() };
    rec.note = extra.note !== undefined ? (extra.note || null) : (prev ? prev.note : null);
    if (extra.value !== undefined && extra.value !== null && extra.value !== '') rec.value = Number(extra.value);
    else if (prev && prev.value != null && extra.value === undefined) rec.value = prev.value;
    await app.store.put('checkins', rec);
    const wid = `auto-${date}-${habit.id}`;
    if (rec.note) {
      const old = d.wins.find((w) => w.id === wid);
      await app.store.put('wins', { id: wid, text: rec.note, source: 'auto', date, habitId: habit.id, tags: [], createdAt: old ? old.createdAt : Date.now() });
    } else if (extra.note !== undefined) await app.store.del('wins', wid);
  }
  if (status && !d.settings.persistAsked) {
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* best effort */ }
    await app.store.setSetting('persistAsked', Date.now());
  }
  const nd = await app.data();
  const counted = status === 'done' || status === 'min';
  const newlyCounted = counted && !wasCounted;
  if (status) app.feedback('tap');
  await app.refresh();
  if (newlyCounted) {
    if (sbRow && sbRow.active && !sbRow.dismissedAt && app.config.modules.setback) setbackReturn(app, sbRow, habit);
    const total = nd.idx.voted.size;
    if (MILESTONES.includes(total) && !(nd.settings.milestonesSeen || []).includes(total) && ['mix', 'milestones'].includes(app.config.rewardStyle.timing)) {
      await app.store.setSetting('milestonesSeen', [...(nd.settings.milestonesSeen || []), total]);
      app.feedback('milestone');
      toast(C.milestoneCopy(C.toneForDay(app.config, E.dayIndex(nd.today)), total), { ms: 7000 });
    }
  }
  const mode = currentMode(app, nd);
  const resolved = nd.habits.length > 0 && nd.habits.every((x) => recFor(nd, x));
  const reflecting = status && resolved && reflectAvailable(app, nd, mode);
  if (reflecting) openReflect(app, nd);
  else if (newlyCounted) {
    const dec = E.replayDecision({ config: app.config, event: 'checkin', winCount: nd.wins.length, today: nd.today, sessionsSinceRandom: nd.settings.counters?.sessionsSinceRandom ?? 0 });
    if (dec.trigger) { await app.setCounter('sessionsSinceRandom', 0); showReplay(app, 'random', nd.wins, nd.allHabits); }
  }
  return prev;
}

async function undo(app, rec) {
  await app.store.put('checkins', rec);
  app.refresh();
}

async function clearStatus(app, habit, rec) {
  await app.store.del('checkins', [rec.date, habit.id]);
  await app.refresh();
  toast(`${habit.name} cleared`, { action: 'Undo', onAction: () => undo(app, rec) });
}

export function openHabitSheet(app, d, habit, rec) {
  return sheet({
    title: habit.name,
    build(body, close) {
      let status = rec && rec.status ? rec.status : 'done';
      const opts = [['done', 'Done'], ['min', 'Tiny version'], ['rest', 'Rest day']];
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Status' });
      const paint = () => seg.replaceChildren(...opts.map(([k, l]) => h('button', { type: 'button', 'aria-pressed': String(status === k), onclick: () => { status = k; paint(); } }, l)));
      paint();
      body.append(h('p', { class: 'muted', text: `Tiny version: ${habit.minVersion || 'none set'}. It counts as a full check-in.` }), seg);
      let num = null;
      if (habit.input === 'number') {
        num = h('input', { type: 'number', inputMode: 'decimal', 'aria-label': 'Number', placeholder: 'Number' });
        if (rec && rec.value != null) num.value = rec.value;
        body.append(num);
      }
      const ta = h('textarea', { 'aria-label': 'Note', placeholder: 'Optional note. A note is saved to your win vault.', maxLength: 400 });
      ta.value = rec && rec.note ? rec.note : '';
      body.append(ta);
      const row = h('div', { class: 'seg' });
      if (rec) row.append(button('Clear', { onclick: async () => { close('clear'); await clearStatus(app, habit, rec); } }));
      row.append(button('Save', { kind: 'primary', onclick: async () => { close('save'); await setStatus(app, habit, status, { note: ta.value.trim(), value: num ? num.value : undefined }); } }));
      body.append(row);
      if (habit.input === 'note' && !rec) setTimeout(() => ta.focus(), 60);
    },
  });
}

function habitRow(app, d, habit, { offer, tiny, offerCopy }) {
  const rec = recFor(d, habit);
  const status = rec ? rec.status : 'none';
  const done = status === 'done' || status === 'min';
  let sub = '';
  if (status === 'done') sub = rec.value != null ? `Done · ${rec.value}` : 'Done';
  else if (status === 'min') sub = 'Tiny version done';
  else if (status === 'rest') sub = 'Rest day';
  else if (tiny) sub = `Tiny version: ${habit.minVersion}`;
  else if (offer) sub = offerCopy;
  const word = { done: 'done', min: 'tiny version done', rest: 'rest day', none: 'not done yet' }[status];
  const main = h('button', { class: 'row-main', type: 'button', 'aria-pressed': String(done), 'aria-label': `${habit.name}, ${word}${sub && status === 'none' ? `. ${sub}` : ''}` },
    h('span', { class: 'check', 'aria-hidden': 'true', text: done ? '✓' : status === 'rest' ? '–' : '' }),
    h('span', { class: 'label' }, h('b', { text: habit.name }), sub ? h('small', { text: sub }) : null));
  let timer = null, long = false;
  main.addEventListener('pointerdown', () => { long = false; timer = setTimeout(() => { long = true; openHabitSheet(app, d, habit, rec); }, 500); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => main.addEventListener(ev, () => clearTimeout(timer)));
  main.addEventListener('contextmenu', (e) => e.preventDefault());
  main.addEventListener('click', async () => {
    if (long) { long = false; return; }
    if (rec) return clearStatus(app, habit, rec);
    if (tiny) return setStatus(app, habit, 'min');
    if (habit.input === 'note' || habit.input === 'number') return openHabitSheet(app, d, habit, null);
    return setStatus(app, habit, 'done');
  });
  const row = h('div', { class: 'row', 'data-status': status }, main);
  if (offer && !tiny && !rec) row.append(h('button', { class: 'row-aux wide', type: 'button', 'aria-label': `Tiny version of ${habit.name}`, onclick: () => setStatus(app, habit, 'min') }, 'Tiny'));
  row.append(h('button', { class: 'row-aux', type: 'button', 'aria-label': `Note or options for ${habit.name}`, onclick: () => openHabitSheet(app, d, habit, rec) }, '✎'));
  if (rec && rec.ts > Date.now() - 1200 && app.config.animation !== 'none') row.classList.add('pop');
  return row;
}

function svgEl(tag, attrs) { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }

function streakEl(app, d) {
  const style = app.config.streakStyle;
  if (style === 'hidden') return null;
  const n = E.currentStreak(d.idx, d.today);
  if (n < 1) return null; // never foreground a zero
  const label = `${n} in a row`;
  if (style === 'number') return h('div', { class: 'streak', text: label });
  if (style === 'ring') {
    const goal = [7, 30, 100, 365].find((g) => g > n) || 365;
    const circ = 2 * Math.PI * 14;
    const svg = svgEl('svg', { viewBox: '0 0 34 34', 'aria-hidden': 'true' });
    svg.append(svgEl('circle', { cx: 17, cy: 17, r: 14, fill: 'none', stroke: 'currentColor', 'stroke-opacity': '.25', 'stroke-width': 4 }),
      svgEl('circle', { cx: 17, cy: 17, r: 14, fill: 'none', stroke: 'currentColor', 'stroke-width': 4, 'stroke-dasharray': `${(n / goal) * circ} ${circ}`, transform: 'rotate(-90 17 17)' }));
    return h('div', { class: 'streak', 'aria-label': `${label}, next marker at ${goal}` }, svg, `${label}`);
  }
  if (style === 'heatmap') {
    const cells = [];
    for (let i = 13; i >= 0; i--) { const dd = E.addDays(d.today, -i); cells.push(h('span', { class: `cell${d.idx.voted.has(dd) ? ' on' : ''}`, title: dd })); }
    return h('div', { class: 'streak', role: 'img', 'aria-label': `Last 14 days. ${label}` }, cells, h('span', { text: label }));
  }
  const links = [];
  for (let i = 0; i < 7; i++) links.push(h('span', { class: `link${i < Math.min(n, 7) ? ' on' : ''}` }));
  return h('div', { class: 'streak', role: 'img', 'aria-label': label }, links, h('span', { text: label }));
}

function factsFor(d) {
  const wd = E.weekday(d.today);
  let weekdayCount = 0;
  for (const dd of d.idx.voted.keys()) if (dd !== d.today && E.weekday(dd) === wd) weekdayCount++;
  const withVotes = d.habits.filter((x) => d.idx.byHabit.get(x.id) && d.idx.byHabit.get(x.id).voted.size > 0);
  const hb = withVotes.length ? withVotes[E.dayIndex(d.today) % withVotes.length] : null;
  return {
    last60: E.cumulativeDays(d.idx, d.today), total: E.totalDays(d.idx), streak: E.currentStreak(d.idx, d.today), best: E.bestStreak(d.idx),
    wins: d.wins.length, weekdayName: C.dayName(wd), weekdayCount, habitName: hb ? hb.name : '', habitCount: hb ? d.idx.byHabit.get(hb.id).voted.size : 0,
  };
}

function headerLine(app, d) {
  const di = E.dayIndex(d.today);
  const tone = C.toneForDay(app.config, di);
  const msg = C.headerMessage(tone, factsFor(d), di);
  const mode = app.config.headerLine;
  const useWin = d.wins.length >= 3 && (mode === 'vaultWin' || (mode === 'rotate' && di % 2 === 1));
  if (!useWin) return h('p', { class: 'line', text: msg });
  const w = d.wins[di % d.wins.length];
  return h('p', { class: 'line', text: `“${w.text}” (${w.date})` });
}

async function handleOpen(app, d) {
  if (d.idx.voted.size === 0) return;
  const from = E.startDate(d.idx, d.settings.trialStartDate);
  const { missed } = E.missedRun(d.idx, d.today, from);
  const dec = E.replayDecision({ config: app.config, event: 'open', winCount: d.wins.length, today: d.today, missedRun: missed, afterMissShownDate: d.settings.lastAfterMissDate, lastWeeklyVaultCard: d.settings.lastWeeklyVaultCard });
  if (dec.trigger) {
    if (dec.trigger === 'afterMiss') await app.store.setSetting('lastAfterMissDate', d.today);
    if (dec.trigger === 'weekly') await app.store.setSetting('lastWeeklyVaultCard', d.today);
    showReplay(app, dec.trigger, d.wins, d.allHabits);
  } else if (dec.explain && !d.settings.emptyVaultExplained) {
    await app.store.setSetting('emptyVaultExplained', true);
    explainEmptyVault(app);
  }
}

export async function renderToday(app, root) {
  const d = await app.data();
  const sb = await evalSetback(app, d);
  const mode = currentMode(app, d);
  clear(root);
  const f = factsFor(d);

  // banners (read-only area, top)
  const sp = d.settings.setupProgress;
  if (sp && !sp.done) root.append(h('div', { class: 'banner' }, h('p', { text: `Setup paused at step ${sp.step + 1} of 5.` }), button('Resume', { onclick: () => app.go('setup') })));
  if (app.updateReady) root.append(h('div', { class: 'banner' }, h('p', { text: 'An update is ready.' }), button('Update', { onclick: () => app.applyUpdate() })));
  if (app.nudge === undefined) {
    app.nudge = backupNudgeDue({ lastExportAt: d.settings.lastExportAt, installedAt: d.settings.installedAt, lastBackupNudgeAt: d.settings.lastBackupNudgeAt, now: Date.now(), today: d.today });
    if (app.nudge) await app.store.setSetting('lastBackupNudgeAt', d.today);
  }
  if (app.nudge) root.append(h('div', { class: 'banner', role: 'note' }, h('p', { text: 'A backup is cheap insurance. Export a copy when you have a minute.' }),
    button('Export', { onclick: async () => { await exportJson(app); app.nudge = false; app.refresh(); } }),
    button('Later', { onclick: () => { app.nudge = false; app.refresh(); } })));

  // header: setback replaces the normal header
  if (sb) root.append(setbackHeader(app, d, sb));
  else {
    const headline = f.last60 > 0 ? h('div', { class: 'big' }, `${f.last60}`, h('small', { text: 'of the last 60 days' }))
      : f.total > 0 ? h('div', { class: 'big' }, `${f.total}`, h('small', { text: 'days counted so far' }))
        : h('div', { class: 'big', text: 'Day one' });
    root.append(h('section', { class: 'card list', 'aria-label': 'Progress' }, h('div', { class: 'headline' }, headline), streakEl(app, d),
      d.checkins.length === 0 ? h('p', { class: 'line', text: C.FIRST_OPEN }) : headerLine(app, d)));
  }

  root.append(h('div', { class: 'spacer' }));
  const stack = h('div', { class: 'stack' });
  if (app.config.loopLength === 'choose' || (mode === 'full' && reflectAvailable(app, d, mode) && d.checkins.some((c) => c.date === d.today))) {
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Check-in length' });
    if (app.config.loopLength === 'choose') {
      ['quick', 'full'].forEach((m) => seg.append(h('button', { type: 'button', 'aria-pressed': String(mode === m), onclick: async () => { await app.store.setSetting('dayMode', { date: d.today, mode: m }); app.refresh(); } }, m === 'quick' ? 'Quick' : 'Full')));
    }
    if (mode === 'full' && reflectAvailable(app, d, mode) && d.checkins.some((c) => c.date === d.today)) seg.append(h('button', { type: 'button', onclick: () => openReflect(app, d) }, 'Reflect'));
    stack.append(seg);
  }
  if (!d.habits.length) stack.append(h('div', { class: 'card' }, h('p', { text: 'No habits yet.' }), button('Set up habits', { kind: 'primary', onclick: () => app.go('setup') })));
  for (const habit of d.habits) {
    const rec = recFor(d, habit);
    const nmt = E.neverMissTwice(d.idx, habit, d.today, E.localDate(habit.createdAt || Date.now(), app.config.dayRolloverHour));
    const tinyMode = !!sb && !rec;
    const offerCopy = nmt.offer ? C.tinyOffer(C.toneForDay(app.config, E.dayIndex(d.today)), { minVersion: habit.minVersion, missed: nmt.missed }).body : '';
    stack.append(habitRow(app, d, habit, { offer: nmt.offer && !rec, tiny: tinyMode, offerCopy }));
  }
  root.append(stack);
  if (!app.openHandled) { app.openHandled = true; handleOpen(app, d); }
}
