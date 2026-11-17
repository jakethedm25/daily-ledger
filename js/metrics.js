// metrics.js: local-only instrumentation. A `sessions` row per foreground session. Never transmitted.
import { addDays, dayDiff, median, localDate } from './engine.js';

/** Pure summary used by Settings > Trial and by the tests. */
export function summarize({ sessions, trialStartDate, today, counters = {}, notesAdded = 0, reflectCompletions = 0 }) {
  const done = sessions.filter((s) => s.endTs && s.seconds > 0);
  const daysSince = trialStartDate ? Math.max(1, dayDiff(trialStartDate, today) + 1) : 1;
  const dates = new Set(sessions.filter((s) => s.date >= (trialStartDate || '0000')).map((s) => s.date));
  const last14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    if (trialStartDate && d < trialStartDate) continue;
    const ss = sessions.filter((s) => s.date === d);
    last14.push({ date: d, opened: ss.length > 0, sessions: ss.length, seconds: ss.reduce((a, s) => a + (s.seconds || 0), 0) });
  }
  const window = last14.length || 1;
  const opened14 = last14.filter((x) => x.opened).length;
  const med = Math.round(median(done.map((s) => s.seconds)));
  const flags = [];
  const pace = (opened14 / window) * 14;
  if (daysSince >= 3 && pace < 10) flags.push(`Opened ${opened14} of the last ${window} days (pace under 10 of 14).`);
  if (med > 90) flags.push(`Median session ${med}s is over 90s.`);
  return {
    daysSince, daysOpened: dates.size, opened14, window, medianSeconds: med, last14, flags,
    counts: {
      setbackTriggers: counters.setbackTriggers || 0, setbackReturns: counters.setbackReturns || 0,
      reflectCompletions, vaultPullsManual: counters.vaultPullsManual || 0, vaultPullsAuto: counters.vaultPullsAuto || 0, notesAdded,
    },
  };
}

export function trialText(sum, today) {
  const c = sum.counts;
  const lines = [
    `Daily Ledger trial summary, ${today}`,
    `Days opened: ${sum.daysOpened} of ${sum.daysSince} since trial start (last 14: ${sum.opened14} of ${sum.window}).`,
    `Median session: ${sum.medianSeconds}s (target under 60s; flag over 90s).`,
    `Setback: ${c.setbackTriggers} shown, ${c.setbackReturns} returns. Reflect completions: ${c.reflectCompletions}. Vault pulls: ${c.vaultPullsManual} manual, ${c.vaultPullsAuto} automatic. Notes added: ${c.notesAdded}.`,
    sum.flags.length ? `Flags: ${sum.flags.join(' ')}` : 'Flags: none.',
    'Last 14 days:',
    ...sum.last14.map((x) => `${x.date}  ${x.opened ? `opened x${x.sessions}, ${x.seconds}s` : 'not opened'}`),
  ];
  return lines.join('\n');
}

/** Browser-only: record one row per foreground session. */
export function startTracking({ store, getRollover, onSessionStart }) {
  let cur = null;
  const now = () => Date.now();
  const dateNow = () => localDate(now(), getRollover());
  async function start() {
    if (cur) return;
    cur = { startTs: now(), endTs: null, seconds: 0, interacted: false, date: dateNow() };
    const mine = cur;
    mine.ready = store.put('sessions', { startTs: mine.startTs, endTs: null, seconds: 0, interacted: false, date: mine.date }).then((id) => { mine.id = id; });
    await mine.ready;
    if (onSessionStart) onSessionStart();
  }
  async function end() {
    if (!cur) return;
    const c = cur; cur = null;
    if (c.ready) await c.ready;
    c.endTs = now(); c.seconds = Math.max(0, Math.round((c.endTs - c.startTs) / 1000));
    if (c.id != null) await store.put('sessions', { id: c.id, startTs: c.startTs, endTs: c.endTs, seconds: c.seconds, interacted: c.interacted, date: c.date });
  }
  const mark = () => { if (cur) cur.interacted = true; };
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? start() : end()));
  window.addEventListener('pagehide', end);
  ['pointerdown', 'keydown'].forEach((e) => document.addEventListener(e, mark, { passive: true }));
  if (document.visibilityState === 'visible') start();
  return { start, end };
}
