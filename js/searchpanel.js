// Search palette: a centered overlay opened with Ctrl/Cmd+Space. Results come from search.js.
import * as store from './store.js';
import { search, highlightWords } from './search.js';

const palette = document.getElementById('palette');
const input = document.getElementById('palette-input');
const list = document.getElementById('palette-results');
let openNote = () => {};
let prevFocus = null;
let hits = [];       // [{ id, find }] in display order
let sel = 0;

const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const isOpen = () => !palette.hidden;

export function init({ open }) {
  openNote = open;
  input.addEventListener('input', render);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); select(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(sel - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') e.preventDefault();   // keep focus in the box while the palette is open
  });
  palette.addEventListener('mousedown', e => { if (e.target === palette) close(); });
  list.addEventListener('click', e => { const b = e.target.closest('.search-hit'); if (b) choose(+b.dataset.i); });
  list.addEventListener('mousemove', e => { const b = e.target.closest('.search-hit'); if (b && +b.dataset.i !== sel) select(+b.dataset.i, false); });
}

export function toggle() { isOpen() ? close() : show(); }
export function show() {
  if (isOpen()) return;
  prevFocus = document.activeElement;
  palette.hidden = false;
  input.value = '';
  render();
  input.focus();
}
export function close() {
  if (!isOpen()) return;
  palette.hidden = true;
  if (prevFocus && prevFocus.isConnected) prevFocus.focus();
  prevFocus = null;
}

function choose(i) {
  const h = hits[i];
  if (!h) return;
  prevFocus = null;          // the note takes focus itself
  palette.hidden = true;
  openNote(h.id, h.find);
}
function select(i, scroll = true) {
  if (!hits.length) return;
  sel = (i + hits.length) % hits.length;
  list.querySelectorAll('.search-hit').forEach(b => {
    const on = +b.dataset.i === sel;
    b.classList.toggle('sel', on); b.setAttribute('aria-selected', on);
    if (on) { input.setAttribute('aria-activedescendant', b.id); if (scroll) b.scrollIntoView({ block: 'nearest' }); }
  });
}

// <mark> every occurrence of the words inside text
function highlighted(parent, text, words) {
  const ws = words.filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!ws.length) { parent.append(text); return parent; }
  let last = 0;
  for (const m of text.matchAll(new RegExp(ws.join('|'), 'gi'))) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    const mk = document.createElement('mark'); mk.textContent = m[0]; parent.append(mk);
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.append(text.slice(last));
  return parent;
}

function folderPath(st, note) {
  const path = [];
  for (let f = st.folders[note.folderId]; f; f = st.folders[f.parentId]) path.unshift(f.name);
  return path.join(' / ');
}

function render() {
  const q = input.value.trim(), st = store.get();
  list.textContent = '';
  hits = []; sel = 0;
  let rows, words = [];
  if (q) {
    const { terms, results } = search(st.notes, q);
    words = highlightWords(terms); rows = results;
    if (!rows.length) {
      const e = el('div', 'search-empty');
      e.append('No matches.', document.createElement('br'), 'Search names, text and properties, e.g. author:Sam or tags:todo.');
      list.append(e); return;
    }
  } else {
    rows = Object.values(st.notes).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 8).map(note => ({ note, props: [] }));
    if (!rows.length) { const e = el('div', 'search-empty'); e.textContent = 'No notes yet.'; list.append(e); return; }
  }
  const count = el('div', 'search-count');
  count.textContent = q ? `${rows.length} match${rows.length === 1 ? '' : 'es'}` : 'Recent notes';
  count.setAttribute('role', 'status'); list.append(count);
  rows.forEach((r, i) => {
    const b = el('div', 'search-hit'); b.id = 'hit-' + i; b.dataset.i = i; b.setAttribute('role', 'option');
    const name = el('div', 'search-name'); highlighted(name, r.note.name, words); b.append(name);
    const path = folderPath(st, r.note);
    if (path) { const p = el('div', 'search-path'); p.textContent = path; b.append(p); }
    if (r.snippet) {
      const s = el('div', 'search-snippet');
      s.append(r.snippet.before); const mk = document.createElement('mark'); mk.textContent = r.snippet.match; s.append(mk); highlighted(s, r.snippet.after, words);
      b.append(s);
    }
    if (r.props.length) {
      const pr = el('div', 'search-props');
      for (const p of r.props) {
        const c = el('span', 'search-prop'), k = document.createElement('b'); k.textContent = p.key; c.append(k, ': ');
        highlighted(c, p.value, words); c.title = `${p.key}: ${p.value}`; pr.append(c);
      }
      b.append(pr);
    }
    list.append(b);
    hits.push({ id: r.note.id, find: q ? (words.find(w => !r.note.name.toLowerCase().includes(w)) || words[0]) : undefined });
  });
  select(0, false);
}
