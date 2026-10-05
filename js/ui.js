// Small UI helpers: toast, confirm dialog, folder picker dialog, context menu.
const $ = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let toastTimer;
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

function modal(build) {
  return new Promise(resolve => {
    const d = $('dialog', 'modal');
    const form = $('form'); form.method = 'dialog';
    d.append(form);
    const finish = v => { if (d.open) d.close(); };
    build(form, v => { d._result = v; finish(); });
    d.addEventListener('close', () => { d.remove(); resolve(d._result); });
    document.body.append(d);
    d.showModal();
  });
}

export function confirmDialog({ title, message, okLabel = 'OK', danger = false }) {
  const prev = document.activeElement;
  return modal((form, done) => {
    form.append($('h2', null, title), $('p', null, message));
    const row = $('div', 'modal-actions');
    const cancel = $('button', 'btn', 'Cancel'); cancel.type = 'button'; cancel.autofocus = true;
    const ok = $('button', 'btn ' + (danger ? 'danger' : 'primary'), okLabel); ok.type = 'button';
    cancel.onclick = () => done(false); ok.onclick = () => done(true);
    row.append(cancel, ok); form.append(row);
    setTimeout(() => cancel.focus(), 0);
  }).then(v => { prev && prev.isConnected && prev.focus?.(); return !!v; });
}

// options: [{id, label, level, disabled}]; resolves {id} or undefined if cancelled
export function folderPicker({ title, options }) {
  const prev = document.activeElement;
  return modal((form, done) => {
    form.append($('h2', null, title));
    const list = $('div', 'picker'); list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Destination folder');
    let first = null;
    for (const o of options) {
      const b = $('button', 'picker-item', o.label); b.type = 'button';
      b.setAttribute('role', 'option');
      b.style.paddingLeft = (12 + o.level * 16) + 'px';
      if (o.disabled) { b.disabled = true; b.title = 'Not available'; }
      else { b.onclick = () => done({ id: o.id }); if (!first) first = b; }
      list.append(b);
    }
    list.addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [...list.querySelectorAll('button:not(:disabled)')];
      const i = items.indexOf(document.activeElement);
      const n = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      n && n.focus(); e.preventDefault();
    });
    const row = $('div', 'modal-actions');
    const cancel = $('button', 'btn', 'Cancel'); cancel.type = 'button'; cancel.onclick = () => done(undefined);
    row.append(cancel); form.append(list, row);
    setTimeout(() => (first || cancel).focus(), 0);
  }).then(v => { prev && prev.isConnected && prev.focus?.(); return v; });
}

let menuEl = null;
export function closeMenu(restore = true) {
  if (!menuEl) return;
  const { el, prev } = menuEl; menuEl = null;
  el.remove();
  document.removeEventListener('mousedown', outside, true);
  window.removeEventListener('blur', onWinBlur);
  if (restore && prev && prev.isConnected) prev.focus();
}
const outside = e => { if (menuEl && !menuEl.el.contains(e.target)) closeMenu(false); };
const onWinBlur = () => closeMenu(false);

export function showMenu(x, y, items) {
  closeMenu(false);
  const prev = document.activeElement;
  const el = $('div', 'menu'); el.setAttribute('role', 'menu');
  for (const it of items) {
    if (it.sep) { const s = $('div', 'menu-sep'); s.setAttribute('role', 'separator'); el.append(s); continue; }
    const b = $('button', 'menu-item' + (it.danger ? ' danger' : ''), it.label); b.type = 'button'; b.setAttribute('role', 'menuitem');
    if (it.hint) { const h = $('span', 'hint', it.hint); b.append(h); }
    b.onclick = () => { closeMenu(false); prev && prev.isConnected && prev.focus(); it.action(); };
    el.append(b);
  }
  el.addEventListener('keydown', e => {
    const bs = [...el.querySelectorAll('button')];
    const i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { bs[(i + 1) % bs.length].focus(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { bs[(i - 1 + bs.length) % bs.length].focus(); e.preventDefault(); }
    else if (e.key === 'Escape') { closeMenu(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'Tab') { closeMenu(); e.preventDefault(); }
  });
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  menuEl = { el, prev };
  document.addEventListener('mousedown', outside, true);
  window.addEventListener('blur', onWinBlur);
  el.querySelector('button')?.focus();
}
