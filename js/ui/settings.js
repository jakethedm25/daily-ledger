// settings.js: everything changeable, plus data, reminder, config import and the local-only trial view.
import { h, clear, button, sheet, toast } from '../dom.js';
import { getPath, validateConfig, diffConfig, isLocked, INTERVIEW_PROFILE, APP_VERSION } from '../config.js';
import { buildExport, validateExport, planImport, summarizeImport, toCsv, buildIcs, summaryForClaude } from '../io.js';
import { summarize, trialText } from '../metrics.js';
import { isBeforeNoon } from '../engine.js';
import { EARLY_REMINDER_WARNING } from '../copy.js';

export function saveFile(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Web Share with a file where available, else download. If sharing fails (e.g. offline), keep the file for later. */
export async function exportJson(app, pending) {
  const name = pending ? pending.name : `daily-ledger-${app.today()}.json`;
  const text = pending ? pending.text : JSON.stringify(buildExport(await app.store.snapshot()));
  const file = new File([text], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Daily Ledger backup' }); }
    catch (e) {
      if (e && e.name === 'AbortError') return false;
      await app.store.setSetting('pendingExport', { name, text });
      toast('Could not share just now. The file is kept; share it again from Settings.');
      return false;
    }
  } else saveFile(name, text, 'application/json');
  await app.store.setSetting('lastExportAt', Date.now());
  await app.store.setSetting('pendingExport', null);
  return true;
}

const field = (label, ...kids) => h('div', { class: 'field' }, h('span', { class: 'lbl', text: label }), ...kids);
const section = (title, ...rows) => [h('h2', { class: 'section-title', text: title }), h('div', { class: 'card list' }, ...rows.flat())];
let uid = 0;

function selectRow(app, label, path, options) {
  const id = `s${++uid}`;
  const cur = getPath(app.config, path);
  const sel = h('select', { id, onchange: async (e) => {
    const raw = e.target.value;
    const val = typeof cur === 'number' ? Number(raw) : raw;
    const ok = await app.updateConfig(path, val);
    if (!ok) e.target.value = String(cur); else app.refresh();
  } }, options.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(cur) }, l)));
  return h('div', { class: 'setrow' }, h('label', { class: 'grow', for: id, text: label }), sel);
}
function toggleRow(app, label, path, hint) {
  const on = !!getPath(app.config, path);
  return h('div', { class: 'setrow' }, h('span', { class: 'grow' }, label, hint ? h('small', { class: 'muted', text: ` ${hint}` }) : null),
    h('button', { class: 'switch', type: 'button', 'aria-pressed': String(on), 'aria-label': label, onclick: async () => { if (await app.updateConfig(path, !on)) app.refresh(); } }, on ? 'On' : 'Off'));
}
function listToggle(app, label, path, value) {
  const arr = getPath(app.config, path) || [];
  const on = arr.includes(value);
  return h('div', { class: 'setrow' }, h('span', { class: 'grow', text: label }),
    h('button', { class: 'switch', type: 'button', 'aria-pressed': String(on), 'aria-label': label, onclick: async () => {
      const next = on ? arr.filter((x) => x !== value) : [...arr, value];
      if (path === 'toneRotation' && !next.length) { toast('Keep at least one tone on.'); return; }
      if (await app.updateConfig(path, next)) app.refresh();
    } }, on ? 'On' : 'Off'));
}

function habitSheet(app, d, habit) {
  return sheet({
    title: habit ? 'Edit habit' : 'Add a habit',
    build(body, close) {
      const name = h('input', { type: 'text', id: 'hname', maxLength: 60, value: habit ? habit.name : '' });
      const min = h('input', { type: 'text', id: 'hmin', maxLength: 80, value: habit ? habit.minVersion : '', placeholder: 'A 2-minute version' });
      const input = h('select', { id: 'hinput' }, [['tap', 'One tap (default)'], ['note', 'Tap, then a short note'], ['number', 'Tap, then a number']].map(([v, l]) => h('option', { value: v, selected: habit && habit.input === v }, l)));
      body.append(field('Name', name), field('Tiny version', min), field('Input', input));
      const row = h('div', { class: 'seg' });
      if (habit) row.append(button('Archive', { onclick: async () => { await app.store.put('habits', { ...habit, archived: true }); close('archive'); app.refresh(); } }));
      row.append(button('Save', { kind: 'primary', onclick: async () => {
        if (!name.value.trim()) { name.focus(); return; }
        const rec = habit ? { ...habit } : { id: app.store.newId(), order: d.allHabits.reduce((a, x) => Math.max(a, x.order + 1), 0), archived: false, createdAt: Date.now() };
        rec.name = name.value.trim(); rec.minVersion = min.value.trim() || `2 minutes of ${rec.name}`; rec.input = input.value;
        await app.store.put('habits', rec); close('save'); app.refresh();
      } }));
      body.append(row);
    },
  });
}

function configImportSheet(app) {
  return sheet({
    title: 'Import interview config',
    build(body, close) {
      const ta = h('textarea', { 'aria-label': 'Config JSON', placeholder: 'Paste config.json here, or choose a file below', maxLength: 20000 });
      const file = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Choose config file' });
      file.addEventListener('change', async () => { if (file.files[0]) { ta.value = await file.files[0].text(); preview(); } });
      const out = h('div', { class: 'list' });
      const preview = () => {
        out.replaceChildren();
        let obj;
        try { obj = JSON.parse(ta.value); } catch { out.append(h('p', { class: 'warn', role: 'alert', text: 'That is not valid JSON, so nothing was changed.' })); return; }
        const v = validateConfig(obj);
        if (!v.ok) { out.append(h('p', { class: 'warn', role: 'alert', text: 'This config was rejected. Nothing was changed.' }), h('ul', {}, v.errors.map((e) => h('li', { text: e })))); return; }
        const diff = diffConfig(app.config, v.config);
        const lockedHits = diff.filter((x) => isLocked(app.config, x.key));
        if (v.warnings.length) out.append(h('ul', { class: 'muted small' }, v.warnings.map((w) => h('li', { text: w }))));
        out.append(h('p', { class: 'lbl', text: diff.length ? `${diff.length} change${diff.length === 1 ? '' : 's'}:` : 'No differences from your current settings.' }),
          h('ul', {}, diff.map((x) => h('li', { text: `${x.key}: ${JSON.stringify(x.from)} → ${JSON.stringify(x.to)}${isLocked(app.config, x.key) ? ' (locked)' : ''}` }))));
        if (lockedHits.length) out.append(h('p', { class: 'warn', text: 'Some of these are locked. Applying will change them too.' }));
        out.append(button(lockedHits.length ? 'Apply, including locked items' : 'Apply', { kind: 'primary', disabled: !diff.length, onclick: async () => {
          await app.setConfig(v.config);
          if (v.config.source === 'interview') await app.store.setSetting('interviewConfig', v.config);
          close('apply'); toast('Config applied.'); app.refresh();
        } }));
      };
      body.append(ta, file, button('Preview', { onclick: preview }), out);
    },
  });
}

function importSheet(app, imported) {
  return sheet({
    title: 'Import data',
    build: async (body, close) => {
      const cur = await app.store.snapshot();
      const mk = (mode) => {
        const s = summarizeImport(cur, imported, mode);
        return h('ul', {}, s.rows.map((r) => h('li', { text: `${r.store}: ${r.now} now → ${r.after} after` })));
      };
      body.append(h('p', { text: 'Merge adds anything missing and keeps what you have. Replace swaps everything on this device for the file.' }),
        h('p', { class: 'lbl', text: 'If you merge:' }), mk('merge'), h('p', { class: 'lbl', text: 'If you replace:' }), mk('replace'));
      const apply = async (mode) => {
        await app.store.replaceAll(planImport(await app.store.snapshot(), imported, mode));
        await app.loadConfig(); close('done'); toast(`Import complete (${mode}).`); app.go('today'); app.refresh();
      };
      body.append(h('div', { class: 'seg' }, button('Merge', { onclick: () => apply('merge') }), button('Replace', { kind: 'primary', onclick: () => apply('replace') })));
    },
  });
}

function confirmSheet(title, text, yes, onYes) {
  return sheet({ title, build(body, close) { body.append(h('p', { text }), h('div', { class: 'seg' }, button('Cancel', { onclick: () => close('no') }), button(yes, { kind: 'primary', onclick: () => { close('yes'); onYes(); } }))); } });
}

export async function renderSettings(app, root) {
  const d = await app.data();
  const cfg = app.config;
  clear(root);
  root.append(h('h1', { text: 'Settings' }));

  // Reminder
  const warn = h('p', { class: 'warn', role: 'alert', text: isBeforeNoon(cfg.reminder.time) ? EARLY_REMINDER_WARNING : '' });
  const time = h('input', { type: 'time', id: 'reminder-time', value: cfg.reminder.time, onchange: async (e) => {
    const v = e.target.value || '20:00';
    warn.textContent = isBeforeNoon(v) ? EARLY_REMINDER_WARNING : '';
    await app.updateConfig('reminder.time', v);
  } });
  const anchor = h('input', { type: 'text', id: 'anchor', maxLength: 60, value: d.settings.anchor || '', placeholder: 'e.g. after dinner', onchange: (e) => app.store.setSetting('anchor', e.target.value.trim()) });
  root.append(...section('Reminder (one only)',
    field('Time', time, warn), field('Tied to my routine: after I…', anchor),
    button('Download daily reminder (.ics)', { onclick: async () => saveFile('daily-ledger.ics', buildIcs({ time: app.config.reminder.time, anchor: await app.store.getSetting('anchor', ''), today: app.today() }), 'text/calendar') }),
    h('div', { class: 'setrow' }, h('span', { class: 'grow' }, 'Web notifications ', h('small', { class: 'muted', text: 'Best effort: only while the app is open or recently active. Off by default.' })),
      h('button', { class: 'switch', type: 'button', 'aria-pressed': String(!!d.settings.webNotify), 'aria-label': 'Web notifications', onclick: async () => {
        if (!d.settings.webNotify) {
          if (!('Notification' in window)) { toast('This browser does not support notifications.'); return; }
          const p = await Notification.requestPermission();
          if (p !== 'granted') { toast('Notifications were not allowed. The .ics reminder works without them.'); return; }
        }
        await app.store.setSetting('webNotify', !d.settings.webNotify); app.refresh();
      } }, d.settings.webNotify ? 'On' : 'Off'))));

  // Habits
  const active = d.habits, archived = d.allHabits.filter((x) => x.archived);
  const canAdd = active.length < cfg.habitCap;
  const growth = h('div', { class: 'list' });
  if (!canAdd) {
    if (cfg.habitCap < cfg.habitCapMax) growth.append(h('p', { class: 'muted small', text: `You are at your limit of ${cfg.habitCap}. Raising it is a deliberate step.` }), button(`Raise the limit to ${cfg.habitCap + 1}`, { onclick: () => confirmSheet('Raise the habit limit?', `More habits means more to keep up. You can go up to ${cfg.habitCapMax}.`, 'Raise it', async () => { await app.updateConfig('habitCap', cfg.habitCap + 1); app.refresh(); }) }));
    else growth.append(h('p', { class: 'muted small', text: `You are at the maximum of ${cfg.habitCapMax}.` }));
  } else growth.append(button('Add a habit', { onclick: () => habitSheet(app, d, null) }));
  root.append(...section(`Habits (${active.length} of ${cfg.habitCap})`,
    ...active.map((x) => h('button', { class: 'win', type: 'button', onclick: () => habitSheet(app, d, x) }, h('span', {}, h('b', { text: x.name }), h('small', { text: `Tiny version: ${x.minVersion}${x.input && x.input !== 'tap' ? ` · input: ${x.input}` : ''}` })))),
    growth,
    ...archived.map((x) => h('div', { class: 'setrow' }, h('span', { class: 'grow muted', text: `${x.name} (archived)` }), canAdd ? button('Restore', { onclick: async () => { await app.store.put('habits', { ...x, archived: false }); app.refresh(); } }) : null))));

  // Check-in
  root.append(...section('Check-in',
    selectRow(app, 'Loop length', 'loopLength', [['quick', 'Quick only'], ['full', 'Full only'], ['choose', 'Choose each day']]),
    selectRow(app, 'Streak style', 'streakStyle', [['chain', 'Chain'], ['number', 'Number'], ['ring', 'Ring'], ['heatmap', 'Last 14 days'], ['hidden', 'Hidden']]),
    selectRow(app, 'Header line', 'headerLine', [['rotate', 'Rotate'], ['message', 'Short line'], ['vaultWin', 'Vault win']]),
    selectRow(app, 'Day starts at', 'dayRolloverHour', [0, 1, 2, 3, 4, 5, 6].map((n) => [n, `${String(n).padStart(2, '0')}:00`])),
    field('My why', h('input', { type: 'text', id: 'why', maxLength: 200, value: d.settings.identityStatement || '', placeholder: 'Shown when coming back after a gap', onchange: (e) => app.store.setSetting('identityStatement', e.target.value.trim()) }))));

  // Modules
  root.append(...section('Modules',
    toggleRow(app, 'Setback (welcome-back card)', 'modules.setback'),
    selectRow(app, 'Show it after', 'setbackAfterDays', [2, 3, 4, 5, 7].map((n) => [n, `${n} days`])),
    toggleRow(app, 'Reflect (full mode only)', 'modules.reflect')));
  root.append(...section('Vault replays',
    h('p', { class: 'muted small', text: 'The Pull a win button is always available.' }),
    listToggle(app, 'After a day off', 'vaultReplay', 'afterMiss'), listToggle(app, 'Once a week', 'vaultReplay', 'weekly'),
    listToggle(app, 'On a low mood rating', 'vaultReplay', 'lowMood'), listToggle(app, 'Now and then', 'vaultReplay', 'random')));

  // Look and feel
  root.append(...section('Look and feel',
    selectRow(app, 'Theme', 'theme.mode', [['auto', 'Match device'], ['light', 'Light'], ['dark', 'Dark'], ['oled', 'Black (OLED)']]),
    selectRow(app, 'Palette', 'theme.palette', [['calm', 'Calm'], ['warm', 'Warm'], ['mono', 'Mono'], ['contrast', 'High contrast'], ['pastel', 'Pastel']]),
    selectRow(app, 'Contrast', 'theme.contrast', [['normal', 'Normal'], ['high', 'High']]),
    selectRow(app, 'Density', 'density', [['minimal', 'Minimal'], ['balanced', 'Balanced'], ['dense', 'Dense']]),
    selectRow(app, 'Text size', 'textScale', [[0.9, 'Small'], [1, 'Default'], [1.15, 'Large'], [1.3, 'Larger']]),
    selectRow(app, 'Thumb side', 'handedness', [['right', 'Right hand'], ['left', 'Left hand'], ['both', 'Both hands']]),
    selectRow(app, 'Animation', 'animation', [['subtle', 'Subtle'], ['moderate', 'Moderate'], ['rewardsOnly', 'Rewards only'], ['none', 'None']]),
    selectRow(app, 'Haptics', 'haptics', [['milestones', 'Milestones'], ['on', 'Every tap'], ['off', 'Off']]),
    selectRow(app, 'Sound', 'sound', [['off', 'Off'], ['soft', 'Soft']]),
    selectRow(app, 'Main tone', 'tone', [['warm', 'Warm'], ['coach', 'Coach'], ['dry', 'Dry humor'], ['minimal', 'Minimal']]),
    listToggle(app, 'Rotate: warm', 'toneRotation', 'warm'), listToggle(app, 'Rotate: coach', 'toneRotation', 'coach'), listToggle(app, 'Rotate: dry humor', 'toneRotation', 'dry')));

  // Data
  const last = d.settings.lastExportAt ? new Date(d.settings.lastExportAt).toLocaleDateString() : 'never';
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden', id: 'import-file', 'aria-label': 'Choose backup file' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; if (!f) return;
    let obj; try { obj = JSON.parse(await f.text()); } catch { toast('That file is not valid JSON. Nothing was changed.'); return; }
    const v = validateExport(obj);
    if (!v.ok) { sheet({ title: 'Cannot import this file', build(b, c) { b.append(h('ul', {}, v.errors.map((e) => h('li', { text: e }))), button('Close', { onclick: () => c('x') })); } }); return; }
    importSheet(app, obj); fileIn.value = '';
  });
  root.append(...section('Your data',
    h('p', { class: 'muted small', text: `Last export: ${last}. Everything stays on this device unless you export it.` }),
    d.settings.pendingExport ? button('Share the saved export again', { onclick: async () => { if (await exportJson(app, d.settings.pendingExport)) app.refresh(); } }) : null,
    button('Export everything (JSON)', { kind: 'primary', onclick: async () => { if (await exportJson(app)) app.refresh(); } }),
    button('Export check-ins (CSV)', { onclick: () => saveFile(`daily-ledger-checkins-${app.today()}.csv`, toCsv(d.checkins, d.allHabits), 'text/csv') }),
    button('Import a backup…', { onclick: () => fileIn.click() }), fileIn,
    button('Copy summary for Claude', { onclick: async () => {
      const text = summaryForClaude({ habits: d.allHabits, checkins: d.checkins, wins: d.wins, reflections: d.reflections, today: d.today });
      try { await navigator.clipboard.writeText(text); toast('Summary copied. Paste it wherever you like.'); }
      catch { sheet({ title: 'Copy this summary', build(b, c) { b.append(h('pre', { class: 'out', text }), button('Close', { onclick: () => c('x') })); } }); }
    } })));

  // Config
  root.append(...section('Interview config',
    button('Import interview config…', { onclick: () => configImportSheet(app) }),
    button('Reset to my interview profile', { onclick: () => confirmSheet('Reset to your interview profile?', 'Your settings go back to what the interview produced. Your data is not touched.', 'Reset', async () => { await app.setConfig(JSON.parse(JSON.stringify(d.settings.interviewConfig || INTERVIEW_PROFILE))); toast('Settings reset.'); app.refresh(); }) }),
    h('p', { class: 'muted small', text: `Source: ${cfg.source}. Locked: ${cfg.locked.length ? cfg.locked.join(', ') : 'nothing'}.` })));

  // Trial (local only)
  const notes = d.checkins.filter((c) => c.note).length;
  const sum = summarize({ sessions: await app.store.all('sessions'), trialStartDate: d.settings.trialStartDate, today: d.today, counters: d.settings.counters || {}, notesAdded: notes, reflectCompletions: d.reflections.length });
  const text = trialText(sum, d.today);
  root.append(...section('Trial (this device only)',
    h('p', {}, h('b', { text: `${sum.daysOpened} of ${sum.daysSince}` }), ' days opened since the trial began. ', h('b', { text: `Median session ${sum.medianSeconds}s.` })),
    sum.flags.length ? h('p', { class: 'warn', text: sum.flags.join(' ') }) : h('p', { class: 'muted small', text: 'No flags.' }),
    h('p', { class: 'muted small', text: `Setback shown ${sum.counts.setbackTriggers}, returns ${sum.counts.setbackReturns}. Reflect completions ${sum.counts.reflectCompletions}. Vault pulls: ${sum.counts.vaultPullsManual} manual, ${sum.counts.vaultPullsAuto} automatic. Notes added ${sum.counts.notesAdded}.` }),
    h('ul', { class: 'small', 'aria-label': 'Last 14 days' }, sum.last14.map((x) => h('li', { text: `${x.date}: ${x.opened ? `opened${x.sessions > 1 ? ` ×${x.sessions}` : ''}, ${x.seconds}s` : 'not opened'}` }))),
    button('Copy trial summary', { onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Trial summary copied.'); } catch { sheet({ title: 'Trial summary', build(b, c) { b.append(h('pre', { class: 'out', text }), button('Close', { onclick: () => c('x') })); } }); } } })));

  // App
  let persisted = 'unknown';
  try { if (navigator.storage && navigator.storage.persisted) persisted = (await navigator.storage.persisted()) ? 'protected' : 'standard'; } catch { /* ignore */ }
  root.append(...section('App',
    h('p', { class: 'small' }, `Version ${APP_VERSION}. Storage: ${persisted}. Works offline.`),
    h('p', { class: 'muted small', text: 'Install to your Home Screen before entering data. iPhone Home Screen apps keep their own storage, separate from Safari. Home-screen widgets are not possible for web apps, so the icon is your launch point.' }),
    app.updateReady ? button('Update now', { kind: 'primary', onclick: () => app.applyUpdate() }) : button('Check for update', { onclick: async () => { await app.checkUpdate(); toast(app.updateReady ? 'An update is ready.' : 'You are up to date.'); app.refresh(); } })));
}
