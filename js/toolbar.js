// Floating formatting toolbar that appears above selected text in the editor.
import { ViewPlugin, EditorView } from '../vendor/codemirror.js';
import { toggleWrap, insertLink, toggleBlock, toggleCodeBlock } from './format.js';

const BUTTONS = [
  { label: 'B', title: 'Bold (Ctrl/Cmd+B)', cls: 'tb-bold', run: v => toggleWrap(v, '**') },
  { label: 'I', title: 'Italic (Ctrl/Cmd+I)', cls: 'tb-italic', run: v => toggleWrap(v, '*') },
  { label: 'S', title: 'Strikethrough', cls: 'tb-strike', run: v => toggleWrap(v, '~~') },
  { label: '</>', title: 'Inline code', cls: 'tb-code', run: v => toggleWrap(v, '`') },
  { label: 'Link', title: 'Link', run: insertLink },
  'sep',
  { label: 'H1', title: 'Heading 1', run: v => toggleBlock(v, 'h1') },
  { label: 'H2', title: 'Heading 2', run: v => toggleBlock(v, 'h2') },
  { label: 'H3', title: 'Heading 3', run: v => toggleBlock(v, 'h3') },
  'sep',
  { label: '•', title: 'Bulleted list', run: v => toggleBlock(v, 'bullet') },
  { label: '1.', title: 'Numbered list', run: v => toggleBlock(v, 'number') },
  { label: '☐', title: 'Task list', run: v => toggleBlock(v, 'task') },
  { label: '❝', title: 'Quote', run: v => toggleBlock(v, 'quote') },
  { label: '{ }', title: 'Code block', run: toggleCodeBlock },
];

const plugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.pressed = false;
    this.el = document.createElement('div');
    this.el.className = 'sel-toolbar';
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Text formatting');
    this.el.hidden = true;
    for (const b of BUTTONS) {
      if (b === 'sep') { const s = document.createElement('span'); s.className = 'tb-sep'; this.el.append(s); continue; }
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = b.label; btn.title = b.title; btn.setAttribute('aria-label', b.title);
      if (b.cls) btn.className = b.cls;
      btn.addEventListener('click', () => { b.run(view); view.focus(); });
      this.el.append(btn);
    }
    // keep the editor selection / focus when clicking the toolbar
    this.el.addEventListener('mousedown', e => e.preventDefault());
    document.body.append(this.el);

    this.onDown = e => { if (view.dom.contains(e.target)) { this.pressed = true; this.sync(); } };
    this.onUp = () => { if (this.pressed) { this.pressed = false; this.sync(); } };
    this.onScroll = () => this.sync();
    document.addEventListener('mousedown', this.onDown);
    document.addEventListener('mouseup', this.onUp);
    view.scrollDOM.addEventListener('scroll', this.onScroll);
    window.addEventListener('resize', this.onScroll);
  }
  update(u) { if (u.selectionSet || u.docChanged || u.focusChanged || u.viewportChanged || u.geometryChanged) this.sync(); }
  sync() {
    const v = this.view, sel = v.state.selection.main;
    const show = !sel.empty && !this.pressed && v.hasFocus && v.state.facet(EditorView.editable);
    if (!show) { this.el.hidden = true; return; }
    v.requestMeasure({
      read: () => {
        const a = v.coordsAtPos(sel.from, 1), b = v.coordsAtPos(sel.to, -1);
        return a && b ? { a, b } : null;
      },
      write: m => {
        if (!m) { this.el.hidden = true; return; }
        const host = v.scrollDOM.getBoundingClientRect();
        const top = Math.min(m.a.top, m.b.top), bottom = Math.max(m.a.bottom, m.b.bottom);
        if (bottom < host.top || top > host.bottom) { this.el.hidden = true; return; }   // selection scrolled out of view
        this.el.hidden = false;
        const w = this.el.offsetWidth, h = this.el.offsetHeight;
        const mid = m.a.top === m.b.top ? (m.a.left + m.b.right) / 2 : m.b.left;
        let y = top - h - 8;
        if (y < host.top + 4) y = bottom + 8;
        this.el.style.top = Math.round(y) + 'px';
        this.el.style.left = Math.round(Math.max(host.left + 8, Math.min(host.right - w - 8, mid - w / 2))) + 'px';
      },
    });
  }
  destroy() {
    document.removeEventListener('mousedown', this.onDown);
    document.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('resize', this.onScroll);
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    this.el.remove();
  }
});

export const selectionToolbar = plugin;
