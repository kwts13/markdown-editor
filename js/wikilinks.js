// [[wikilinks]]: finding them in text, and the [[ completion popup.
import * as store from './store.js';
import { suggest } from './suggest.js';
import { syntaxTree } from '../vendor/codemirror.js';

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
