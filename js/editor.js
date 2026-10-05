import * as store from './store.js';
import { marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';

marked.setOptions({ gfm: true, breaks: false });
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
  if (node.tagName === 'INPUT') {
    // only GFM task-list checkboxes are allowed; raw HTML inputs are phishing surface (QA fix)
    if ((node.getAttribute('type') || '').toLowerCase() !== 'checkbox') node.remove(); else node.setAttribute('disabled', '');
  }
});

const ta = document.getElementById('editor');
const preview = document.getElementById('preview');
const pane = document.getElementById('panes');
const titleInput = document.getElementById('note-title');
let currentId = null;
let previewTimer = null;
let escaped = false;

export function renderPreview() {
  const html = marked.parse(ta.value || '');
  preview.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['form', 'style', 'button', 'select', 'textarea'] });
  if (!ta.value.trim()) preview.innerHTML = '<p class="muted">Nothing to preview yet.</p>';
}

export function load() {
  const st = store.get();
  const n = st.notes[st.ui.openNoteId];
  if (!n) return;
  if (currentId !== n.id) {
    currentId = n.id;
    ta.value = n.content;
    ta.scrollTop = 0;
    renderPreview();
  }
  if (document.activeElement !== titleInput) titleInput.value = n.name;
}
export function focusEditor() {
  applyMode();
  if (store.get().ui.viewMode === 'preview') preview.focus(); else ta.focus();
}

export function applyMode() {
  const m = store.get().ui.viewMode;
  pane.dataset.mode = m;
  document.querySelectorAll('[data-mode-btn]').forEach(b => {
    const on = b.dataset.modeBtn === m; b.setAttribute('aria-pressed', on); b.classList.toggle('on', on);
  });
  if (m !== 'edit') renderPreview();
}
export function setMode(m) { store.setUi({ viewMode: m }); applyMode(); focusEditor(); }
export function toggleMode() { setMode(store.get().ui.viewMode === 'preview' ? 'edit' : 'preview'); }

// ---------- text helpers (use execCommand so native undo keeps working) ----------
function replaceRange(start, end, text, selStart, selEnd) {
  ta.focus(); ta.setSelectionRange(start, end);
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch (_) {}
  if (!ok) { ta.setRangeText(text, start, end, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
  if (selStart != null) ta.setSelectionRange(selStart, selEnd ?? selStart);
}

function indentSel(outdent) {
  const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
  const multi = v.slice(s, e).includes('\n');
  const curLine = v.slice(v.lastIndexOf('\n', s - 1) + 1, (v.indexOf('\n', s) < 0 ? v.length : v.indexOf('\n', s)));
  // On a list item, Tab nests the whole line (QA fix); elsewhere it inserts two spaces at the caret.
  if (!outdent && !multi && !LIST_RE.test(curLine)) { replaceRange(s, e, '  ', s + 2); return; }
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e); if (le < 0) le = v.length;
  const lines = v.slice(ls, le).split('\n');
  let firstDelta = 0, total = 0;
  const out = lines.map((l, i) => {
    let nl, d;
    if (outdent) { const m = l.match(/^( {1,2}|\t)/); nl = m ? l.slice(m[0].length) : l; d = nl.length - l.length; }
    else { nl = '  ' + l; d = 2; }
    if (i === 0) firstDelta = d; total += d; return nl;
  });
  replaceRange(ls, le, out.join('\n'), Math.max(ls, s + firstDelta), e + total);
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\])?(\s+)/;
function handleEnter(ev) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  if (s !== e || ev.shiftKey || ev.isComposing) return false;
  const v = ta.value, ls = v.lastIndexOf('\n', s - 1) + 1;
  const line = v.slice(ls, s);
  const m = line.match(LIST_RE);
  if (!m || s - ls < m[0].length) return false;
  const rest = line.slice(m[0].length);
  if (!rest.trim()) { // empty marker: end the list
    replaceRange(ls, s, '', ls);
    return true;
  }
  let marker = m[2];
  const num = marker.match(/^(\d+)([.)])$/);
  if (num) marker = (parseInt(num[1], 10) + 1) + num[2];
  const task = m[3] ? ' [ ]' : '';
  replaceRange(s, s, '\n' + m[1] + marker + task + m[4]);
  return true;
}

function wrap(mark) {
  const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
  const sel = v.slice(s, e);
  if (sel.length >= mark.length * 2 && sel.startsWith(mark) && sel.endsWith(mark)) {
    replaceRange(s, e, sel.slice(mark.length, -mark.length), s, e - mark.length * 2);
  } else if (v.slice(s - mark.length, s) === mark && v.slice(e, e + mark.length) === mark && s !== e) {
    replaceRange(s - mark.length, e + mark.length, sel, s - mark.length, e - mark.length);
  } else replaceRange(s, e, mark + sel + mark, s + mark.length, e + mark.length);
}

export function init() {
  ta.addEventListener('input', () => {
    store.setContent(currentId, ta.value);
    if (store.get().ui.viewMode === 'split') { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 150); }
  });
  ta.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { escaped = true; return; }
    if (e.key === 'Tab') {
      if (escaped) { escaped = false; return; } // let focus leave
      e.preventDefault(); indentSel(e.shiftKey); return;
    }
    escaped = false;
    if (e.key === 'Enter' && !mod && handleEnter(e)) e.preventDefault();
    else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**'); }
    else if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('*'); }
  });
  ta.addEventListener('blur', () => store.flush());
  ta.addEventListener('blur', () => { escaped = false; });

  const commitTitle = () => {
    const st = store.get(), n = st.notes[st.ui.openNoteId];
    if (!n) return;
    const r = store.rename('note', n.id, titleInput.value);
    if (!r.ok) { import('./ui.js').then(u => u.toast(r.error)); titleInput.value = n.name; }
    else titleInput.value = r.name;
  };
  titleInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitTitle(); ta.focus(); }
    else if (e.key === 'Escape') { const st = store.get(); titleInput.value = st.notes[st.ui.openNoteId].name; ta.focus(); }
  });
  titleInput.addEventListener('blur', commitTitle);

  document.querySelectorAll('[data-mode-btn]').forEach(b => b.onclick = () => setMode(b.dataset.modeBtn));
  store.subscribe(t => { if (t === 'open' || t === 'tree') load(); });
  load(); applyMode();
}
