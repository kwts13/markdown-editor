// A small popup menu that follows the caret and offers completions (used by /slash commands and [[wikilinks]]).
//   source(view) -> null, or { from, to, items: [{ title, detail?, icon?, apply(view, { from, to, arg }) }], arg? }
//   `from..to` is the typed trigger text that an item replaces.
import { ViewPlugin, EditorView, keymap, Prec } from '../vendor/codemirror.js';

export function suggest(source) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view; this.items = []; this.res = null; this.sel = 0; this.dismissed = null; this.visible = false;
      this.el = document.createElement('div');
      this.el.className = 'suggest'; this.el.setAttribute('role', 'listbox'); this.el.hidden = true;
      this.el.addEventListener('mousedown', e => e.preventDefault());   // keep the editor focused
      this.el.addEventListener('click', e => { const b = e.target.closest('.suggest-item'); if (b) this.accept(+b.dataset.i); });
      this.el.addEventListener('mousemove', e => { const b = e.target.closest('.suggest-item'); if (b && +b.dataset.i !== this.sel) this.select(+b.dataset.i, false); });
      document.body.append(this.el);
      this.onScroll = () => this.visible && this.place();
      view.scrollDOM.addEventListener('scroll', this.onScroll);
    }
    update(u) { if (u.docChanged || u.selectionSet || u.focusChanged) this.refresh(); }
    refresh() {
      const v = this.view, sel = v.state.selection.main;
      const res = v.hasFocus && sel.empty && v.state.facet(EditorView.editable) ? source(v) : null;
      if (!res) this.dismissed = null;
      if (!res || !res.items.length || this.dismissed === res.from) { this.hide(); return; }
      const same = this.res && this.res.from === res.from;
      this.res = res; this.items = res.items;
      if (!same) this.sel = 0;
      this.sel = Math.min(this.sel, this.items.length - 1);
      this.render(); this.el.hidden = false; this.visible = true; this.place();
    }
    hide() { this.el.hidden = true; this.visible = false; this.res = null; }
    render() {
      this.el.textContent = '';
      this.items.forEach((it, i) => {
        const b = document.createElement('div'); b.className = 'suggest-item' + (i === this.sel ? ' sel' : ''); b.dataset.i = i; b.setAttribute('role', 'option');
        if (it.icon) { const ic = document.createElement('span'); ic.className = 'suggest-icon'; ic.textContent = it.icon; b.append(ic); }
        const text = document.createElement('span'); text.className = 'suggest-text';
        const t = document.createElement('span'); t.className = 'suggest-title'; t.textContent = it.title; text.append(t);
        if (it.detail) { const d = document.createElement('span'); d.className = 'suggest-detail'; d.textContent = it.detail; text.append(d); }
        b.append(text); this.el.append(b);
      });
    }
    select(i, scroll = true) {
      this.sel = (i + this.items.length) % this.items.length;
      this.el.querySelectorAll('.suggest-item').forEach(b => b.classList.toggle('sel', +b.dataset.i === this.sel));
      if (scroll) this.el.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    }
    place() {
      const v = this.view;
      v.requestMeasure({
        read: () => (this.res ? v.coordsAtPos(this.res.from) : null),
        write: c => {
          if (!c || !this.visible) { if (!c) this.el.hidden = true; return; }
          this.el.hidden = false;
          const w = this.el.offsetWidth, h = this.el.offsetHeight;
          let y = c.bottom + 6;
          if (y + h > innerHeight - 8) y = Math.max(8, c.top - h - 6);
          this.el.style.top = Math.round(y) + 'px';
          this.el.style.left = Math.round(Math.max(8, Math.min(innerWidth - w - 8, c.left))) + 'px';
        },
      });
    }
    accept(i) {
      const it = this.items[i], res = this.res;
      if (!it || !res) return false;
      this.hide();
      it.apply(this.view, { from: res.from, to: res.to, arg: res.arg });
      this.view.focus();
      return true;
    }
    destroy() { this.view.scrollDOM.removeEventListener('scroll', this.onScroll); this.el.remove(); }
  });
  const active = view => { const p = view.plugin(plugin); return p && p.visible ? p : null; };
  const keys = Prec.highest(keymap.of([
    { key: 'ArrowDown', run: v => { const p = active(v); if (!p) return false; p.select(p.sel + 1); return true; } },
    { key: 'ArrowUp', run: v => { const p = active(v); if (!p) return false; p.select(p.sel - 1); return true; } },
    { key: 'Enter', run: v => { const p = active(v); return p ? p.accept(p.sel) : false; } },
    { key: 'Tab', run: v => { const p = active(v); return p ? p.accept(p.sel) : false; } },
    { key: 'Escape', run: v => { const p = active(v); if (!p) return false; p.dismissed = p.res.from; p.hide(); return true; } },
  ]));
  return [plugin, keys];
}
