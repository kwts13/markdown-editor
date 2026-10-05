// [[wikilinks]]: finding them in text, and the [[ completion popup.
import * as store from './store.js';
import { suggest } from './suggest.js';
import { syntaxTree, EditorView, keymap, Prec } from '../vendor/codemirror.js';

// [[target]]  [[target|alias]]  [[Folder/target#Heading]]  [[#Heading]]
export const WIKILINK_RE = /\[\[([^\[\]\n|]*?)(?:\|([^\[\]\n]*))?\]\]/g;

// Split a link target into the note part and the heading part.
export function splitTarget(target) {
  const i = target.indexOf('#');
  return i < 0 ? { note: target.trim(), heading: '' } : { note: target.slice(0, i).trim(), heading: target.slice(i + 1).trim() };
}

// Typing "[[" offers the notes whose names match what follows.
const source = view => {
  const { state } = view, head = state.selection.main.head, line = state.doc.lineAt(head);
  const m = /\[\[([^\[\]\n|#]*)$/.exec(line.text.slice(0, head - line.from));
  if (!m) return null;
  const q = m[1].trim().toLowerCase(), from = line.from + m.index + 2;
  for (let n = syntaxTree(state).resolveInner(head, -1); n; n = n.parent) if (/^(FencedCode|CodeBlock|InlineCode|CodeText)$/.test(n.name)) return null;   // not inside code
  const st = store.get();
  const notes = Object.values(st.notes)
    .filter(n => n.name.toLowerCase().includes(q))
    .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 8);
  const items = notes.map(n => ({
    title: n.name,
    detail: store.folderPath(n.folderId).join(' / '),
    icon: '\u{1F4C4}',
    apply(v, { from, to }) {
      const closed = v.state.doc.sliceString(to, to + 2) === ']]';   // brackets already there: keep them
      v.dispatch({ changes: { from, to: closed ? to + 2 : to, insert: n.name + ']]' }, selection: { anchor: from + n.name.length + 2 }, userEvent: 'input.complete' });
    },
  }));
  return { from, to: head, items };
};

export const wikilinkSuggest = suggest(source);

// Typing the second "[" closes the link ("[[]]", caret inside); typing "]" before an existing "]" steps over it, and
// Backspace inside an empty "[[]]" removes the whole pair.
const inCode = (state, pos) => { for (let n = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (/^(FencedCode|CodeBlock|InlineCode|CodeText)$/.test(n.name)) return true; return false; };
export const wikilinkBrackets = [
  EditorView.inputHandler.of((view, from, to, text) => {
    const { state } = view;
    if (from !== to || text.length !== 1 || !state.facet(EditorView.editable)) return false;
    if (text === '[' && state.sliceDoc(from - 1, from) === '[' && state.sliceDoc(from - 2, from - 1) !== '[' && state.sliceDoc(from, from + 1) !== ']' && !inCode(state, from)) {
      view.dispatch({ changes: { from, insert: '[]]' }, selection: { anchor: from + 1 }, userEvent: 'input.type' });
      return true;
    }
    if (text === ']' && state.sliceDoc(from, from + 1) === ']' && /\[\[[^\[\]\n]*\]?$/.test(state.sliceDoc(state.doc.lineAt(from).from, from))) {
      view.dispatch({ selection: { anchor: from + 1 }, userEvent: 'select' });
      return true;
    }
    return false;
  }),
  Prec.high(keymap.of([{ key: 'Backspace', run: v => {
    const sel = v.state.selection.main;
    if (!sel.empty || v.state.sliceDoc(sel.head - 2, sel.head + 2) !== '[[]]') return false;
    v.dispatch({ changes: { from: sel.head - 2, to: sel.head + 2 }, userEvent: 'delete.backward' });
    return true;
  } }])),
];
