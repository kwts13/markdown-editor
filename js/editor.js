import * as store from './store.js';
import { EditorState, Compartment, EditorView, keymap, drawSelection, placeholder, history, historyKeymap, defaultKeymap,
  indentMore, indentLess, markdown, markdownLanguage, markdownKeymap } from '../vendor/codemirror.js';
import { liveRender, frontmatter } from './live.js';
import { toggleWrap } from './format.js';
import { selectionToolbar } from './toolbar.js';

const host = document.getElementById('editor');
const pane = document.getElementById('panes');
const titleInput = document.getElementById('note-title');
let currentId = null;
let escaped = false;
let loading = false;
const modeSlot = new Compartment();
const modeExt = m => (m === 'read' ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []);

function newState(doc) {
  return EditorState.create({ doc, extensions: [
    history(), drawSelection(), EditorView.lineWrapping, placeholder('Start typing in markdown...'),
    // no setext headings: a '---' line under text is a divider, not an H2 underline
    markdown({ base: markdownLanguage, addKeymap: false, extensions: { remove: ['SetextHeading'] } }),
    liveRender, selectionToolbar,
    modeSlot.of(modeExt(store.get().ui.viewMode)),
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown editor', spellcheck: 'true' }),
    keymap.of([
      // Ctrl/Cmd+E is the app-level edit/read toggle; stop CodeMirror's emacs line-end binding eating it
      { key: 'Mod-e', run: () => true }, { key: 'Ctrl-e', run: () => true },
      { key: 'Mod-b', run: v => toggleWrap(v, '**') }, { key: 'Mod-i', run: v => toggleWrap(v, '*') },
      // Enter after a lone '---' on line 1 starts a Properties block: add the closing fence and put the caret inside
      { key: 'Enter', run: v => {
        const sel = v.state.selection.main, line = v.state.doc.line(1);
        if (!sel.empty || sel.head !== line.to || line.text.trimEnd() !== '---' || frontmatter(v.state.doc)) return false;
        v.dispatch({ changes: { from: line.to, insert: '\n\n---' }, selection: { anchor: line.to + 1 }, userEvent: 'input' });
        return true;
      } },
      { key: 'Escape', run: () => { escaped = true; return false; } },
      { key: 'Tab', run: v => { if (escaped) { escaped = false; return false; } return indentMore(v) || true; },
        shift: v => { if (escaped) { escaped = false; return false; } return indentLess(v) || true; } },
      ...markdownKeymap, ...historyKeymap, ...defaultKeymap,
    ]),
    EditorView.updateListener.of(u => {
      if (u.docChanged && !loading) {
        store.setContent(currentId, u.state.doc.toString());
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
  }
  if (document.activeElement !== titleInput) titleInput.value = n.name;
}
export function focusEditor() {
  applyMode();
  view.focus();
}

export function applyMode() {
  const m = store.get().ui.viewMode;
  pane.dataset.mode = m;
  view.dispatch({ effects: modeSlot.reconfigure(modeExt(m)) });
  document.querySelectorAll('[data-mode-btn]').forEach(b => {
    const on = b.dataset.modeBtn === m; b.setAttribute('aria-pressed', on); b.classList.toggle('on', on);
  });
}
export function setMode(m) { store.setUi({ viewMode: m }); applyMode(); focusEditor(); }
export function toggleMode() { setMode(store.get().ui.viewMode === 'read' ? 'edit' : 'read'); }

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
