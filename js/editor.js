import * as store from './store.js';
import { marked } from '../vendor/marked.esm.js';
import DOMPurify from '../vendor/purify.es.mjs';
import { EditorState, Compartment, EditorView, keymap, drawSelection, placeholder, history, historyKeymap, defaultKeymap,
  indentMore, indentLess, markdown, markdownLanguage, markdownKeymap } from '../vendor/codemirror.js';
import { liveRender } from './live.js';

marked.setOptions({ gfm: true, breaks: false });
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
  if (node.tagName === 'INPUT') {
    // only GFM task-list checkboxes are allowed; raw HTML inputs are phishing surface (QA fix)
    if ((node.getAttribute('type') || '').toLowerCase() !== 'checkbox') node.remove(); else node.setAttribute('disabled', '');
  }
});

const host = document.getElementById('editor');
const preview = document.getElementById('preview');
const pane = document.getElementById('panes');
const titleInput = document.getElementById('note-title');
let currentId = null;
let previewTimer = null;
let escaped = false;
let loading = false;
const liveSlot = new Compartment();

const text = () => view.state.doc.toString();

export function renderPreview() {
  const src = text();
  const html = marked.parse(src || '');
  preview.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['form', 'style', 'button', 'select', 'textarea'] });
  if (!src.trim()) preview.innerHTML = '<p class="muted">Nothing to preview yet.</p>';
}

function newState(doc) {
  return EditorState.create({ doc, extensions: [
    history(), drawSelection(), EditorView.lineWrapping, placeholder('Start typing in markdown...'),
    markdown({ base: markdownLanguage }),
    liveSlot.of(store.get().ui.viewMode === 'live' ? liveRender : []),
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown editor', spellcheck: 'true' }),
    keymap.of([
      // Ctrl/Cmd+E is the app-level preview toggle; stop CodeMirror's emacs line-end binding eating it
      { key: 'Mod-e', run: () => true }, { key: 'Ctrl-e', run: () => true },
      { key: 'Mod-b', run: v => wrap(v, '**') }, { key: 'Mod-i', run: v => wrap(v, '*') },
      { key: 'Escape', run: () => { escaped = true; return false; } },
      { key: 'Tab', run: v => { if (escaped) { escaped = false; return false; } return indentMore(v) || true; },
        shift: v => { if (escaped) { escaped = false; return false; } return indentLess(v) || true; } },
      ...markdownKeymap, ...historyKeymap, ...defaultKeymap,
    ]),
    EditorView.updateListener.of(u => {
      if (u.docChanged && !loading) {
        store.setContent(currentId, u.state.doc.toString());
        if (store.get().ui.viewMode === 'split') { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 150); }
      }
      if (u.selectionSet || u.docChanged) escaped = false;
    }),
    EditorView.domEventHandlers({ blur: () => { store.flush(); escaped = false; } }),
  ] });
}

let view = new EditorView({ state: newState(''), parent: host });

export function load() {
  const st = store.get();
  const n = st.notes[st.ui.openNoteId];
  if (!n) return;
  if (currentId !== n.id) {
    currentId = n.id;
    loading = true;
    view.setState(newState(n.content));   // fresh state also resets undo history per note
    loading = false;
    view.scrollDOM.scrollTop = 0;
    renderPreview();
  }
  if (document.activeElement !== titleInput) titleInput.value = n.name;
}
export function focusEditor() {
  applyMode();
  if (store.get().ui.viewMode === 'preview') preview.focus(); else view.focus();
}

export function applyMode() {
  const m = store.get().ui.viewMode;
  pane.dataset.mode = m;
  view.dispatch({ effects: liveSlot.reconfigure(m === 'live' ? liveRender : []) });
  document.querySelectorAll('[data-mode-btn]').forEach(b => {
    const on = b.dataset.modeBtn === m; b.setAttribute('aria-pressed', on); b.classList.toggle('on', on);
  });
  if (m === 'preview' || m === 'split') renderPreview();
}
export function setMode(m) { store.setUi({ viewMode: m }); applyMode(); focusEditor(); }
let lastEditMode = 'live';
export function toggleMode() {
  const cur = store.get().ui.viewMode;
  if (cur !== 'preview') lastEditMode = cur;
  setMode(cur === 'preview' ? lastEditMode : 'preview');
}

// Ctrl/Cmd+B / I: toggle the marker around the selection
function wrap(v, mark) {
  const len = mark.length;
  v.dispatch(v.state.changeByRange(r => {
    const doc = v.state.doc, sel = doc.sliceString(r.from, r.to);
    const before = doc.sliceString(Math.max(0, r.from - len), r.from), after = doc.sliceString(r.to, r.to + len);
    if (r.from !== r.to && before === mark && after === mark) {
      return { changes: [{ from: r.from - len, to: r.from }, { from: r.to, to: r.to + len }], range: { anchor: r.from - len, head: r.to - len } };
    }
    if (sel.length >= len * 2 && sel.startsWith(mark) && sel.endsWith(mark)) {
      return { changes: { from: r.from, to: r.to, insert: sel.slice(len, -len) }, range: { anchor: r.from, head: r.to - len * 2 } };
    }
    return { changes: [{ from: r.from, insert: mark }, { from: r.to, insert: mark }], range: { anchor: r.from + len, head: r.to + len } };
  }), { userEvent: 'input', scrollIntoView: true });
  return true;
}

export function init() {
  const commitTitle = () => {
    const st = store.get(), n = st.notes[st.ui.openNoteId];
    if (!n) return;
    const r = store.rename('note', n.id, titleInput.value);
    if (!r.ok) { import('./ui.js').then(u => u.toast(r.error)); titleInput.value = n.name; }
    else titleInput.value = r.name;
  };
  titleInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitTitle(); view.focus(); }
    else if (e.key === 'Escape') { const st = store.get(); titleInput.value = st.notes[st.ui.openNoteId].name; view.focus(); }
  });
  titleInput.addEventListener('blur', commitTitle);

  document.querySelectorAll('[data-mode-btn]').forEach(b => b.onclick = () => setMode(b.dataset.modeBtn));
  store.subscribe(t => { if (t === 'open' || t === 'tree') load(); });
  load(); applyMode();
}
