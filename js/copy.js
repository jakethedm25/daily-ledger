// copy.js: every user-facing sentence about progress, gaps and returns.
// Rules (hard): no shame, no red, no "lost/failed/broke", no lectures, never foreground a lost number.
// Lead with what was built, then offer one tiny next step. Compare only to Jacob's past self.
// Suggest, don't command. Tone rotates warm / coach / dry. tests/engine.test.js scans this file's output.

export const TONES = ['warm', 'coach', 'dry'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const dayName = (i) => DAYS[i];

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Pick the tone for a given day from the rotation (deterministic within a day). */
export function toneForDay(config, dayIdx) {
  const rot = config.toneRotation && config.toneRotation.length ? config.toneRotation : [config.tone || 'warm'];
  if (config.tone === 'minimal') return 'minimal';
  return rot[((dayIdx % rot.length) + rot.length) % rot.length];
}

/**
 * Short motivational line anchored in real history.
 * facts: { last60, total, streak, best, wins, weekdayName, weekdayCount, habitName, habitCount }
 */
export function headerMessage(tone, f, pick = 0) {
  const T = [];
  const add = (cond, s) => { if (cond) T.push(s); };
  if (tone === 'minimal') { return f.last60 ? `${f.last60} of the last 60 days.` : 'Ready when you are.'; }
  if (tone === 'warm') {
    add(f.last60 > 0, `${f.last60} of the last 60 days are on your record. That is real.`);
    add(f.weekdayCount > 0, `${ordinal(f.weekdayCount + 1)} ${f.weekdayName} check-in, whenever you are ready.`);
    add(f.wins > 0, `${plural(f.wins, 'win', 'wins')} saved so far. They are yours to revisit.`);
    add(f.habitCount > 0, `${f.habitName}: ${plural(f.habitCount, 'time', 'times')} so far. Quietly adding up.`);
    add(true, 'A small step today is a full step.');
  } else if (tone === 'coach') {
    add(f.last60 > 0, `${f.last60} of the last 60 days counted. Today can add one more.`);
    add(f.best > 1, `Best streak so far: ${f.best}. A good first move is the easiest habit on the list.`);
    add(f.weekdayCount > 0, `${f.weekdayName} number ${f.weekdayCount + 1} is available.`);
    add(f.habitCount > 0, `${f.habitName} is at ${f.habitCount}. One tap moves it.`);
    add(true, 'Tiny versions count the same. Pick whichever fits the energy you have.');
  } else {
    add(f.total > 0, `${plural(f.total, 'day', 'days')} on the board. The board has no complaints.`);
    add(f.weekdayCount > 0, `${f.weekdayName} again. You have shown up for ${f.weekdayCount} of these already.`);
    add(f.habitCount > 0, `${f.habitName}, ${plural(f.habitCount, 'time', 'times')} so far. Nobody is counting, except this app.`);
    add(f.wins > 0, `${plural(f.wins, 'win', 'wins')} in the vault. Stored safely, no interest charged.`);
    add(true, 'Two-minute versions are legal here.');
  }
  return T[((pick % T.length) + T.length) % T.length];
}

export const REPLAY_LABEL = {
  manual: 'From your vault',
  afterMiss: 'A win from your own record, before the tiny version',
  weekly: 'A new week. One from your vault',
  lowMood: 'A rough one to log. Here is one from your vault',
  random: 'A win from your vault',
};

export const EMPTY_VAULT = {
  title: 'Your win vault starts with notes',
  body: 'Wins come from notes. Add a short note when you check in (long-press a habit, or tap the note icon) and it lands here. Once there are 3 wins, the vault can replay one for you.',
};

/** Tiny-version offer (never-miss-twice). Counts as a full vote. */
export function tinyOffer(tone, { minVersion, missed }) {
  const head = missed >= 2 ? 'Welcome back.' : 'A day off is just a day off.';
  const body = {
    warm: `Your tiny version is enough today: ${minVersion}`,
    coach: `Here is a good re-entry: ${minVersion}. It counts as a full check-in.`,
    dry: `Tiny version available: ${minVersion}. Counts exactly the same.`,
    minimal: `Tiny version: ${minVersion}`,
  }[tone] || `Tiny version: ${minVersion}`;
  return { head, body };
}

/** Setback copy. Leads with what was built. */
export function setbackCopy(stats, identity) {
  const built = [
    `${plural(stats.last60, 'day', 'days')} counted in the last 60`,
    `${plural(stats.wins, 'win', 'wins')} saved`,
    `best streak ${stats.best}`,
  ].join(' · ');
  return {
    title: 'Welcome back.',
    built,
    why: identity ? `Your why: ${identity}` : null,
    intro: 'Here are a few tiny ways back in. Any one of them counts as a full check-in.',
    blockerPrompt: 'Optional: what got in the way?',
    blockerChips: ['Busy day', 'Low energy', 'Out of routine', 'Travel', 'Rest or recovery', 'Just slipped my mind'],
    dismiss: 'Not today',
    thanks: 'Noted. It is on your record: you are back.',
  };
}

export const REFLECT = {
  title: 'A quick look back',
  didLabel: 'What I did',
  nextLabel: 'What is next',
  nextChips: ['Same again tomorrow', 'Tiny versions only', 'A rest day', 'Add one thing'],
  ratingLabel: 'Mood (1 to 5)',
  ratings: ['1 Low', '2 Down', '3 Okay', '4 Good', '5 Great'],
  textPlaceholder: 'Optional: a line or two (dictation works from the keyboard)',
  reframe: "What's a more accurate way to say that?",
  reframePlaceholder: 'Optional. Skip any time.',
  save: 'Save',
  skip: 'Skip',
  saved: 'Saved.',
};

export function milestoneCopy(tone, n) {
  return {
    warm: `${n} days counted. That milestone is on your record for good.`,
    coach: `${n} days counted. A solid base to build on.`,
    dry: `${n} days counted. The board is pleased.`,
    minimal: `${n} days counted.`,
  }[tone] || `${n} days counted.`;
}

export const SETUP = {
  steps: ['Welcome', 'Habits', 'Anchor and reminder', 'Your why', 'Ready'],
  welcomeTitle: 'Daily Ledger',
  welcomeBody: 'A private check-in that keeps a record of what you built. Everything stays on this phone. Setup takes a few minutes, and everything can be changed later in Settings.',
  installTip: 'Tip: add this to your Home Screen before entering data. On iPhone, the Home Screen app keeps its own storage, separate from Safari.',
  habitsTitle: 'Pick up to 3 habits',
  habitsBody: 'Each gets a tiny two-minute version that still counts as a full check-in.',
  anchorTitle: 'Anchor and reminder',
  anchorBody: 'Tie the check-in to something you already do. One reminder only, at a time you choose.',
  whyTitle: 'Your why (optional)',
  whyBody: 'A line you would like to see on a harder day. Skip it if you like.',
  readyTitle: 'Ready',
  readyBody: 'You can start now. The reminder file adds one daily alert to your calendar.',
  suggestions: [
    { name: 'Move my body', min: 'Put on shoes and do 5 minutes' },
    { name: 'Focus practice', min: 'One minute of quiet breathing' },
    { name: 'Tidy one thing', min: 'Put away a single item' },
    { name: 'Learn something', min: 'Read one page' },
  ],
};

export const EARLY_REMINDER_WARNING = 'That is before noon. Mornings tend to be the least friendly time, so a later time may stick better.';
export const FIRST_OPEN = 'Tap a habit when it is done. The tiny version counts the same.';
