// Run with: node tests/engine.test.js   (plain node, no dependencies)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../js/engine.js';
import * as K from '../js/config.js';
import * as IO from '../js/io.js';
import * as M from '../js/metrics.js';
import * as C from '../js/copy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok   ${name}`); } catch (e) { fail++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, msg = 'expected truthy') => { if (!v) throw new Error(msg); };
const ck = (date, habitId = 'h1', status = 'done') => ({ date, habitId, status });
const T = '2026-11-16';
const habit = { id: 'h1', name: 'Walk', minVersion: 'Shoes on' };

console.log('engine: dates and rollover');
test('addDays/dayDiff across month and DST-free math', () => { eq(E.addDays('2026-11-30', 1), '2026-12-01'); eq(E.addDays('2026-03-01', -1), '2026-02-28'); eq(E.dayDiff('2026-11-01', '2026-11-16'), 15); });
test('day rolls over at 03:00 by default', () => {
  eq(E.localDate(new Date(2026, 10, 16, 2, 59).getTime()), '2026-11-15');
  eq(E.localDate(new Date(2026, 10, 16, 3, 0).getTime()), '2026-11-16');
  eq(E.localDate(new Date(2026, 10, 16, 23, 59).getTime()), '2026-11-16');
});
test('rollover hour is configurable', () => { eq(E.localDate(new Date(2026, 10, 16, 4, 59).getTime(), 5), '2026-11-15'); eq(E.localDate(new Date(2026, 10, 16, 1, 0).getTime(), 0), '2026-11-16'); });
test('weekStart is Monday', () => { eq(E.weekStart('2026-11-16'), '2026-11-16'); eq(E.weekStart('2026-11-22'), '2026-11-16'); eq(E.weekStart('2026-11-15'), '2026-11-09'); });

console.log('engine: streaks and cumulative days');
test('cumulative "N of last 60" counts distinct counted days in window', () => {
  const idx = E.indexCheckins([ck('2026-11-16'), ck('2026-11-16', 'h2'), ck('2026-11-10'), ck('2026-09-18'), ck('2026-09-17'), ck('2026-11-12', 'h1', 'rest')]);
  eq(E.cumulativeDays(idx, T), 3); // 11-16, 11-10, 09-18 (59 days ago); 09-17 is 60 days ago, outside
  eq(E.totalDays(idx), 4);
});
test('tiny version (min) counts as a full vote', () => { eq(E.cumulativeDays(E.indexCheckins([ck(T, 'h1', 'min')]), T), 1); });
test('current streak; ending yesterday still counts', () => {
  eq(E.currentStreak(E.indexCheckins([ck('2026-11-14'), ck('2026-11-15'), ck(T)]), T), 3);
  eq(E.currentStreak(E.indexCheckins([ck('2026-11-14'), ck('2026-11-15')]), T), 2);
  eq(E.currentStreak(E.indexCheckins([ck('2026-11-10')]), T), 0);
});
test('rest day bridges a streak without counting', () => { const idx = E.indexCheckins([ck('2026-11-13'), ck('2026-11-14', 'h1', 'rest'), ck('2026-11-15')]); eq(E.currentStreak(idx, '2026-11-15'), 2); });
test('best streak', () => { eq(E.bestStreak(E.indexCheckins([ck('2026-10-01'), ck('2026-10-02'), ck('2026-10-03'), ck('2026-10-10'), ck('2026-10-11')])), 3); });
test('streak is derived, never stored (pure function of rows)', () => { const rows = [ck('2026-11-15'), ck(T)]; eq(E.currentStreak(E.indexCheckins(rows), T), 2); eq(E.currentStreak(E.indexCheckins(rows.slice(0, 1)), T), 1); });

console.log('engine: never-miss-twice');
test('offer after exactly one missed day', () => {
  const idx = E.indexCheckins([ck('2026-11-13'), ck('2026-11-14')]);
  const r = E.neverMissTwice(idx, habit, '2026-11-16', '2026-11-10');
  eq(r.offer, true); eq(r.missed, 1);
});
test('no offer when yesterday had a vote, or when the habit was created today', () => {
  eq(E.neverMissTwice(E.indexCheckins([ck('2026-11-15')]), habit, T, '2026-11-10').offer, false);
  eq(E.neverMissTwice(E.indexCheckins([]), habit, T, T).offer, false);
});
test('no offer once today is already logged; completing the tiny version counts as a vote', () => {
  const idx = E.indexCheckins([ck('2026-11-14'), ck(T, 'h1', 'min')]);
  eq(E.neverMissTwice(idx, habit, T, '2026-11-10').offer, false);
  eq(E.cumulativeDays(idx, T), 2);
});
test('days before the habit existed are never gaps', () => { eq(E.neverMissTwice(E.indexCheckins([]), habit, T, '2026-11-15').missed, 1); eq(E.neverMissTwice(E.indexCheckins([]), habit, T, '2026-11-16').missed, 0); });

console.log('engine: setback');
test('triggers after N empty days (default 3), shows run start', () => {
  const idx = E.indexCheckins([ck('2026-11-10'), ck('2026-11-12')]);
  const s = E.setbackState(idx, T, '2026-11-01', 3);
  eq(s.triggered, true); eq(s.missed, 3); eq(s.runStart, '2026-11-13');
});
test('does not trigger at 2 empty days, with a vote today, or with no history', () => {
  const idx = E.indexCheckins([ck('2026-11-13')]);
  eq(E.setbackState(idx, T, '2026-11-01', 3).triggered, false);
  eq(E.setbackState(E.indexCheckins([ck('2026-11-12'), ck(T)]), T, '2026-11-01', 3).triggered, false);
  eq(E.setbackState(E.indexCheckins([]), T, '2026-11-01', 3).triggered, false);
});
test('configurable threshold and a chosen rest day breaks the gap', () => {
  const idx = E.indexCheckins([ck('2026-11-10')]);
  eq(E.setbackState(idx, T, '2026-11-01', 5).triggered, true);
  eq(E.setbackState(idx, T, '2026-11-01', 7).triggered, false);
  const idx2 = E.indexCheckins([ck('2026-11-10'), ck('2026-11-14', 'h1', 'rest')]);
  eq(E.setbackState(idx2, T, '2026-11-01', 3).triggered, false);
});
test('built stats lead the setback copy', () => {
  const idx = E.indexCheckins([ck('2026-11-08'), ck('2026-11-09'), ck('2026-11-10')]);
  const b = E.builtStats(idx, T, 4);
  eq([b.last60, b.best, b.wins], [3, 3, 4]);
});

console.log('engine: vault replay triggers');
const allCfg = { vaultReplay: ['manual', 'afterMiss', 'weekly', 'lowMood', 'random'] };
const base = { config: allCfg, winCount: 5, today: T };
test('afterMiss fires on first open after a gap, once per day, only when enabled', () => {
  eq(E.replayDecision({ ...base, event: 'open', missedRun: 1, lastWeeklyVaultCard: T }).trigger, 'afterMiss');
  eq(E.replayDecision({ ...base, event: 'open', missedRun: 1, afterMissShownDate: T, lastWeeklyVaultCard: T }).trigger, null);
  eq(E.replayDecision({ ...base, config: { vaultReplay: ['manual'] }, event: 'open', missedRun: 1 }).trigger, null);
});
test('weekly shows once per week (Monday start)', () => {
  eq(E.replayDecision({ ...base, event: 'open', missedRun: 0, lastWeeklyVaultCard: '2026-11-10' }).trigger, 'weekly');
  eq(E.replayDecision({ ...base, event: 'open', missedRun: 0, lastWeeklyVaultCard: '2026-11-16' }).trigger, null);
  eq(E.replayDecision({ ...base, today: '2026-11-22', event: 'open', missedRun: 0, lastWeeklyVaultCard: '2026-11-16' }).trigger, null);
  eq(E.replayDecision({ ...base, today: '2026-11-23', event: 'open', missedRun: 0, lastWeeklyVaultCard: '2026-11-16' }).trigger, 'weekly');
});
test('lowMood fires only for ratings 1-2 and only when enabled', () => {
  eq(E.replayDecision({ ...base, event: 'mood', mood: 1 }).trigger, 'lowMood');
  eq(E.replayDecision({ ...base, event: 'mood', mood: 2 }).trigger, 'lowMood');
  eq(E.replayDecision({ ...base, event: 'mood', mood: 3 }).trigger, null);
  eq(E.replayDecision({ ...base, config: { vaultReplay: ['manual'] }, event: 'mood', mood: 1 }).trigger, null);
});
test('random respects the 1-in-7 cap, the rng, and the switch', () => {
  eq(E.replayDecision({ ...base, event: 'checkin', sessionsSinceRandom: 6, rng: () => 0 }).trigger, null);
  eq(E.replayDecision({ ...base, event: 'checkin', sessionsSinceRandom: 7, rng: () => 0.1 }).trigger, 'random');
  eq(E.replayDecision({ ...base, event: 'checkin', sessionsSinceRandom: 7, rng: () => 0.9 }).trigger, null);
  eq(E.replayDecision({ ...base, config: { vaultReplay: ['manual', 'afterMiss'] }, event: 'checkin', sessionsSinceRandom: 20, rng: () => 0 }).trigger, null);
  eq(E.replayDecision({ ...base, event: 'open', missedRun: 0, lastWeeklyVaultCard: T, sessionsSinceRandom: 20, rng: () => 0 }).trigger, null);
});
test('fewer than 3 wins skips automatic replays and asks for the one-time explanation', () => {
  const r = E.replayDecision({ ...base, winCount: 2, event: 'mood', mood: 1 });
  eq(r.trigger, null); eq(r.explain, true);
  eq(E.replayDecision({ ...base, winCount: 2, event: 'mood', mood: 5 }).explain, false);
});
test('pickWin returns an existing win and avoids repeating the last one', () => {
  const wins = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  ok(wins.includes(E.pickWin(wins, () => 0.5)));
  eq(E.pickWin(wins, () => 0, 'a').id, 'b');
  eq(E.pickWin([], () => 0), null);
});

console.log('config: derivation from results.json (ID mapping, multi-letter answers)');
const fixture = JSON.parse(read('tests/fixtures/results.json'));
const derived = K.deriveConfig(fixture);
test('derived config matches the approved gate table', () => {
  const c = derived.config;
  eq(c.handedness, 'right'); eq(c.toneRotation, ['warm', 'coach', 'dry']); eq(c.tone, 'warm'); eq(c.noLectures, true);
  eq(c.rewardStyle, { type: 'progress', timing: 'mix', surpriseRate: 0 });
  eq([c.habitCap, c.habitCapMax], [3, 8]); eq(c.loopLength, 'choose'); eq(c.firstScreen, 'checklist'); eq(c.headerLine, 'rotate');
  eq(c.streakStyle, 'chain'); eq(c.streakHideable, true); eq(c.setbackAfterDays, 3);
  eq(c.modules, { reflect: true, setback: true }); eq(c.reflect, { mode: 'fullOnly', input: ['chips', 'rating', 'text', 'voice'] });
  eq(c.vaultReplay, ['manual', 'afterMiss', 'weekly', 'lowMood', 'random']);
  eq(c.reminder, { mode: 'ics', time: '20:00' }); eq(c.dayRolloverHour, 3); eq(c.theme, { mode: 'auto', palette: 'calm', contrast: 'normal' });
});
test('multi-letter answers use the whole letters array, not the primary letter', () => {
  const only = (id, letters) => ({ answers: [{ id, answer: letters[0], letters, status: 'answered' }] });
  eq(K.deriveConfig(only('A11', ['B', 'F'])).config.vaultReplay, ['manual', 'afterMiss', 'random']);
  eq(K.deriveConfig(only('A11', ['E'])).config.vaultReplay, ['manual', 'lowMood']);
  eq(K.deriveConfig(only('A8', ['C', 'B'])).config.toneRotation, ['coach', 'dry']);
  eq(K.deriveConfig(only('E6', ['C'])).config.handedness, 'both');
  eq(K.deriveConfig(only('E12', ['A', 'F'])).config.headerLine, 'vaultWin');
  eq(K.deriveConfig(only('B12', ['C'])).config.reflect.input, ['chips']);
});
test('skipped / not_asked questions fall back to defaults', () => {
  const c = K.deriveConfig({ answers: [{ id: 'A11', answer: null, letters: [], status: 'not_asked' }] }).config;
  eq(c.vaultReplay, K.DEFAULTS.vaultReplay); eq(c.handedness, 'right'); eq(c.reminder.time, '20:00');
  ok(derived.trace.find((t) => t.key === 'theme.mode').source[0] === 'default');
});
test('trace cites source IDs; conflicts are listed', () => {
  eq(derived.trace.find((t) => t.key === 'vaultReplay').source, ['A11']);
  eq(derived.trace.find((t) => t.key === 'handedness').source, ['E6']);
  ok(derived.conflicts.length >= 1);
});
test('config/default.json and config/interview.json mirror config.js (no drift)', () => {
  eq(JSON.parse(read('config/default.json')), K.DEFAULTS); eq(JSON.parse(read('config/interview.json')), K.INTERVIEW_PROFILE);
  eq({ ...derived.config, source: 'interview' }, K.INTERVIEW_PROFILE);
});

console.log('config: import validation');
test('valid file merges onto defaults and fills gaps', () => {
  const v = K.validateConfig({ schema: 1, theme: { mode: 'dark' }, vaultReplay: ['manual'], locked: ['tone'] });
  ok(v.ok); eq(v.config.theme, { mode: 'dark', palette: 'calm', contrast: 'normal' }); eq(v.config.vaultReplay, ['manual']); eq(v.config.habitCapMax, 8);
});
test('invalid values are rejected with clear messages', () => {
  const v = K.validateConfig({ schema: 1, tone: 'loud', textScale: 9, reminder: { time: '8pm' }, vaultReplay: ['nope'] });
  eq(v.ok, false); ok(v.errors.length === 4, `errors: ${v.errors.join(' | ')}`); ok(/tone/.test(v.errors[0]));
});
test('unknown keys warn and are ignored; bad schema and non-objects are rejected', () => {
  const v = K.validateConfig({ schema: 1, bogus: 1, theme: { sparkle: true } });
  ok(v.ok); eq(v.warnings.length, 2); eq('bogus' in v.config, false);
  eq(K.validateConfig({ schema: 2 }).ok, false); eq(K.validateConfig([]).ok, false); eq(K.validateConfig(null).ok, false);
});
test('habitCap cannot exceed habitCapMax; diff and locked helpers', () => {
  eq(K.validateConfig({ schema: 1, habitCap: 9, habitCapMax: 5 }).ok, false);
  eq(K.diffConfig({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } }), [{ key: 'b.c', from: 2, to: 3 }]);
  ok(K.isLocked({ locked: ['theme'] }, 'theme.mode')); ok(!K.isLocked({ locked: ['theme'] }, 'tone'));
});
test('every key in the schema is accepted by validateConfig', () => {
  const v = K.validateConfig(JSON.parse(JSON.stringify(K.INTERVIEW_PROFILE)));
  ok(v.ok, v.errors.join(' | ')); eq(v.warnings.length, 0);
});

console.log('copy rules');
const BANNED = /\b(lost|failed|fail|fails|broke|broken|shame|shameful|guilt|guilty|lazy|behind|streak lost)\b/i;
const strings = [];
const sample = { last60: 12, total: 20, streak: 3, best: 6, wins: 4, weekdayName: 'Tuesday', weekdayCount: 11, habitName: 'Walk', habitCount: 9 };
for (const tone of ['warm', 'coach', 'dry', 'minimal']) {
  for (let i = 0; i < 6; i++) { strings.push(C.headerMessage(tone, sample, i)); strings.push(C.headerMessage(tone, { ...sample, last60: 0, total: 0, wins: 0, weekdayCount: 0, habitCount: 0, best: 0 }, i)); }
  for (const missed of [1, 2, 5]) { const o = C.tinyOffer(tone, { minVersion: 'Shoes on', missed }); strings.push(o.head, o.body); }
  strings.push(C.milestoneCopy(tone, 30));
}
strings.push(...Object.values(C.REPLAY_LABEL), C.EMPTY_VAULT.title, C.EMPTY_VAULT.body, C.FIRST_OPEN, C.EARLY_REMINDER_WARNING);
const sb = C.setbackCopy({ last60: 9, wins: 3, best: 5 }, 'Be steady'); strings.push(sb.title, sb.built, sb.why, sb.intro, sb.blockerPrompt, sb.dismiss, sb.thanks, ...sb.blockerChips);
strings.push(...Object.values(C.REFLECT).flat(), ...Object.values(C.SETUP).flat().flatMap((x) => (typeof x === 'object' ? Object.values(x) : [x])));
test('no banned words in any generated copy (lost, failed, broke, shame, ...)', () => { for (const s of strings) ok(!BANNED.test(s), `banned word in: ${s}`); });
test('copy never uses command language or scoring of "how you did"', () => { for (const s of strings) ok(!/\byou (must|should|need to|have to)\b/i.test(s) && !/\bscore\b/i.test(s), `command/score in: ${s}`); });
test('source scan: no banned words in js/ outside comments', () => {
  const files = ['js', 'js/ui'].flatMap((d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.js')).map((f) => path.join(d, f)));
  for (const f of files) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
    const m = code.match(BANNED); ok(!m, `${f}: "${m && m[0]}"`);
  }
});
test('setback copy leads with what was built and offers a tiny step; no red/colour words', () => {
  ok(sb.built.startsWith('9 days counted')); ok(/tiny/i.test(sb.intro));
  const css = read('css/app.css'); ok(!/\b(red|#f00|#ff0000|crimson)\b/i.test(css), 'no red in css');
});
test('header messages are anchored in real facts', () => { ok(/12th Tuesday|Tuesday number 12|shown up for 11/.test(C.headerMessage('warm', sample, 1) + C.headerMessage('coach', sample, 2) + C.headerMessage('dry', sample, 1))); eq(C.ordinal(12), '12th'); eq(C.ordinal(21), '21st'); });
test('tone rotates through the configured packs by day', () => { const cfg = { tone: 'warm', toneRotation: ['warm', 'coach', 'dry'] }; eq([0, 1, 2, 3].map((i) => C.toneForDay(cfg, i)), ['warm', 'coach', 'dry', 'warm']); });

console.log('io: export / import / csv / ics / backup / summary');
const snap = {
  habits: [{ id: 'h1', name: 'Walk', minVersion: 'Shoes on', order: 0, archived: false, createdAt: 1 }],
  checkins: [{ date: '2026-11-15', habitId: 'h1', status: 'done', note: 'felt good', ts: 5 }, { date: T, habitId: 'h1', status: 'min', note: null, ts: 9 }],
  wins: [{ id: 'auto-2026-11-15-h1', text: 'felt good', source: 'auto', date: '2026-11-15', habitId: 'h1', tags: [], createdAt: 5 }],
  reflections: [{ date: '2026-11-15', mood: 2, chips: ['Walk'], text: null, ts: 6 }],
  settings: [{ key: 'config', value: K.INTERVIEW_PROFILE }, { key: 'lastExportAt', value: 100 }, { key: 'trialStartDate', value: '2026-11-13' }],
  setback: [{ key: 'state', active: false, startedAt: '2026-11-10', missedDays: 3, taskText: 'Shoes on', blocker: 'Busy day', completedAt: 7, dismissedAt: null }],
  sessions: [{ id: 1, date: T, startTs: 1000, endTs: 31000, seconds: 30, interacted: true }, { id: 2, date: T, startTs: 90000, endTs: 150000, seconds: 60, interacted: true }],
};
test('export then import (replace) on a clean profile reproduces identical data', () => {
  const exp = JSON.parse(JSON.stringify(IO.buildExport(snap, 123)));
  const v = IO.validateExport(exp); ok(v.ok, v.errors.join()); eq(v.summary.checkins, 2);
  const empty = Object.fromEntries(IO.STORES.map((s) => [s, []]));
  eq(IO.planImport(empty, exp, 'replace'), snap);
});
test('merge is idempotent and keeps newer check-ins', () => {
  const exp = IO.buildExport(snap, 1);
  eq(IO.planImport(snap, exp, 'merge').checkins.length, 2); eq(IO.planImport(snap, exp, 'merge').sessions.length, 2);
  const newer = JSON.parse(JSON.stringify(exp)); newer.stores.checkins[0].status = 'min'; newer.stores.checkins[0].ts = 99;
  eq(IO.planImport(snap, newer, 'merge').checkins.find((c) => c.date === '2026-11-15').status, 'min');
});
test('import rejects non-ledger files and malformed rows with clear errors', () => {
  eq(IO.validateExport({ app: 'other', schema: 1, stores: {} }).ok, false);
  eq(IO.validateExport({ app: 'daily-ledger', schema: 3, stores: {} }).ok, false);
  eq(IO.validateExport({ app: 'daily-ledger', schema: 1, stores: { checkins: [{ date: 1 }] } }).ok, false);
  eq(IO.validateExport('x').ok, false);
});
test('CSV escapes quotes/commas and neutralises formulas', () => {
  const csv = IO.toCsv([{ date: T, habitId: 'h1', status: 'done', note: '=SUM(A1), "hi"' }], snap.habits);
  ok(csv.startsWith('date,habit,status,note\n')); ok(csv.includes('"\'=SUM(A1), ""hi"""'));
});
test('.ics: one daily reminder at 20:00 by default, floating time, CRLF', () => {
  const ics = IO.buildIcs({ today: T, anchor: 'dinner', now: Date.UTC(2026, 10, 16) });
  ok(ics.includes('DTSTART:20261116T200000')); ok(ics.includes('RRULE:FREQ=DAILY')); ok(ics.includes('TRIGGER:PT0M')); ok(ics.includes('\r\n')); ok(ics.includes('After dinner'));
  eq((ics.match(/BEGIN:VEVENT/g) || []).length, 1); ok(IO.buildIcs({ today: T, time: '19:30' }).includes('T193000'));
});
test('reminder before noon is flagged', () => { eq(E.isBeforeNoon('09:00'), true); eq(E.isBeforeNoon('11:59'), true); eq(E.isBeforeNoon('12:00'), false); eq(E.isBeforeNoon('20:00'), false); });
test('weekly backup nudge: >7 days, once per day', () => {
  const now = Date.UTC(2026, 10, 16), day = 86400000;
  eq(IO.backupNudgeDue({ lastExportAt: now - 8 * day, now, today: T }), true);
  eq(IO.backupNudgeDue({ lastExportAt: now - 6 * day, now, today: T }), false);
  eq(IO.backupNudgeDue({ lastExportAt: now - 8 * day, lastBackupNudgeAt: T, now, today: T }), false);
  eq(IO.backupNudgeDue({ lastExportAt: null, installedAt: now - 9 * day, now, today: T }), true);
  eq(IO.backupNudgeDue({ lastExportAt: null, installedAt: now - 2 * day, now, today: T }), false);
});
test('"Copy summary for Claude" is plain text built from local data', () => {
  const t = IO.summaryForClaude({ habits: snap.habits, checkins: snap.checkins, wins: snap.wins, reflections: snap.reflections, today: T });
  ok(t.includes('Walk: 2 of the last 30 days')); ok(t.includes('felt good'));
});

console.log('metrics: seeded fake sessions');
test('summary matches seeded sessions (days opened, median, flags, counts)', () => {
  const mk = (date, seconds) => ({ date, startTs: 1, endTs: 2, seconds, interacted: true });
  const sessions = [mk('2026-11-13', 20), mk('2026-11-14', 40), mk('2026-11-14', 60), mk('2026-11-15', 80), mk('2026-11-16', 100)];
  const s = M.summarize({ sessions, trialStartDate: '2026-11-13', today: T, counters: { setbackTriggers: 1, setbackReturns: 1, vaultPullsManual: 2, vaultPullsAuto: 3 }, notesAdded: 4, reflectCompletions: 2 });
  eq(s.daysOpened, 4); eq(s.daysSince, 4); eq(s.medianSeconds, 60); eq(s.last14.length, 4); eq(s.opened14, 4); eq(s.flags, []);
  eq(s.counts, { setbackTriggers: 1, setbackReturns: 1, reflectCompletions: 2, vaultPullsManual: 2, vaultPullsAuto: 3, notesAdded: 4 });
  ok(M.trialText(s, T).includes('Median session: 60s'));
});
test('flags: fewer than 10 of 14 days (by pace) and median over 90s', () => {
  const mk = (date, seconds) => ({ date, startTs: 1, endTs: 2, seconds, interacted: true });
  const s = M.summarize({ sessions: [mk('2026-11-03', 120), mk('2026-11-10', 200)], trialStartDate: '2026-11-03', today: T });
  ok(s.flags.some((f) => /pace under 10 of 14/.test(f))); ok(s.flags.some((f) => /over 90s/.test(f))); eq(s.medianSeconds, 160);
});
test('no session data is transmitted: no network APIs anywhere in js/', () => {
  const files = ['js', 'js/ui'].flatMap((d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.js')).map((f) => path.join(d, f)));
  for (const f of files) { const code = read(f); ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/.test(code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), `${f} uses a network API`); ok(!/https?:\/\//.test(code.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), `${f} has a URL`); }
});

console.log('pwa: manifest, service worker, files');
test('manifest valid: standalone, relative start_url, icons incl. maskable with real sizes', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  eq(m.display, 'standalone'); ok(m.name && m.short_name && m.start_url === './' && m.scope === './'); ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) { const b = fs.readFileSync(path.join(root, i.src)); eq(b.readUInt32BE(16), parseInt(i.sizes, 10), `${i.src} width`); eq(b.readUInt32BE(20), parseInt(i.sizes, 10), `${i.src} height`); }
});
test('sw.js precaches every shipped file; versions agree', () => {
  const sw = read('sw.js');
  const list = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((x) => x !== './');
  const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const shipped = ['index.html', 'manifest.webmanifest', ...walk('css'), ...walk('js'), ...walk('config'), ...walk('icons')].sort();
  eq(list.slice().sort(), shipped);
  eq(sw.match(/const VERSION = '([^']+)'/)[1], K.APP_VERSION);
  ok(/clients\.claim/.test(sw)); ok(!/self\.skipWaiting\(\);\s*\}\);\s*self\.addEventListener\('activate/.test(sw), 'must not skipWaiting on install'); ok(/SKIP_WAITING/.test(sw));
});
test('index.html: strict CSP, no external hosts, module entry', () => {
  const html = read('index.html'); ok(/Content-Security-Policy/.test(html)); ok(!/https?:\/\//.test(html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, ''))); ok(/type="module" src="js\/main\.js"/.test(html)); ok(!/style="/.test(html));
});

console.log('a11y: colour contrast of every palette (WCAG)');
function lum(hex) { const n = parseInt(hex.slice(1), 16); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function palettes() {
  const css = read('css/app.css'); const out = {};
  for (const m of css.matchAll(/\[data-palette=(\w+)\]\[data-scheme=(light|dark)\]\{([^}]*)\}/g)) out[`${m[1]}-${m[2]}`] = Object.fromEntries([...m[3].matchAll(/--([\w-]+):(#[0-9a-f]{6})/g)].map((x) => [x[1], x[2]]));
  const oledBase = Object.fromEntries([...css.match(/\[data-scheme=oled\]\{([^}]*)\}/)[1].matchAll(/--([\w-]+):(#[0-9a-f]{6})/g)].map((x) => [x[1], x[2]]));
  for (const m of css.matchAll(/\[data-scheme=oled\]\[data-palette=(\w+)\]\{([^}]*)\}/g)) out[`${m[1]}-oled`] = { ...oledBase, ...Object.fromEntries([...m[2].matchAll(/--([\w-]+):(#[0-9a-f]{6})/g)].map((x) => [x[1], x[2]])) };
  return out;
}
test('text pairs >= 4.5:1 and UI accents >= 3:1 in all 15 palette/scheme combos', () => {
  const P = palettes(); eq(Object.keys(P).length, 15);
  const bad = [];
  for (const [name, p] of Object.entries(P)) {
    const pairs = [['text', 'bg', 4.5], ['text', 'surface', 4.5], ['text', 'soft', 4.5], ['muted', 'bg', 4.5], ['muted', 'surface', 4.5], ['muted', 'soft', 4.5], ['on-accent', 'accent', 4.5], ['accent', 'bg', 3], ['accent', 'surface', 3], ['border', 'bg', 1.2]];
    for (const [a, b, min] of pairs) { if (!p[a] || !p[b]) { bad.push(`${name}: missing ${a}/${b}`); continue; } const r = ratio(p[a], p[b]); if (r < min) bad.push(`${name}: ${a} on ${b} = ${r.toFixed(2)} (<${min})`); }
  }
  ok(!bad.length, bad.join('; '));
});
test('reduced motion and layout rules present in CSS', () => {
  const css = read('css/app.css');
  ok(/prefers-reduced-motion: reduce[\s\S]*animation:none!important/.test(css)); ok(/--target:56px/.test(css)); ok(/env\(safe-area-inset-bottom\)/.test(css)); ok(/data-hand=left/.test(css));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
