// dom.js: tiny DOM helpers, bottom sheet, toast. No framework. No inline style attributes (strict CSP).

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list' && typeof v !== 'object' && !k.startsWith('aria') && k !== 'role') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

let sheetCount = 0;
export const sheetOpen = () => sheetCount > 0;

/** Bottom sheet. Dismiss by scrim tap, swipe down, Escape, or the returned close(). */
export function sheet({ title, build, onClose, label }) {
  const root = document.getElementById('overlay-root');
  const prevFocus = document.activeElement;
  const scrim = h('div', { class: 'scrim' });
  const body = h('div', { class: 'sheet-body' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label || title || 'Dialog', tabindex: '-1' },
    h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    title ? h('h2', { class: 'sheet-title', text: title }) : null,
    body);
  let closed = false;
  function close(reason) {
    if (closed) return; closed = true; sheetCount--;
    scrim.classList.add('out'); panel.classList.add('out');
    const done = () => { scrim.remove(); panel.remove(); if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch { /* ignore */ } };
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.anim === 'none';
    if (still) done(); else setTimeout(done, 180);
    if (onClose) onClose(reason);
  }
  scrim.addEventListener('click', () => close('scrim'));
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close('esc'); });
  // swipe down to dismiss (only when the sheet is scrolled to the top)
  let y0 = null, dy = 0;
  panel.addEventListener('touchstart', (e) => { y0 = body.scrollTop <= 0 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  panel.addEventListener('touchmove', (e) => { if (y0 != null) dy = e.touches[0].clientY - y0; }, { passive: true });
  panel.addEventListener('touchend', () => { if (y0 != null && dy > 70) close('swipe'); y0 = null; });
  sheetCount++;
  root.append(scrim, panel);
  build(body, close);
  panel.focus({ preventScroll: true });
  return { close, panel, body };
}

let toastTimer = null;
export function toast(msg, { action, onAction, ms = 5000 } = {}) {
  const root = document.getElementById('overlay-root');
  const old = root.querySelector('.toast'); if (old) old.remove();
  clearTimeout(toastTimer);
  const t = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }, h('span', { text: msg }),
    action ? h('button', { class: 'toast-btn', type: 'button', text: action, onclick: () => { t.remove(); if (onAction) onAction(); } }) : null);
  root.append(t);
  toastTimer = setTimeout(() => t.remove(), ms);
  return t;
}

export function chip(label, { selected = false, onclick } = {}) {
  return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(selected), onclick }, h('span', { class: 'chip-mark', 'aria-hidden': 'true', text: selected ? '✓' : '+' }), label);
}
export function button(label, { kind = 'secondary', onclick, disabled = false, ariaLabel } = {}) {
  return h('button', { class: `btn btn-${kind}`, type: 'button', onclick, disabled, 'aria-label': ariaLabel }, label);
}
