// setup.js: first-run setup with a visible progress bar (step X of N). Pausable and resumable.
import { h, clear, chip, button } from '../dom.js';
import { SETUP, EARLY_REMINDER_WARNING } from '../copy.js';
import { isBeforeNoon } from '../engine.js';
import { buildIcs } from '../io.js';
import { saveFile } from './settings.js';

const N = SETUP.steps.length;
const ANCHORS = ['breakfast', 'work', 'dinner', 'my evening wind-down'];

export async function renderSetup(app, root) {
  const d = await app.data();
  const saved = d.settings.setupProgress;
  const st = saved && !saved.done ? saved : { step: 0, done: false, draft: { habits: [{ name: '', min: '' }], anchor: '', time: app.config.reminder.time, why: '' } };
  const draft = st.draft;
  const persist = () => app.store.setSetting('setupProgress', { step: st.step, done: false, draft });
  const go = async (n) => { st.step = Math.max(0, Math.min(N - 1, n)); await persist(); await app.refresh(); };

  function paint() {
    clear(root);
    root.append(
      h('div', { class: 'field' }, h('p', { class: 'muted small', text: `Step ${st.step + 1} of ${N}: ${SETUP.steps[st.step]}` }),
        h('progress', { max: N, value: st.step + 1, 'aria-label': `Setup progress, step ${st.step + 1} of ${N}` })),
    );
    const body = h('div', { class: 'list' });
    const next = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => go(st.step + 1) }, 'Continue');
    if (st.step === 0) {
      body.append(h('h1', { text: SETUP.welcomeTitle }), h('p', { text: SETUP.welcomeBody }), h('div', { class: 'card soft' }, h('p', { text: SETUP.installTip })));
    } else if (st.step === 1) {
      body.append(h('h1', { text: SETUP.habitsTitle }), h('p', { class: 'muted', text: SETUP.habitsBody }));
      const cap = app.config.habitCap;
      const slots = h('div', { class: 'list' });
      const addBtn = button('Add another', { onclick: () => { if (draft.habits.length < cap) { draft.habits.push({ name: '', min: '' }); fill(); } } });
      let fill = () => {
        slots.replaceChildren(...draft.habits.map((hb, i) => h('div', { class: 'card' },
          h('div', { class: 'field' }, h('label', { for: `hn${i}`, text: `Habit ${i + 1}` }), h('input', { id: `hn${i}`, type: 'text', value: hb.name, maxLength: 60, placeholder: 'What you want to keep doing', oninput: (e) => { hb.name = e.target.value; gate(); } })),
          h('div', { class: 'field' }, h('label', { for: `hm${i}`, text: 'Tiny version (about 2 minutes)' }), h('input', { id: `hm${i}`, type: 'text', value: hb.min, maxLength: 80, placeholder: 'A version so small it is easy to say yes to', oninput: (e) => { hb.min = e.target.value; } })))));
      };
      const fillSlots = fill;
      fill = () => { fillSlots(); addBtn.disabled = draft.habits.length >= cap; };
      fill();
      const sug = h('div', { class: 'chips', 'aria-label': 'Ideas' }, SETUP.suggestions.map((s) => chip(s.name, { onclick: () => {
        const slot = draft.habits.find((x) => !x.name.trim()) || (draft.habits.length < cap ? (draft.habits.push({ name: '', min: '' }), draft.habits[draft.habits.length - 1]) : null);
        if (slot) { slot.name = s.name; slot.min = s.min; fill(); gate(); }
      } })));
      body.append(h('p', { class: 'muted small', text: 'Ideas to start from (tap one, then edit):' }), sug, slots);
      if (cap > 1) body.append(addBtn);
      var gate = () => { next.disabled = !draft.habits.some((x) => x.name.trim()); };
      gate();
    } else if (st.step === 2) {
      body.append(h('h1', { text: SETUP.anchorTitle }), h('p', { class: 'muted', text: SETUP.anchorBody }));
      const anchor = h('input', { id: 'anchor', type: 'text', value: draft.anchor, maxLength: 60, placeholder: 'e.g. after dinner', oninput: (e) => { draft.anchor = e.target.value; } });
      const chips = h('div', { class: 'chips' }, ANCHORS.map((a) => chip(`After ${a}`, { onclick: () => { draft.anchor = a; anchor.value = a; } })));
      const warn = h('p', { class: 'warn', role: 'alert', text: isBeforeNoon(draft.time) ? EARLY_REMINDER_WARNING : '' });
      const time = h('input', { id: 'rtime', type: 'time', value: draft.time, onchange: (e) => { draft.time = e.target.value || '20:00'; warn.textContent = isBeforeNoon(draft.time) ? EARLY_REMINDER_WARNING : ''; } });
      body.append(h('div', { class: 'field' }, h('label', { for: 'anchor', text: 'Anchor routine (after I…)' }), anchor, chips),
        h('div', { class: 'field' }, h('label', { for: 'rtime', text: 'One daily reminder at' }), time, warn));
    } else if (st.step === 3) {
      body.append(h('h1', { text: SETUP.whyTitle }), h('p', { class: 'muted', text: SETUP.whyBody }),
        h('div', { class: 'field' }, h('label', { for: 'why', text: 'My why' }), h('textarea', { id: 'why', maxLength: 200, placeholder: 'Optional', oninput: (e) => { draft.why = e.target.value; } }, draft.why)));
      next.textContent = draft.why ? 'Continue' : 'Skip for now';
    } else {
      body.append(h('h1', { text: SETUP.readyTitle }), h('p', { text: SETUP.readyBody }),
        h('div', { class: 'card' }, ...draft.habits.filter((x) => x.name.trim()).map((x) => h('p', {}, h('b', { text: x.name }), ` · tiny version: ${x.min || `2 minutes of ${x.name}`}`))),
        button('Download daily reminder (.ics)', { onclick: () => saveFile('daily-ledger.ics', buildIcs({ time: draft.time, anchor: draft.anchor, today: app.today() }), 'text/calendar') }));
      next.textContent = 'Start';
      next.onclick = finish;
    }
    const nav = h('div', { class: 'stack sticky' });
    const row = h('div', { class: 'seg' });
    if (st.step > 0) row.append(button('Back', { onclick: () => go(st.step - 1) }));
    row.append(next);
    nav.append(row, button('Save and finish later', { kind: 'quiet', onclick: async () => { await persist(); app.go('today'); } }));
    root.append(body, h('div', { class: 'spacer' }), nav);
    if (st.step === 1 && typeof gate === 'function') gate();
  }

  async function finish() {
    const hs = draft.habits.filter((x) => x.name.trim());
    let order = 0;
    for (const x of hs) {
      await app.store.put('habits', { id: app.store.newId(), name: x.name.trim(), minVersion: x.min.trim() || `2 minutes of ${x.name.trim()}`, order: order++, archived: false, createdAt: Date.now(), input: 'tap' });
    }
    await app.store.setSetting('anchor', draft.anchor.trim());
    await app.store.setSetting('identityStatement', draft.why.trim());
    await app.store.setSetting('setupProgress', { step: N - 1, done: true, draft });
    const c = JSON.parse(JSON.stringify(app.config)); c.reminder.time = draft.time || '20:00';
    await app.setConfig(c);
    app.go('today');
  }
  paint();
}
