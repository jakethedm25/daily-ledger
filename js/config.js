// config.js: defaults, interview profile, interview->config derivation, validation, diff.
//
// Interview ID mapping (results.json -> config.json). Multi-letter answers use the `letters` array.
//   theme.mode / palette / contrast ........ E1, E2, E19   (not asked -> defaults)
//   density / textScale / handedness ....... E3, E4, E6     (E6: A right thumb, B left, C both; A wins)
//   animation .............................. A1, A3, E10   (no confetti from A1; others not asked)
//   haptics / sound ........................ E11, A1       (E11 not asked -> defaults)
//   tone / toneRotation / noLectures ....... A8 (A warm, B coach, C dry), E17 (B casual=warm,
//                                            C motivational=coach, D dry), B13, D7 (any answer -> noLectures)
//   rewardStyle (type, timing, surprise) ... A1 (B progress, E streak), A2 (F mix), A3, D8
//   habitCap / habitCapMax ................. A6 (E: start at 3, grow); max 8 unless configured
//   loopLength / firstScreen / headerLine .. A5 (F choose), A14, E12 (A checklist, C message line,
//                                            F vault win), E20
//   streakStyle / streakHideable ........... A4 (B chain, E small/subtle), D9, C10, A1
//   setbackAfterDays / modules.setback ..... A9, B17, C8, D6 (no number asked -> 3)
//   modules.reflect / reflect .............. B12 (C chips, D rating, A text, B voice), E20, A5, A11
//   vaultReplay ............................ A11 (B afterMiss, D weekly, E lowMood, F random; manual always)
//   reminder.time / mode ................... A7 (C notification at chosen time -> ics), C2, C3
//                                            (default 20:00; never default to morning; one reminder)
// Skipped or not_asked questions use DEFAULTS. Unknown keys in an imported file are ignored with a warning.

export const APP_VERSION = '1.0.0';

export const DEFAULTS = {
  schema: 1, source: 'default', locked: [],
  theme: { mode: 'auto', palette: 'calm', contrast: 'normal' },
  density: 'balanced', textScale: 1.0, handedness: 'right',
  animation: 'subtle', haptics: 'milestones', sound: 'off',
  tone: 'warm', toneRotation: ['warm', 'coach', 'dry'], noLectures: true,
  rewardStyle: { type: 'progress', timing: 'mix', surpriseRate: 0 },
  habitCap: 3, habitCapMax: 8, loopLength: 'quick', firstScreen: 'checklist', headerLine: 'rotate',
  streakStyle: 'chain', streakHideable: true, setbackAfterDays: 3,
  vaultReplay: ['manual', 'afterMiss', 'weekly', 'lowMood', 'random'],
  modules: { reflect: true, setback: true },
  reflect: { mode: 'fullOnly', input: ['chips', 'rating', 'text', 'voice'] },
  dayRolloverHour: 3, reminder: { mode: 'ics', time: '20:00' },
};

/** Jacob's profile as derived from the approved interview at the Step 0 gate. */
export const INTERVIEW_PROFILE = {
  ...JSON.parse(JSON.stringify(DEFAULTS)),
  source: 'interview', loopLength: 'choose',
};

const ENUMS = {
  'theme.mode': ['dark', 'light', 'auto', 'oled'],
  'theme.palette': ['calm', 'warm', 'mono', 'contrast', 'pastel'],
  'theme.contrast': ['normal', 'high'],
  density: ['minimal', 'balanced', 'dense'],
  handedness: ['right', 'left', 'both'],
  animation: ['none', 'subtle', 'moderate', 'rewardsOnly'],
  haptics: ['off', 'on', 'milestones'],
  sound: ['off', 'soft'],
  tone: ['warm', 'coach', 'dry', 'minimal'],
  'rewardStyle.type': ['clean', 'message', 'streak', 'progress', 'confetti'],
  'rewardStyle.timing': ['instant', 'endOfCheckin', 'milestones', 'mix'],
  loopLength: ['quick', 'full', 'choose'],
  firstScreen: ['checklist', 'bigButton', 'streak', 'win'],
  headerLine: ['message', 'vaultWin', 'rotate'],
  streakStyle: ['number', 'chain', 'ring', 'heatmap', 'hidden'],
  'reflect.mode': ['fullOnly'],
  'reminder.mode': ['ics', 'notification'],
};
const ENUM_ARRAYS = {
  toneRotation: ['warm', 'coach', 'dry', 'minimal'],
  vaultReplay: ['manual', 'afterMiss', 'lowMood', 'weekly', 'random'],
  'reflect.input': ['chips', 'rating', 'text', 'voice'],
};
const NUMBERS = {
  textScale: [0.8, 1.6], 'rewardStyle.surpriseRate': [0, 1], habitCap: [1, 12], habitCapMax: [1, 12],
  setbackAfterDays: [2, 14], dayRolloverHour: [0, 6],
};
const BOOLS = ['noLectures', 'streakHideable', 'modules.reflect', 'modules.setback'];
const OTHER = ['schema', 'source', 'locked', 'reminder.time'];
const ALL_KEYS = new Set([...Object.keys(ENUMS), ...Object.keys(ENUM_ARRAYS), ...Object.keys(NUMBERS), ...BOOLS, ...OTHER]);
const CONTAINERS = new Set(['theme', 'rewardStyle', 'modules', 'reflect', 'reminder']);

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export const clone = (v) => JSON.parse(JSON.stringify(v));

export function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o); }
export function setPath(o, p, v) {
  const ks = p.split('.'); let a = o;
  while (ks.length > 1) { const k = ks.shift(); if (!isObj(a[k])) a[k] = {}; a = a[k]; }
  a[ks[0]] = v;
}
export function flatten(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o || {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (isObj(v)) flatten(v, p, out); else out[p] = v;
  }
  return out;
}
export function mergeConfig(base, patch) {
  const out = clone(base);
  for (const [k, v] of Object.entries(patch || {})) {
    if (isObj(v) && isObj(out[k])) out[k] = mergeConfig(out[k], v);
    else out[k] = clone(v);
  }
  return out;
}
export function diffConfig(a, b) {
  const fa = flatten(a), fb = flatten(b), out = [];
  for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
    if (JSON.stringify(fa[k]) !== JSON.stringify(fb[k])) out.push({ key: k, from: fa[k], to: fb[k] });
  }
  return out;
}
export function isLocked(cfg, path) {
  return (cfg.locked || []).some((l) => path === l || path.startsWith(l + '.'));
}

/** Validate an imported/edited config. Never throws. Fills gaps from DEFAULTS; unknown keys warn and are ignored. */
export function validateConfig(input, base = DEFAULTS) {
  const errors = [], warnings = [];
  if (!isObj(input)) return { ok: false, errors: ['Config must be a JSON object.'], warnings, config: null };
  if (input.schema === undefined) warnings.push('No "schema" key; assuming schema 1.');
  else if (input.schema !== 1) errors.push(`Unsupported schema ${JSON.stringify(input.schema)} (expected 1).`);
  const flat = flatten(input);
  const patch = {};
  for (const [p, v] of Object.entries(flat)) {
    const top = p.split('.')[0];
    if (!ALL_KEYS.has(p)) {
      if (CONTAINERS.has(top) || !ALL_KEYS.has(top)) warnings.push(`Unknown key "${p}" ignored.`);
      continue;
    }
    if (p in ENUMS) { if (!ENUMS[p].includes(v)) errors.push(`${p}: "${v}" is not one of ${ENUMS[p].join(', ')}.`); else setPath(patch, p, v); }
    else if (p in ENUM_ARRAYS) {
      if (!Array.isArray(v) || !v.every((x) => ENUM_ARRAYS[p].includes(x))) errors.push(`${p}: must be a list from ${ENUM_ARRAYS[p].join(', ')}.`);
      else if (p === 'toneRotation' && v.length === 0) errors.push('toneRotation: needs at least one tone.');
      else setPath(patch, p, v);
    } else if (p in NUMBERS) {
      const [lo, hi] = NUMBERS[p];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) errors.push(`${p}: must be a number from ${lo} to ${hi}.`);
      else setPath(patch, p, v);
    } else if (BOOLS.includes(p)) { if (typeof v !== 'boolean') errors.push(`${p}: must be true or false.`); else setPath(patch, p, v); }
    else if (p === 'reminder.time') { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v))) errors.push('reminder.time: use 24-hour HH:MM.'); else setPath(patch, p, v); }
    else if (p === 'locked') { if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) errors.push('locked: must be a list of key names.'); else patch.locked = v; }
    else if (p === 'source') patch.source = String(v);
    else if (p === 'schema') patch.schema = 1;
  }
  const config = mergeConfig(base, patch);
  if (config.habitCap > config.habitCapMax) errors.push('habitCap cannot exceed habitCapMax.');
  config.schema = 1;
  return { ok: errors.length === 0, errors, warnings, config: errors.length ? null : config };
}

const UNMAPPED = ['E1', 'E2', 'E19', 'E3', 'E4', 'E10', 'E11', 'A3', 'D8', 'B13'];

/** Derive config.json from an interview results.json. Returns {config, trace, warnings, conflicts}. */
export function deriveConfig(results) {
  const ans = new Map((results.answers || []).map((a) => [a.id, a]));
  const L = (id) => {
    const a = ans.get(id);
    if (!a || a.status !== 'answered') return null;
    return a.letters && a.letters.length ? a.letters : a.answer ? [a.answer] : [];
  };
  const cfg = clone(DEFAULTS); cfg.source = 'interview';
  const trace = [], warnings = [], conflicts = [];
  const note = (key, srcs) => trace.push({ key, value: getPath(cfg, key), source: srcs.length ? srcs : ['default'] });
  const used = (ids) => ids.filter((i) => L(i));
  const letters = (id, map) => (L(id) || []).map((x) => map[x]).filter(Boolean);

  for (const id of UNMAPPED) if (L(id)) warnings.push(`${id} was answered but has no mapping; default used.`);

  // theme, density, textScale: not asked
  ['theme.mode', 'theme.palette', 'theme.contrast', 'density', 'textScale'].forEach((k) => note(k, []));

  // handedness (E6): A right, B left, C both. Right wins when listed.
  const e6 = L('E6') || [];
  if (e6.includes('A')) cfg.handedness = 'right'; else if (e6.includes('B')) cfg.handedness = 'left'; else if (e6.includes('C')) cfg.handedness = 'both';
  note('handedness', used(['E6']));

  note('animation', []); note('haptics', []); note('sound', []);

  // tone
  const found = new Set([...letters('A8', { A: 'warm', B: 'coach', C: 'dry' }), ...letters('E17', { B: 'warm', C: 'coach', D: 'dry' })]);
  const rot = ['warm', 'coach', 'dry'].filter((t) => found.has(t));
  if (rot.length) { cfg.toneRotation = rot; cfg.tone = rot[0]; }
  note('tone', used(['A8', 'E17'])); note('toneRotation', used(['A8', 'E17']));
  cfg.noLectures = true; note('noLectures', used(['D7', 'C10', 'D1']));

  // rewards
  const a1 = L('A1') || [];
  if (a1.includes('B')) cfg.rewardStyle.type = 'progress'; else if (a1.includes('E')) cfg.rewardStyle.type = 'streak';
  note('rewardStyle.type', used(['A1']));
  if ((L('A2') || []).includes('F')) cfg.rewardStyle.timing = 'mix';
  else if (L('A2')) warnings.push('A2 has letters other than F; timing left at "mix".');
  note('rewardStyle.timing', used(['A2'])); note('rewardStyle.surpriseRate', []);

  // habit cap
  note('habitCap', used(['A6'])); note('habitCapMax', used(['A6']));

  // loop and first screen
  if ((L('A5') || []).includes('F')) cfg.loopLength = 'choose';
  note('loopLength', used(['A5']));
  const e12 = L('E12') || [];
  if (e12.includes('A')) cfg.firstScreen = 'checklist';
  note('firstScreen', used(['E12']));
  const hasMsg = e12.includes('C'), hasWin = e12.includes('F');
  if (hasMsg && hasWin) cfg.headerLine = 'rotate'; else if (hasMsg) cfg.headerLine = 'message'; else if (hasWin) cfg.headerLine = 'vaultWin';
  note('headerLine', used(['E12']));

  // streak
  const a4 = L('A4') || [];
  if (a4.includes('B')) cfg.streakStyle = 'chain'; else if (a4.includes('E')) cfg.streakStyle = 'number';
  if (a4.includes('B') && a4.includes('E')) conflicts.push('A4 (B and E): chain style kept, drawn small and secondary.');
  note('streakStyle', used(['A4', 'D9', 'C10', 'A1']));
  cfg.streakHideable = true; note('streakHideable', used(['D9', 'C10', 'A1']));

  // setback / reflect
  note('setbackAfterDays', []);
  cfg.modules.setback = true; note('modules.setback', used(['A9', 'B17', 'C8', 'D6']));
  cfg.modules.reflect = true; note('modules.reflect', used(['B12', 'E20', 'A5', 'A11']));
  const inputs = letters('B12', { C: 'chips', D: 'rating', A: 'text', B: 'voice' });
  if (inputs.length) cfg.reflect.input = ['chips', 'rating', 'text', 'voice'].filter((x) => inputs.includes(x));
  note('reflect', used(['B12']));

  // vault replay
  const rp = letters('A11', { B: 'afterMiss', D: 'weekly', E: 'lowMood', F: 'random' });
  if (L('A11')) cfg.vaultReplay = ['manual', 'afterMiss', 'weekly', 'lowMood', 'random'].filter((x) => x === 'manual' || rp.includes(x));
  note('vaultReplay', used(['A11']));
  if (cfg.vaultReplay.includes('lowMood')) conflicts.push('lowMood replay needs a mood rating, which exists only in full-mode Reflect.');

  // reminder
  if ((L('A7') || []).includes('C')) cfg.reminder.mode = 'ics';
  note('reminder.mode', used(['A7'])); note('reminder.time', used(['C2', 'C3']));
  note('dayRolloverHour', []);
  return { config: cfg, trace, warnings, conflicts };
}
