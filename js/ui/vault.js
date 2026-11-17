// vault.js: win vault list, "Pull a win", manual add, and the replay card used by every trigger.
import { h, clear, button, sheet } from '../dom.js';
import { pickWin } from '../engine.js';
import { REPLAY_LABEL, EMPTY_VAULT } from '../copy.js';

const fmt = (d) => d.slice(5).replace('-', '/') ;

/** Show a replay card. Resolves when it closes. trigger: manual|afterMiss|weekly|lowMood|random */
export function showReplay(app, trigger, wins, habits) {
  return app.dialog((done) => {
    let win = pickWin(wins, Math.random, null);
    if (!win) { done(); return; }
    const hn = new Map(habits.map((x) => [x.id, x.name]));
    app.bump(trigger === 'manual' ? 'vaultPullsManual' : 'vaultPullsAuto');
    sheet({
      title: REPLAY_LABEL[trigger] || REPLAY_LABEL.manual, onClose: done,
      build(body, close) {
        const quote = h('p', { class: 'line' });
        const meta = h('p', { class: 'muted small' });
        const paint = () => { quote.textContent = `“${win.text}”`; meta.textContent = `${win.date}${win.habitId && hn.get(win.habitId) ? ` · ${hn.get(win.habitId)}` : ''}`; };
        paint();
        body.append(h('div', { class: 'card soft' }, quote, meta));
        const row = h('div', { class: 'seg' });
        if (trigger === 'manual' && wins.length > 1) {
          row.append(button('Another', { onclick: () => { win = pickWin(wins, Math.random, win.id); app.bump('vaultPullsManual'); paint(); } }));
        }
        row.append(button('Close', { kind: 'primary', onclick: () => close('done') }));
        body.append(row);
      },
    });
  });
}

export function explainEmptyVault(app) {
  return app.dialog((done) => sheet({
    title: EMPTY_VAULT.title, onClose: done,
    build(body, close) { body.append(h('p', { text: EMPTY_VAULT.body }), button('Got it', { kind: 'primary', onclick: () => close('ok') })); },
  }));
}

function winSheet(app, d, win) {
  return sheet({
    title: win ? 'Edit win' : 'Add a win',
    build(body, close) {
      const ta = h('textarea', { 'aria-label': 'Win text', placeholder: 'Something you did that you want to remember', maxLength: 400 });
      ta.value = win ? win.text : '';
      body.append(ta);
      const row = h('div', { class: 'seg' });
      if (win) row.append(button('Delete', { onclick: async () => { await app.store.del('wins', win.id); close('del'); app.refresh(); } }));
      row.append(button('Save', { kind: 'primary', onclick: async () => {
        const text = ta.value.trim();
        if (!text) { ta.focus(); return; }
        if (win) await app.store.put('wins', { ...win, text });
        else await app.store.put('wins', { id: app.store.newId(), text, source: 'manual', date: d.today, habitId: null, tags: [], createdAt: Date.now() });
        close('save'); app.refresh();
      } }));
      body.append(row);
      setTimeout(() => ta.focus(), 50);
    },
  });
}

export async function renderVault(app, root) {
  const d = await app.data();
  clear(root);
  const hn = new Map(d.allHabits.map((x) => [x.id, x.name]));
  const wins = d.wins.slice().sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  root.append(h('h1', { text: 'Win vault' }), h('p', { class: 'muted', text: `${wins.length} ${wins.length === 1 ? 'win' : 'wins'} saved. Only you can see them.` }));
  if (!wins.length) {
    root.append(h('div', { class: 'card soft' }, h('h2', { text: EMPTY_VAULT.title }), h('p', { text: EMPTY_VAULT.body })));
  } else {
    root.append(h('div', { class: 'list', role: 'list' }, wins.map((w) => h('button', { class: 'win', type: 'button', role: 'listitem', onclick: () => winSheet(app, d, w) },
      h('span', {}, h('b', { text: w.text }), h('small', { text: `${w.date}${w.habitId && hn.get(w.habitId) ? ` · ${hn.get(w.habitId)}` : ''}${w.source === 'auto' ? ' · from a note' : ''}` }))))));
  }
  root.append(h('div', { class: 'spacer' }), h('div', { class: 'stack sticky' },
    button('Pull a win', { kind: 'primary', onclick: () => (wins.length ? showReplay(app, 'manual', wins, d.allHabits) : explainEmptyVault(app)) }),
    button('Add a win', { onclick: () => winSheet(app, d, null) })));
}
