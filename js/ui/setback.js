// setback.js: replaces the Today header after N empty days. Leads with what was built; one tiny next step.
import { h, chip, button, sheet } from '../dom.js';
import { setbackState, startDate, builtStats } from '../engine.js';
import { setbackCopy } from '../copy.js';

/** Evaluate and persist setback state. Returns the active, un-dismissed row or null. */
export async function evalSetback(app, d) {
  if (!app.config.modules.setback) return null;
  const from = startDate(d.idx, d.settings.trialStartDate);
  const st = setbackState(d.idx, d.today, from, app.config.setbackAfterDays);
  let row = d.setbackRow;
  if (st.triggered) {
    if (!row || row.startedAt !== st.runStart) {
      row = { key: 'state', active: true, startedAt: st.runStart, missedDays: st.missed, taskText: null, blocker: null, completedAt: null, dismissedAt: null };
      await app.store.put('setback', row);
      await app.bump('setbackTriggers');
    } else if (row.missedDays !== st.missed) { row = { ...row, missedDays: st.missed }; await app.store.put('setback', row); }
    return row.dismissedAt ? null : row;
  }
  if (row && row.active && d.idx.voted.has(d.today)) {
    await app.store.put('setback', { ...row, active: false, completedAt: Date.now() });
    await app.bump('setbackReturns');
  }
  return null;
}

export function setbackHeader(app, d, row) {
  const stats = builtStats(d.idx, d.today, d.wins.length);
  const identity = d.settings.identityStatement || '';
  const c = setbackCopy(stats, identity);
  return h('section', { class: 'card soft list', 'aria-label': 'Welcome back' },
    h('h1', { text: c.title }),
    h('p', { class: 'line', text: c.built }),
    c.why ? h('p', { text: c.why }) : null,
    h('p', { class: 'muted', text: c.intro }),
    button(c.dismiss, { kind: 'quiet', onclick: async () => { await app.store.put('setback', { ...row, dismissedAt: Date.now() }); app.refresh(); } }));
}

/** After a counted check-in during an active setback: close it out and offer the optional one-tap chips. */
export function setbackReturn(app, row, habit) {
  return app.dialog((done) => {
    app.store.put('setback', { ...row, active: false, completedAt: Date.now(), taskText: habit.minVersion || habit.name }).then(() => app.bump('setbackReturns'));
    const c = setbackCopy({ last60: 0, wins: 0, best: 0 }, '');
    sheet({
      title: c.thanks, onClose: done,
      build(body, close) {
        body.append(h('p', { class: 'muted', text: c.blockerPrompt }));
        const g = h('div', { class: 'chips' });
        c.blockerChips.forEach((x) => g.append(chip(x, { onclick: async () => {
          const cur = await app.store.get('setback', 'state');
          await app.store.put('setback', { ...cur, blocker: x });
          close('chip');
        } })));
        body.append(g, button('Skip', { onclick: () => close('skip') }));
      },
    });
  });
}
