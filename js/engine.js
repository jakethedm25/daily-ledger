// engine.js: pure functions only. No DOM, no storage, no network.
// Dates are local 'YYYY-MM-DD' strings. Streaks are always derived, never stored.
//
// Status rules:
//   done | min  -> counts as a full vote (effort-based scoring: the tiny version counts)
//   rest        -> a chosen rest day: neither a vote nor a gap (it bridges a streak)

export const COUNTED = new Set(['done', 'min']);
const pad = (n) => String(n).padStart(2, '0');

export function fmtDate(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
export function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; }

export function addDays(s, n) {
  const { y, m, d } = parseDate(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return fmtDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
/** b - a in whole days */
export function dayDiff(a, b) {
  const A = parseDate(a), B = parseDate(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
}
/** Local date for a timestamp, with the day rolling over at `rolloverHour` (default 03:00). */
export function localDate(ts, rolloverHour = 3) {
  const dt = new Date(ts);
  const s = fmtDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  return dt.getHours() < rolloverHour ? addDays(s, -1) : s;
}
export function weekday(s) { const { y, m, d } = parseDate(s); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
/** Monday of the week containing s */
export function weekStart(s) { return addDays(s, -((weekday(s) + 6) % 7)); }
/** Stable small integer for a date, used to rotate copy deterministically within a day */
export function dayIndex(s) { const { y, m, d } = parseDate(s); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); }

function bucket(map, key, val) {
  let s = map.get(key);
  if (!s) { s = new Set(); map.set(key, s); }
  s.add(val);
}

/** Build lookup structures from raw checkin rows. */
export function indexCheckins(checkins) {
  const voted = new Map(); // date -> Set(habitId)
  const rest = new Map();
  const byHabit = new Map(); // habitId -> {voted:Set(date), rest:Set(date)}
  const hb = (id) => {
    let h = byHabit.get(id);
    if (!h) { h = { voted: new Set(), rest: new Set() }; byHabit.set(id, h); }
    return h;
  };
  for (const c of checkins) {
    if (COUNTED.has(c.status)) { bucket(voted, c.date, c.habitId); hb(c.habitId).voted.add(c.date); }
    else if (c.status === 'rest') { bucket(rest, c.date, c.habitId); hb(c.habitId).rest.add(c.date); }
  }
  // A day with votes is never a rest day
  for (const d of voted.keys()) rest.delete(d);
  return { voted, rest, byHabit };
}

export function currentStreak(idx, today) {
  let d = idx.voted.has(today) ? today : addDays(today, -1);
  let n = 0;
  for (let i = 0; i < 20000; i++) {
    if (idx.voted.has(d)) n++;
    else if (!idx.rest.has(d)) break;
    d = addDays(d, -1);
  }
  return n;
}

export function bestStreak(idx) {
  const days = [...new Set([...idx.voted.keys(), ...idx.rest.keys()])].sort();
  let best = 0, run = 0, prev = null;
  for (const d of days) {
    if (!(prev && dayDiff(prev, d) === 1)) run = 0;
    if (idx.voted.has(d)) run++;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

/** "N of last 60 days": distinct days with at least one counted vote. Never resets. */
export function cumulativeDays(idx, today, window = 60) {
  let n = 0;
  for (const d of idx.voted.keys()) {
    const k = dayDiff(d, today);
    if (k >= 0 && k < window) n++;
  }
  return n;
}
export function totalDays(idx) { return idx.voted.size; }

/** Earliest of trial start and first vote. Days before it are never "gaps". */
export function startDate(idx, trialStartDate) {
  const first = [...idx.voted.keys()].sort()[0] || null;
  if (first && trialStartDate) return first < trialStartDate ? first : trialStartDate;
  return first || trialStartDate || null;
}

/** Consecutive days ending yesterday with no vote and no chosen rest. */
export function gapRun(votedHas, restHas, today, from) {
  let n = 0, d = addDays(today, -1);
  while (from && d >= from && !votedHas(d) && !restHas(d)) { n++; d = addDays(d, -1); }
  return { missed: n, runStart: n ? addDays(today, -n) : null };
}

export function missedRun(idx, today, from) {
  return gapRun((d) => idx.voted.has(d), (d) => idx.rest.has(d), today, from);
}

/**
 * Never-miss-twice: after one day with no entry for a habit, offer its tiny version.
 * Completing the tiny version counts as a full vote.
 */
export function neverMissTwice(idx, habit, today, createdDate) {
  const h = idx.byHabit.get(habit.id) || { voted: new Set(), rest: new Set() };
  if (h.voted.has(today) || h.rest.has(today)) return { offer: false, missed: 0 };
  const { missed } = gapRun((d) => h.voted.has(d), (d) => h.rest.has(d), today, createdDate);
  return { offer: missed >= 1, missed };
}

/** Setback: `afterDays` consecutive empty days, at least one counted day ever, and nothing logged today. */
export function setbackState(idx, today, from, afterDays = 3) {
  if (idx.voted.size === 0 || idx.voted.has(today)) return { triggered: false, missed: 0, runStart: null };
  const { missed, runStart } = missedRun(idx, today, from);
  return { triggered: missed >= afterDays, missed, runStart };
}

/** Facts for "what you built" (always leads copy after a gap). */
export function builtStats(idx, today, winCount) {
  return {
    last60: cumulativeDays(idx, today), total: totalDays(idx),
    best: bestStreak(idx), streak: currentStreak(idx, today), wins: winCount,
  };
}

export function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Decide whether an automatic vault replay fires.
 * event: 'open' | 'checkin' | 'mood'
 * Automatic replays are skipped while the vault has fewer than 3 wins (explain:true tells the UI to
 * show the empty-state explanation once).
 */
export function replayDecision(o) {
  const enabled = new Set(o.config.vaultReplay || []);
  let t = null;
  if (o.event === 'open') {
    if (enabled.has('afterMiss') && (o.missedRun || 0) >= 1 && o.afterMissShownDate !== o.today) t = 'afterMiss';
    else if (enabled.has('weekly') && weekStart(o.today) !== (o.lastWeeklyVaultCard ? weekStart(o.lastWeeklyVaultCard) : null)) t = 'weekly';
  } else if (o.event === 'mood') {
    if (enabled.has('lowMood') && o.mood != null && o.mood <= 2) t = 'lowMood';
  } else if (o.event === 'checkin') {
    const rng = o.rng || Math.random;
    // cap: at most one random replay per 7 sessions; when eligible, roughly a coin flip
    if (enabled.has('random') && (o.sessionsSinceRandom ?? 0) >= 7 && rng() < 0.5) t = 'random';
  }
  if (t && (o.winCount || 0) < 3) return { trigger: null, wouldHave: t, explain: true };
  return { trigger: t, explain: false };
}

export function pickWin(wins, rng = Math.random, excludeId = null) {
  const pool = wins.length > 1 && excludeId ? wins.filter((w) => w.id !== excludeId) : wins;
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

export function isBeforeNoon(hhmm) {
  const [h] = String(hhmm).split(':').map(Number);
  return h < 12;
}
