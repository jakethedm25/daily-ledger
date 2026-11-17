// reflect.js: one bottom sheet after the last check-in (full mode only). Chips + 1-5 rating, optional text, skippable.
import { h, chip, button, sheet } from '../dom.js';
import { REFLECT } from '../copy.js';
import { replayDecision } from '../engine.js';
import { showReplay, explainEmptyVault } from './vault.js';

export function reflectAvailable(app, d, mode) {
  return mode === 'full' && app.config.modules.reflect && !d.reflections.some((r) => r.date === d.today);
}

export function openReflect(app, d) {
  return app.dialog((done) => {
    const picked = new Set(), next = new Set();
    let mood = null;
    const did = d.habits.filter((x) => { const c = d.checkins.find((k) => k.date === d.today && k.habitId === x.id); return c && c.status !== 'rest'; });
    const input = new Set(app.config.reflect.input);
    let lowAfter = false;
    sheet({
      title: REFLECT.title, onClose: async (why) => {
        done(why); // release the dialog queue first; the follow-up replay queues behind this sheet
        if (lowAfter) {
          const nd = await app.data();
          const dec = replayDecision({ config: app.config, event: 'mood', mood, winCount: nd.wins.length, today: nd.today });
          if (dec.trigger) showReplay(app, 'lowMood', nd.wins, nd.allHabits);
          else if (dec.explain && !nd.settings.emptyVaultExplained) { await app.store.setSetting('emptyVaultExplained', true); explainEmptyVault(app); }
        }
      },
      build(body, close) {
        if (input.has('chips')) {
          const g1 = h('div', { class: 'chips', role: 'group', 'aria-label': REFLECT.didLabel });
          const g2 = h('div', { class: 'chips', role: 'group', 'aria-label': REFLECT.nextLabel });
          const paint = () => {
            g1.replaceChildren(...did.map((x) => chip(x.name, { selected: picked.has(x.name), onclick: () => { picked.has(x.name) ? picked.delete(x.name) : picked.add(x.name); paint(); } })));
            g2.replaceChildren(...REFLECT.nextChips.map((x) => chip(x, { selected: next.has(x), onclick: () => { next.has(x) ? next.delete(x) : next.add(x); paint(); } })));
          };
          paint();
          body.append(h('div', { class: 'field' }, h('span', { class: 'lbl', text: REFLECT.didLabel }), g1), h('div', { class: 'field' }, h('span', { class: 'lbl', text: REFLECT.nextLabel }), g2));
        }
        const reframe = h('div', { class: 'field hidden' }, h('label', { for: 'reframe', text: REFLECT.reframe }));
        const ta = h('textarea', { id: 'reframe', placeholder: REFLECT.reframePlaceholder, maxLength: 400 });
        reframe.append(ta);
        let text = null;
        if (input.has('rating')) {
          const seg = h('div', { class: 'chips', role: 'group', 'aria-label': REFLECT.ratingLabel });
          const paint = () => seg.replaceChildren(...REFLECT.ratings.map((lab, i) => chip(lab, { selected: mood === i + 1, onclick: () => {
            mood = mood === i + 1 ? null : i + 1;
            reframe.classList.toggle('hidden', !(mood && mood <= 2));
            paint();
          } })));
          paint();
          body.append(h('div', { class: 'field' }, h('span', { class: 'lbl', text: REFLECT.ratingLabel }), seg), reframe);
        }
        let free = null;
        if (input.has('text')) {
          free = h('textarea', { 'aria-label': 'Optional note', placeholder: REFLECT.textPlaceholder, maxLength: 600 });
          body.append(free);
        }
        body.append(h('div', { class: 'seg' },
          button(REFLECT.skip, { onclick: () => close('skip') }),
          button(REFLECT.save, { kind: 'primary', onclick: async () => {
            text = [free && free.value.trim(), mood && mood <= 2 && ta.value.trim()].filter(Boolean).join('\n') || null;
            await app.store.put('reflections', { date: d.today, mood, chips: [...picked, ...next], text, ts: Date.now() });
            lowAfter = mood != null && mood <= 2;
            close('save');
            app.refresh();
          } })));
      },
    });
  });
}
