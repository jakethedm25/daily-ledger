// io.js: export / import / CSV / .ics / summary / backup nudge. Pure builders, no DOM, no network.
import { addDays, dayDiff, cumulativeDays, bestStreak, currentStreak, indexCheckins, COUNTED } from './engine.js';
import { APP_VERSION } from './config.js';

export const STORES = ['habits', 'checkins', 'wins', 'reflections', 'settings', 'setback', 'sessions'];
const WEEK_MS = 7 * 86400000;

export function buildExport(snapshot, now = Date.now()) {
  return { app: 'daily-ledger', schema: 1, version: APP_VERSION, exportedAt: now, stores: snapshot };
}

export function validateExport(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['Not a JSON object.'], summary: null };
  if (obj.app !== 'daily-ledger') errors.push('This file is not a Daily Ledger export.');
  if (obj.schema !== 1) errors.push(`Unsupported schema ${JSON.stringify(obj.schema)} (expected 1).`);
  if (!obj.stores || typeof obj.stores !== 'object') errors.push('Missing "stores".');
  const summary = {};
  if (obj.stores) {
    for (const s of STORES) {
      const v = obj.stores[s];
      if (v === undefined) { summary[s] = 0; continue; }
      if (!Array.isArray(v)) errors.push(`stores.${s} must be a list.`); else summary[s] = v.length;
    }
    for (const c of obj.stores.checkins || []) {
      if (!c || typeof c.date !== 'string' || typeof c.habitId !== 'string' || !['done', 'min', 'rest'].includes(c.status)) { errors.push('A check-in row is malformed.'); break; }
    }
    for (const h of obj.stores.habits || []) { if (!h || typeof h.id !== 'string' || typeof h.name !== 'string') { errors.push('A habit row is malformed.'); break; } }
  }
  return { ok: errors.length === 0, errors, summary };
}

const keyOf = { habits: (r) => r.id, checkins: (r) => `${r.date}|${r.habitId}`, wins: (r) => r.id, reflections: (r) => r.date, settings: (r) => r.key, setback: (r) => r.key };

/** Returns the full snapshot that results from importing `imported` ({stores}) into `current`. */
export function planImport(current, imported, mode) {
  const src = imported.stores;
  if (mode === 'replace') {
    const out = {};
    for (const s of STORES) out[s] = JSON.parse(JSON.stringify(src[s] || []));
    return out;
  }
  const out = {};
  for (const s of STORES) out[s] = JSON.parse(JSON.stringify(current[s] || []));
  for (const s of Object.keys(keyOf)) {
    const m = new Map(out[s].map((r) => [keyOf[s](r), r]));
    for (const r of src[s] || []) {
      const k = keyOf[s](r), ex = m.get(k);
      if (!ex) { m.set(k, r); continue; }
      if (s === 'settings') { if (k === 'lastExportAt') m.set(k, { key: k, value: Math.max(ex.value || 0, r.value || 0) }); continue; }
      if ((r.ts || r.createdAt || 0) > (ex.ts || ex.createdAt || 0) && s !== 'habits' && s !== 'wins') m.set(k, r);
    }
    out[s] = [...m.values()];
  }
  const seen = new Set(out.sessions.map((r) => r.startTs));
  let next = out.sessions.reduce((a, r) => Math.max(a, r.id || 0), 0) + 1;
  for (const r of src.sessions || []) if (!seen.has(r.startTs)) out.sessions.push({ ...r, id: next++ });
  return out;
}

export function summarizeImport(current, imported, mode) {
  const next = planImport(current, imported, mode);
  const rows = STORES.filter((s) => s !== 'sessions' && s !== 'settings').map((s) => ({ store: s, now: (current[s] || []).length, after: next[s].length }));
  return { rows, mode };
}

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // keep spreadsheets from running a note as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(checkins, habits) {
  const name = new Map(habits.map((h) => [h.id, h.name]));
  const rows = [...checkins].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return ['date,habit,status,note', ...rows.map((c) => [c.date, name.get(c.habitId) || c.habitId, c.status, c.note].map(csvCell).join(','))].join('\n') + '\n';
}

const icsEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
/** One daily reminder, floating local time (reliable on iOS Calendar). */
export function buildIcs({ time = '20:00', anchor = '', today, now = Date.now() }) {
  const [hh, mm] = time.split(':');
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const d = today.replace(/-/g, '');
  const desc = anchor ? `After ${anchor}. The tiny version counts.` : 'The tiny version counts.';
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daily Ledger//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', 'UID:daily-ledger-reminder@local', `DTSTAMP:${stamp}`,
    `DTSTART:${d}T${hh}${mm}00`, 'DURATION:PT10M', 'RRULE:FREQ=DAILY',
    'SUMMARY:Daily Ledger check-in', `DESCRIPTION:${icsEsc(desc)}`,
    'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Daily Ledger check-in', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

export function backupNudgeDue({ lastExportAt, installedAt, lastBackupNudgeAt, now, today }) {
  if (lastBackupNudgeAt === today) return false;
  const ref = lastExportAt || installedAt;
  return !!ref && now - ref > WEEK_MS;
}

/** User-initiated text for pasting into a chat. Nothing is transmitted by the app. */
export function summaryForClaude({ habits, checkins, wins, reflections, today }) {
  const idx = indexCheckins(checkins);
  const lines = [`Daily Ledger summary as of ${today}`];
  lines.push(`Days counted in the last 60: ${cumulativeDays(idx, today)}. Best streak: ${bestStreak(idx)}. Current streak: ${currentStreak(idx, today)}. Wins saved: ${wins.length}.`);
  for (const h of habits.filter((x) => !x.archived)) {
    const hh = idx.byHabit.get(h.id);
    let n30 = 0;
    if (hh) for (const d of hh.voted) { const k = dayDiff(d, today); if (k >= 0 && k < 30) n30++; }
    lines.push(`- ${h.name}: ${n30} of the last 30 days (tiny version: ${h.minVersion || 'none'})`);
  }
  const moods = reflections.filter((r) => r.mood != null && dayDiff(r.date, today) < 30 && dayDiff(r.date, today) >= 0);
  if (moods.length) lines.push(`Mood ratings, last 30 days: ${moods.sort((a, b) => (a.date < b.date ? -1 : 1)).map((r) => `${r.date.slice(5)}:${r.mood}`).join(' ')}`);
  const recent = wins.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
  if (recent.length) { lines.push('Recent wins:'); recent.forEach((w) => lines.push(`- ${w.date}: ${w.text}`)); }
  return lines.join('\n');
}

export const _internal = { addDays, COUNTED };
