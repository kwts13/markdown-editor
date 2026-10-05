// Pipe tables rendered as real, editable tables. The note keeps plain markdown; a table is shown as a widget
// until the caret is placed inside its source (the "Source" button or a click on the raw text), and edits in
// the widget rewrite that markdown. Cells show rendered inline markdown; the cell being edited shows its raw text.
import { StateField, EditorView, Decoration, WidgetType, syntaxTree, ensureSyntaxTree } from '../vendor/codemirror.js';
import * as store from './store.js';

// ---------- markdown <-> model ----------
// model: { header: string[], aligns: ('' | 'left' | 'center' | 'right')[], rows: string[][] } (cells keep their raw markdown)
function splitRow(line) {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const cells = []; let cur = '';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '\\' && i + 1 < t.length) { cur += ch + t[i + 1]; i++; }
    else if (ch === '|') { cells.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}
export function parseTable(text) {
  const lines = text.split('\n');
  if (lines.length < 2) return null;
  const header = splitRow(lines[0]), delim = splitRow(lines[1]);
  if (!header.length || !delim.length || !delim.every(d => /^:?-+:?$/.test(d))) return null;
  const cols = header.length;
  const aligns = Array.from({ length: cols }, (_, i) => {
    const d = delim[i] || '---';
    return d.startsWith(':') ? (d.endsWith(':') ? 'center' : 'left') : d.endsWith(':') ? 'right' : '';
  });
  const rows = lines.slice(2).filter(l => l.trim()).map(l => {
    const c = splitRow(l);
    while (c.length < cols) c.push('');
    return c.slice(0, cols);
  });
  return { header, aligns, rows };
}
export function serializeTable(m) {
  const cols = m.header.length, all = [m.header, ...m.rows];
  const w = Array.from({ length: cols }, (_, c) => Math.max(3, ...all.map(r => (r[c] || '').length)));
  const pad = (s, i) => s + ' '.repeat(Math.max(0, w[i] - s.length));
  const row = r => '| ' + r.map((c, i) => pad(c || '', i)).join(' | ') + ' |';
  const dash = m.aligns.map((a, i) => (a === 'center' ? ':' + '-'.repeat(w[i] - 2) + ':' : a === 'left' ? ':' + '-'.repeat(w[i] - 1) : a === 'right' ? '-'.repeat(w[i] - 1) + ':' : '-'.repeat(w[i])));
  return [row(m.header), '| ' + dash.join(' | ') + ' |', ...m.rows.map(row)].join('\n');
}

// ---------- inline markdown in cells ----------
const INLINE = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|\b_([^_]+)_\b|~~([^~]+)~~|`([^`]+)`|\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]|\[([^\]]+)\]\((https?:[^)\s]+)\)/g;
function renderInline(parent, text) {
  const plain = s => s.replace(/\\\|/g, '|');
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) parent.append(plain(text.slice(last, m.index)));
    let node;
    if (m[1] ?? m[2]) { node = document.createElement('strong'); node.textContent = plain(m[1] ?? m[2]); }
    else if (m[3] ?? m[4]) { node = document.createElement('em'); node.textContent = plain(m[3] ?? m[4]); }
    else if (m[5]) { node = document.createElement('del'); node.textContent = plain(m[5]); }
    else if (m[6]) { node = document.createElement('code'); node.textContent = plain(m[6]); }
    else if (m[7]) {
      node = document.createElement('span');
      node.className = 'cm-wikilink' + (store.resolveNote(m[7], store.get().ui.openNoteId) || m[7].trim().startsWith('#') ? '' : ' unresolved');
      node.dataset.wikilink = m[7].trim(); node.textContent = (m[8] || m[7].replace(/^#/, '')).trim();
    } else {
      node = document.createElement('a'); node.href = m[10]; node.target = '_blank'; node.rel = 'noopener noreferrer'; node.textContent = plain(m[9]);
    }
    parent.append(node);
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.append(plain(text.slice(last)));
}

// ---------- locating rendered tables ----------
export const renderedTables = state => state.field(tablesField, false)?.tables || [];

function compute(state) {
  const tree = ensureSyntaxTree(state, state.doc.length, 60) || syntaxTree(state);
  const ro = !state.facet(EditorView.editable), sel = ro ? [] : state.selection.ranges, out = [], tables = [];
  for (let c = tree.topNode.firstChild; c; c = c.nextSibling) {
    if (c.name !== 'Table') continue;
    const { from, to } = c;
    if (state.doc.lineAt(from).from !== from || state.doc.lineAt(to).to !== to) continue;
    const text = state.doc.sliceString(from, to), model = parseTable(text);
    if (!model) continue;
    if (sel.some(r => r.from < to && r.to > from)) continue;   // caret inside: show the raw markdown
    out.push(Decoration.replace({ block: true, widget: new TableWidget(text, model, ro) }).range(from, to));
    tables.push({ from, to });
  }
  return { decos: Decoration.set(out), tables };
}
const tablesField = StateField.define({
  create: compute,
  update: (v, tr) => (tr.docChanged || tr.selection || tr.reconfigured ? compute(tr.state) : v),
  provide: f => [EditorView.decorations.from(f, v => v.decos), EditorView.atomicRanges.of(view => view.state.field(f).decos)],
});

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

class TableWidget extends WidgetType {
  constructor(text, model, ro) { super(); this.text = text; this.model = model; this.ro = ro; }
  eq(o) { return o.text === this.text && o.ro === this.ro; }
  // Edits in the widget rewrite the markdown themselves, so keep the DOM (and focus) when it already shows this text.
  updateDOM(dom) { return dom.__ro === this.ro && dom.__text === this.text; }
  ignoreEvent() { return true; }
  get estimatedHeight() { return 40 + 34 * this.model.rows.length; }

  toDOM(view) {
    const ro = this.ro, m = this.model;
    const root = el('div', 'cm-table-widget');
    root.__text = this.text; root.__ro = ro;
    const scroll = el('div', 'tbl-scroll'), table = el('table');
    scroll.append(table);
    const all = () => [m.header, ...m.rows];
    const cols = () => m.header.length;
    let cur = { r: 0, c: 0 }, selectAll = false;   // selectAll: keyboard navigation selects the cell's text, a click places the caret
    const cellEl = (r, c) => table.rows[r]?.cells[c];
    const range = () => {
      const pos = view.posAtDOM(root), ts = renderedTables(view.state);
      return ts.find(t => t.from === pos) || ts.find(t => t.from <= pos && pos <= t.to);
    };
    const commit = () => {
      const text = serializeTable(m);
      this.text = root.__text = text;
      const t = range();
      if (t && view.state.sliceDoc(t.from, t.to) !== text) view.dispatch({ changes: { from: t.from, to: t.to, insert: text }, userEvent: 'input.table' });
    };
    // leave the table for the editor: after it (dir 1) or at the end of the line before it (dir -1)
    const exit = dir => {
      const t = range(); if (!t) return;
      const doc = view.state.doc;
      if (dir > 0) {
        if (t.to === doc.length) view.dispatch({ changes: { from: doc.length, insert: '\n' }, selection: { anchor: doc.length + 1 } });
        else view.dispatch({ selection: { anchor: t.to + 1 } });
      } else view.dispatch({ selection: { anchor: Math.max(0, t.from - 1) } });
      view.focus();
    };

    const show = td => {
      td.textContent = '';
      const text = all()[+td.dataset.r][+td.dataset.c];
      if (text) renderInline(td, text); else td.append(el('span', 'tbl-empty', ' '));
    };
    const moveTo = (r, c) => {
      const row = Math.max(0, Math.min(all().length - 1, r)), col = Math.max(0, Math.min(cols() - 1, c));
      selectAll = true;
      cellEl(row, col)?.focus();
      selectAll = false;
    };
    const step = dir => {
      const i = cur.r * cols() + cur.c + dir, total = all().length * cols();
      if (i < 0) return exit(-1);
      if (i >= total) return addRow(all().length, 0);
      moveTo(Math.floor(i / cols()), i % cols());
    };
    const startEdit = td => {
      const r = +td.dataset.r, c = +td.dataset.c;
      cur = { r, c };
      const input = el('input', 'tbl-input');
      input.type = 'text'; input.value = all()[r][c]; input.spellcheck = false;
      input.setAttribute('aria-label', (r === 0 ? 'Header ' : 'Row ' + r + ', ') + 'column ' + (c + 1));
      td.textContent = ''; td.append(input); input.focus();
      if (selectAll) input.select(); else input.setSelectionRange(input.value.length, input.value.length);
      input.addEventListener('input', () => {
        const v = input.value.replace(/(?<!\\)\|/g, '\\|');      // a literal | would split the cell
        if (v !== input.value) { const p = input.selectionStart; input.value = v; input.setSelectionRange(p + 1, p + 1); }
        all()[r][c] = v;
        commit();
      });
      input.addEventListener('blur', () => { if (td.contains(input)) show(td); });
      input.addEventListener('keydown', e => {
        const k = e.key;
        if (k === 'Tab') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
        else if (k === 'Enter') { e.preventDefault(); if (e.metaKey || e.ctrlKey) addRow(r + 1, c); else if (r < all().length - 1) moveTo(r + 1, c); else exit(1); }
        else if (k === 'ArrowDown') { e.preventDefault(); if (r < all().length - 1) moveTo(r + 1, c); else exit(1); }
        else if (k === 'ArrowUp') { e.preventDefault(); if (r > 0) moveTo(r - 1, c); else exit(-1); }
        else if (k === 'Escape') { e.preventDefault(); exit(1); }
      });
    };

    const render = () => {
      table.textContent = '';
      const thead = el('thead'), tbody = el('tbody');
      all().forEach((row, r) => {
        const tr = el('tr');
        row.forEach((_, c) => {
          const td = el(r === 0 ? 'th' : 'td', 'tbl-cell');
          td.dataset.r = r; td.dataset.c = c;
          if (m.aligns[c]) td.style.textAlign = m.aligns[c];
          if (!ro) td.tabIndex = 0;
          show(td);
          tr.append(td);
        });
        (r === 0 ? thead : tbody).append(tr);
      });
      table.append(thead, tbody);
    };

    // links inside cells still work; focusing any other part of a cell edits it
    table.addEventListener('mousedown', e => {
      const w = e.target.closest?.('[data-wikilink]');
      if (w && e.button === 0 && !(!ro && document.activeElement?.closest?.('td,th') === w.closest('td,th'))) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('wikilink', { detail: { target: w.dataset.wikilink } }));
      }
    });
    table.addEventListener('focusin', e => {
      const td = e.target;
      if (!ro && td.classList?.contains('tbl-cell')) startEdit(td);
    });

    // ----- structure changes -----
    const addRow = (at, c = cur.c) => {
      m.rows.splice(Math.max(0, at - 1), 0, Array(cols()).fill(''));
      render(); commit(); moveTo(at, c);
    };
    const addCol = (at, r = cur.r) => {
      m.header.splice(at, 0, 'Column ' + (m.header.length + 1)); m.aligns.splice(at, 0, '');
      m.rows.forEach(row => row.splice(at, 0, ''));
      render(); commit(); moveTo(r, at);
    };
    const delRow = r => { if (r < 1) return; m.rows.splice(r - 1, 1); render(); commit(); moveTo(Math.min(r, all().length - 1), cur.c); };
    const delCol = c => {
      if (cols() < 2) return;
      m.header.splice(c, 1); m.aligns.splice(c, 1); m.rows.forEach(row => row.splice(c, 1));
      render(); commit(); moveTo(cur.r, Math.min(c, cols() - 1));
    };
    const setAlign = a => { m.aligns[cur.c] = m.aligns[cur.c] === a ? '' : a; render(); commit(); moveTo(cur.r, cur.c); };
    const showSource = () => { const t = range(); if (t) { view.dispatch({ selection: { anchor: t.from + 1 } }); view.focus(); } };
    const removeTable = () => {
      const t = range(); if (!t) return;
      view.dispatch({ changes: { from: t.from, to: Math.min(view.state.doc.length, t.to + 1), insert: '' }, userEvent: 'delete' });
      view.focus();
    };

    render();
    root.append(scroll);
    if (!ro) {
      const tools = el('div', 'tbl-tools');
      tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', 'Table');
      const btn = (label, title, fn) => {
        const b = el('button', null, label); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
        b.addEventListener('mousedown', e => e.preventDefault());
        b.addEventListener('click', fn);
        tools.append(b);
      };
      btn('+ Row', 'Add a row below', () => addRow(cur.r + 1));
      btn('+ Col', 'Add a column to the right', () => addCol(cur.c + 1));
      btn('− Row', 'Delete this row', () => delRow(cur.r));
      btn('− Col', 'Delete this column', () => delCol(cur.c));
      tools.append(el('span', 'tbl-sep'));
      btn('⇤', 'Align column left', () => setAlign('left'));
      btn('↔', 'Center column', () => setAlign('center'));
      btn('⇥', 'Align column right', () => setAlign('right'));
      tools.append(el('span', 'tbl-sep'));
      btn('</>', 'Edit the markdown source', showSource);
      btn('Delete', 'Delete the table', removeTable);
      root.append(tools);
    }
    return root;
  }
}

// ---------- keyboard: step into a rendered table from the editor ----------
export function focusTableCell(view, t, r, c) {
  const w = [...view.dom.querySelectorAll('.cm-table-widget')].find(x => view.posAtDOM(x) === t.from);
  w?.querySelector(`[data-r="${r}"][data-c="${c}"]`)?.focus();
}
export function focusTableEndingAt(view, pos) {
  const t = renderedTables(view.state).find(x => x.to === pos);
  if (t) focusTableCell(view, t, 0, 0);
}
export function tableDown(view) {
  const { state } = view, sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (line.number >= state.doc.lines) return false;
  const next = state.doc.line(line.number + 1), t = renderedTables(state).find(x => x.from === next.from);
  if (!t || view.moveVertically(sel, true).head <= line.to) return false;   // still moving within a wrapped line
  focusTableCell(view, t, 0, 0);
  return true;
}
export function tableUp(view) {
  const { state } = view, sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (line.number <= 1) return false;
  const prev = state.doc.line(line.number - 1), t = renderedTables(state).find(x => x.to === prev.to);
  if (!t || view.moveVertically(sel, false).head >= line.from) return false;
  focusTableCell(view, t, parseTable(state.doc.sliceString(t.from, t.to)).rows.length, 0);
  return true;
}

export const tableRendering = [tablesField];
