// Properties: a YAML front-matter block at the very top of a note, edited through typed fields.
// The note stays plain markdown; the panel is just a widget over the `---` ... `---` block.
import { StateField, EditorState, EditorView, Decoration, WidgetType } from '../vendor/codemirror.js';

// ---------- locating the block ----------
// Only counted when the body looks like properties, so a stray later "---" divider isn't swallowed.
const PROP_LINE = /^(\s*$|[^\s:#][^:]*:(\s.*)?$|\s+\S.*|-\s.*|#.*)/;
export function frontmatter(doc) {
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== '---') return null;
  for (let n = 2; n <= doc.lines; n++) {
    const t = doc.line(n).text.trimEnd();
    if (t === '---' || t === '...') return { first: 1, last: n, from: 0, to: doc.line(n).to };
    if (!PROP_LINE.test(t)) return null;
  }
  return null;
}
export const frontmatterBody = (doc, fm) => (fm.last > 2 ? doc.sliceString(doc.line(2).from, doc.line(fm.last - 1).to) : '');

// ---------- YAML subset <-> rows ----------
// row: { key, type: 'text'|'list'|'number'|'checkbox'|'date', value }
// value: string (text/number/date), boolean (checkbox), string[] (list)
const LIST_KEYS = new Set(['tags', 'aliases', 'cssclasses']);
const KEY_RE = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s:#"'\-\[\]{},&*!|>%@`?][^:]*?)\s*:(?:\s+(.*))?$/;

function unquote(s) {
  s = s.trim();
  if (s.length > 1 && s[0] === '"' && s.endsWith('"')) { try { return JSON.parse(s); } catch (_) { return s.slice(1, -1); } }
  if (s.length > 1 && s[0] === "'" && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return null;
}
function scalar(s) {
  const q = unquote(s);
  if (q !== null) return { type: 'text', value: q };
  if (s === 'true' || s === 'false') return { type: 'checkbox', value: s === 'true' };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { type: 'number', value: s };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { type: 'date', value: s };
  if (s === 'null' || s === '~') return { type: 'text', value: '' };
  return { type: 'text', value: s };
}
function flowItems(s) {
  const items = []; let cur = '', quote = '';
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") { quote = ch; cur += ch; }
    else if (ch === ',') { items.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim() || items.length) items.push(cur);
  return items.map(i => i.trim()).filter(Boolean).map(i => { const q = unquote(i); return q !== null ? q : i; });
}

// Returns rows, or null when the block uses YAML we don't model (nested maps, comments, multiline...).
export function parseProps(body) {
  const lines = body.split('\n'), rows = [], seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const m = KEY_RE.exec(line.trimEnd());
    if (!m) return null;
    const key = unquote(m[1]) ?? m[1].trim();
    if (seen.has(key)) return null;
    seen.add(key);
    const val = (m[2] ?? '').trim();
    if (val === '') {
      const items = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const im = /^\s*-(?:\s+(.*))?$/.exec(lines[j]);
        if (!im) break;
        const t = (im[1] ?? '').trim();
        const q = unquote(t);
        items.push(q !== null ? q : t);
      }
      if (items.length) { rows.push({ key, type: 'list', value: items }); i = j - 1; }
      else rows.push(LIST_KEYS.has(key) ? { key, type: 'list', value: [] } : { key, type: 'text', value: '' });
    } else if (val[0] === '[') {
      if (!val.endsWith(']')) return null;
      rows.push({ key, type: 'list', value: flowItems(val.slice(1, -1)) });
    } else if (/^[{|>&*!]/.test(val)) return null;
    else rows.push({ key, ...scalar(val) });
  }
  return rows;
}

function quoteText(s) {
  if (s === '') return '';
  const risky = /^\s|\s$/.test(s) || /[:#]\s|\s#|:$/.test(s) || /^[-?:,\[\]{}#&*!|>'"%@`]/.test(s) || /[\n\r]/.test(s) ||
    /^(true|false|null|~|yes|no|on|off)$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s);
  return risky ? JSON.stringify(s) : s;
}
const quoteKey = k => (/^[A-Za-z0-9_][^:#"'\n]*$/.test(k) ? k : JSON.stringify(k));

const dupKeys = rows => {
  const count = new Map();
  for (const r of rows) { const k = r.key.trim(); if (k) count.set(k, (count.get(k) || 0) + 1); }
  return count;
};

export function serializeProps(rows) {
  const out = ['---'], count = dupKeys(rows), done = new Set();
  for (const r of rows) {
    const k = r.key.trim();
    if (!k || done.has(k)) continue;           // blank or duplicate names are kept in the panel but not written
    done.add(k);
    const key = quoteKey(k);
    if (r.type === 'list') {
      if (!r.value.length) out.push(`${key}: []`);
      else { out.push(`${key}:`); for (const it of r.value) out.push(`  - ${quoteText(it)}`); }
    } else if (r.type === 'checkbox') out.push(`${key}: ${r.value ? 'true' : 'false'}`);
    else if (r.type === 'number') out.push(r.value === '' ? `${key}:` : `${key}: ${r.value}`);
    else if (r.type === 'date') out.push(r.value === '' ? `${key}:` : `${key}: ${r.value}`);
    else out.push(r.value === '' ? `${key}:` : `${key}: ${quoteText(r.value)}`);
  }
  out.push('---');
  return out.join('\n');
}

function convert(row, type) {
  const v = row.value;
  const str = Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? String(v) : v;
  let value;
  if (type === 'list') value = Array.isArray(v) ? v : typeof v === 'boolean' ? [] : String(v).split(',').map(s => s.trim()).filter(Boolean);
  else if (type === 'checkbox') value = typeof v === 'boolean' ? v : /^(true|yes|1)$/i.test(str);
  else if (type === 'number') { const n = parseFloat(str); value = Number.isFinite(n) && !Array.isArray(v) && typeof v !== 'boolean' ? String(n) : ''; }
  else if (type === 'date') value = /^\d{4}-\d{2}-\d{2}$/.test(str) && !Array.isArray(v) ? str : '';
  else value = str;
  return { ...row, type, value };
}

// ---------- the widget ----------
const svg = d => `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const TYPES = {
  text: { label: 'Text', icon: svg('<path d="M2.5 4h11M2.5 8h11M2.5 12h7"/>') },
  list: { label: 'List', icon: svg('<path d="M6 4h7.5M6 8h7.5M6 12h7.5"/><circle cx="2.7" cy="4" r=".6"/><circle cx="2.7" cy="8" r=".6"/><circle cx="2.7" cy="12" r=".6"/>') },
  number: { label: 'Number', icon: svg('<path d="M6 2.5 5 13.5M11 2.5l-1 11M2.5 6h11.5M2 10h11.5"/>') },
  checkbox: { label: 'Checkbox', icon: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="m5.5 8 2 2 3-4"/>') },
  date: { label: 'Date', icon: svg('<rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 7h11M5.5 2v3M10.5 2v3"/>') },
};
let focusNewRow = false;   // set right after a block is created so its first key box gets focus

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

class PropsWidget extends WidgetType {
  constructor(text, rows, ro) { super(); this.text = text; this.rows = rows; this.ro = ro; }
  // Edits made in the panel update the doc to match this.text, so the rebuilt widget compares equal
  // and CodeMirror keeps this DOM (and focus) instead of re-rendering.
  eq(o) { return o.text === this.text && o.ro === this.ro; }
  ignoreEvent() { return true; }

  toDOM(view) {
    const ro = this.ro, rows = this.rows;
    const root = el('div', 'props');
    const head = el('div', 'props-head');
    head.append(el('span', 'props-title', 'Properties'));
    if (!ro) {
      const rm = el('button', 'props-remove', 'Remove'); rm.type = 'button'; rm.title = 'Remove all properties';
      rm.addEventListener('click', () => {
        const fm = frontmatter(view.state.doc);
        if (fm) view.dispatch({ changes: { from: 0, to: Math.min(view.state.doc.length, fm.to + 1), insert: '' }, userEvent: 'delete' });
        view.focus();
      });
      head.append(rm);
    }
    const list = el('div', 'props-rows');
    const empty = el('div', 'props-empty', 'No properties yet');
    root.append(head, list, empty);

    const commit = () => {
      const text = serializeProps(rows);
      this.text = text;
      const fm = frontmatter(view.state.doc);
      if (fm && view.state.sliceDoc(0, fm.to) !== text) view.dispatch({ changes: { from: 0, to: fm.to, insert: text }, userEvent: 'input.properties' });
      refresh();
    };
    const refresh = () => {
      empty.hidden = rows.length > 0;
      const count = dupKeys(rows);
      list.querySelectorAll('.props-key').forEach((inp, i) => {
        const k = rows[i] && rows[i].key.trim();
        const bad = !!k && count.get(k) > 1;
        inp.classList.toggle('invalid', bad); inp.title = bad ? 'Another property already uses this name' : '';
      });
    };

    const controlFor = row => {
      const box = el('div', 'props-value');
      if (row.type === 'checkbox') {
        const c = el('input', 'props-check'); c.type = 'checkbox'; c.checked = !!row.value; c.disabled = ro;
        c.setAttribute('aria-label', row.key || 'value');
        c.addEventListener('change', () => { row.value = c.checked; commit(); });
        box.append(c);
      } else if (row.type === 'list') {
        const chips = el('div', 'props-chips');
        const input = el('input', 'props-chip-input'); input.type = 'text'; input.placeholder = ro ? '' : 'Add…'; input.disabled = ro;
        input.setAttribute('aria-label', (row.key || 'list') + ' items');
        const draw = () => {
          chips.querySelectorAll('.props-chip').forEach(c => c.remove());
          row.value.forEach((v, idx) => {
            const chip = el('span', 'props-chip'); chip.append(el('span', null, v));
            if (!ro) {
              const x = el('button', 'props-chip-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Remove ' + v);
              x.addEventListener('click', () => { row.value.splice(idx, 1); draw(); commit(); });
              chip.append(x);
            }
            chips.insertBefore(chip, input);
          });
        };
        const add = () => {
          const parts = input.value.split(',').map(s => s.trim()).filter(Boolean);
          if (!parts.length) { input.value = ''; return; }
          for (const p of parts) if (!row.value.includes(p)) row.value.push(p);
          input.value = ''; draw(); commit();
        };
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
          else if (e.key === 'Backspace' && !input.value && row.value.length) { row.value.pop(); draw(); commit(); }
          else if (e.key === 'Escape') view.focus();
        });
        input.addEventListener('input', () => { if (input.value.includes(',')) add(); });   // covers paste / IME where keydown isn't a comma
        input.addEventListener('blur', add);
        chips.append(input); draw(); box.append(chips);
      } else {
        const inp = el('input', 'props-input');
        inp.type = row.type === 'number' ? 'number' : row.type === 'date' ? 'date' : 'text';
        inp.value = row.value; inp.disabled = ro;
        inp.setAttribute('aria-label', row.key || 'value');
        if (row.type === 'text') inp.placeholder = ro ? '' : 'Empty';
        inp.addEventListener('input', () => { row.value = inp.value; commit(); });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); view.focus(); } });
        box.append(inp);
      }
      return box;
    };

    const rowEl = row => {
      const r = el('div', 'props-row');
      const typeBtn = el('button', 'props-type'); typeBtn.type = 'button'; typeBtn.innerHTML = TYPES[row.type].icon;
      typeBtn.title = 'Type: ' + TYPES[row.type].label; typeBtn.setAttribute('aria-label', 'Property type: ' + TYPES[row.type].label); typeBtn.disabled = ro;
      const key = el('input', 'props-key'); key.type = 'text'; key.value = row.key; key.placeholder = 'Name'; key.disabled = ro;
      key.setAttribute('aria-label', 'Property name');
      key.addEventListener('input', () => { row.key = key.value; commit(); });
      key.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); const next = r.querySelector('.props-value input'); (next || view).focus(); }
        else if (e.key === 'Escape') view.focus();
      });
      let value = controlFor(row);
      typeBtn.addEventListener('click', () => openTypeMenu(typeBtn, row.type, t => {
        Object.assign(row, convert(row, t));
        typeBtn.innerHTML = TYPES[t].icon; typeBtn.title = 'Type: ' + TYPES[t].label;
        const nv = controlFor(row); value.replaceWith(nv); value = nv; commit();
      }));
      r.append(typeBtn, key, value);
      if (!ro) {
        const del = el('button', 'props-del', '×'); del.type = 'button'; del.title = 'Delete property'; del.setAttribute('aria-label', 'Delete property');
        del.addEventListener('click', () => { rows.splice(rows.indexOf(row), 1); r.remove(); commit(); });
        r.append(del);
      }
      return r;
    };
    rows.forEach(row => list.append(rowEl(row)));

    if (!ro) {
      const add = el('button', 'props-add', '+ Add property'); add.type = 'button';
      const addRow = () => {
        const row = { key: '', type: 'text', value: '' };
        rows.push(row);
        const r = rowEl(row); list.append(r); refresh();
        r.querySelector('.props-key').focus();
      };
      add.addEventListener('click', addRow);
      root.append(add);
      if (focusNewRow) { focusNewRow = false; if (!rows.length) setTimeout(addRow, 0); }
    }
    refresh();
    return root;
  }
}

function openTypeMenu(anchor, current, pick) {
  document.querySelectorAll('.props-menu').forEach(m => m.remove());
  const menu = el('div', 'menu props-menu'); menu.setAttribute('role', 'menu');
  for (const t of Object.keys(TYPES)) {
    const b = el('button', 'menu-item'); b.type = 'button'; b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', t === current);
    b.innerHTML = `<span class="props-menu-label">${TYPES[t].icon}<span>${TYPES[t].label}</span></span>${t === current ? '<span class="hint">✓</span>' : ''}`;
    b.addEventListener('click', () => { close(); pick(t); });
    menu.append(b);
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.min(r.left, innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = (r.bottom + 4 + menu.offsetHeight > innerHeight ? r.top - menu.offsetHeight - 4 : r.bottom + 4) + 'px';
  const close = () => { menu.remove(); document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); anchor.focus(); };
  const onDown = e => { if (!menu.contains(e.target)) close(); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('mousedown', onDown, true); document.addEventListener('keydown', onKey, true);
  (menu.querySelector('[aria-checked="true"]') || menu.firstChild).focus();
}

// ---------- editor extension ----------
function build(state) {
  const fm = frontmatter(state.doc);
  if (!fm) return { decos: Decoration.none, fm: null };
  const rows = parseProps(frontmatterBody(state.doc, fm));
  if (!rows) return { decos: Decoration.none, fm: null, raw: true };   // unsupported YAML: live.js shows it as styled text
  const text = state.doc.sliceString(0, fm.to);
  const widget = new PropsWidget(text, rows, !state.facet(EditorView.editable));
  return { decos: Decoration.set([Decoration.replace({ widget, block: true }).range(0, fm.to)]), fm };
}

const field = StateField.define({
  create: build,
  update: (v, tr) => (tr.docChanged || tr.reconfigured ? build(tr.state) : v),
  provide: f => [
    EditorView.decorations.from(f, v => v.decos),
    EditorView.atomicRanges.of(view => view.state.field(f).decos),
  ],
});

// Keep the caret out of the panel (typing there would break the fences) and make sure a body line exists after it.
const panelActive = doc => { const fm = frontmatter(doc); return fm && parseProps(frontmatterBody(doc, fm)) ? fm : null; };
export const propertiesExtension = [
  field,
  EditorState.transactionFilter.of(tr => {
    const fm = panelActive(tr.newDoc);
    if (!fm) return tr;
    const sel = tr.newSelection.main;
    const needLine = tr.newDoc.length === fm.to;
    const moveCaret = sel.empty && sel.head <= fm.to;
    if (!needLine && !moveCaret) return tr;
    const first = { changes: tr.changes, effects: tr.effects, annotations: tr.annotations, scrollIntoView: tr.scrollIntoView };
    if (tr.selection) first.selection = tr.selection;
    const fix = { sequential: true };
    if (needLine) fix.changes = { from: tr.newDoc.length, insert: '\n' };
    if (moveCaret) fix.selection = { anchor: fm.to + 1 };
    return [first, fix];
  }),
];

// For a freshly loaded note: guarantee a body line and a caret below the panel.
export function prepareDoc(text, doc) {
  const fm = panelActive(doc);
  if (!fm) return { text, anchor: 0 };
  return { text: doc.length === fm.to ? text + '\n' : text, anchor: fm.to + 1 };
}

// Called by the Enter handler: start a block under a lone `---` on line 1 and focus its first name box.
export function startProperties(view) {
  const doc = view.state.doc, line = doc.line(1);
  if (line.text.trimEnd() !== '---' || frontmatter(doc)) return false;
  const last = line.to === doc.length;
  const insert = last ? '\n---\n' : '\n---';
  focusNewRow = true;
  view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + insert.length + (last ? 0 : 1) }, userEvent: 'input' });
  return true;
}
