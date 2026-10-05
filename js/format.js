import { EditorSelection } from '../vendor/codemirror.js';

// Markdown formatting commands shared by keyboard shortcuts and the selection toolbar.
// Each takes an EditorView and returns true.

// Toggle an inline marker (e.g. ** or *) around each selection range.
export function toggleWrap(v, mark) {
  const len = mark.length;
  v.dispatch(v.state.changeByRange(r => {
    const doc = v.state.doc;
    // keep markers off surrounding whitespace/newlines (e.g. a selection that runs to the next line start)
    let from = r.from, to = r.to;
    while (from < to && /\s/.test(doc.sliceString(from, from + 1))) from++;
    while (to > from && /\s/.test(doc.sliceString(to - 1, to))) to--;
    if (from === to) { from = r.from; to = r.to; }
    const sel = doc.sliceString(from, to);
    let before = doc.sliceString(Math.max(0, from - len), from), after = doc.sliceString(to, to + len);
    if (mark[0] === '*' && from !== to) {
      // bold and italic share '*': look at the whole run of stars so ***x*** toggles each independently
      let nb = 0, na = 0;
      while (nb < 3 && doc.sliceString(from - nb - 1, from - nb) === '*') nb++;
      while (na < 3 && doc.sliceString(to + na, to + na + 1) === '*') na++;
      const n = Math.min(nb, na), on = len === 1 ? n === 1 || n === 3 : n >= 2;
      before = after = on ? mark : '';
    }
    if (from !== to && before === mark && after === mark) {
      return { changes: [{ from: from - len, to: from }, { from: to, to: to + len }], range: EditorSelection.range(from - len, to - len) };
    }
    if (sel.length >= len * 2 && sel.startsWith(mark) && sel.endsWith(mark)) {
      return { changes: { from, to, insert: sel.slice(len, -len) }, range: EditorSelection.range(from, to - len * 2) };
    }
    return { changes: [{ from, insert: mark }, { from: to, insert: mark }], range: EditorSelection.range(from + len, to + len) };
  }), { userEvent: 'input', scrollIntoView: true });
  return true;
}

export function insertLink(v) {
  v.dispatch(v.state.changeByRange(r => {
    const sel = v.state.doc.sliceString(r.from, r.to);
    const insert = `[${sel}](url)`;
    const urlFrom = r.from + sel.length + 3;
    return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.range(urlFrom, urlFrom + 3) };
  }), { userEvent: 'input', scrollIntoView: true });
  return true;
}

// Per-line block formats. Each has a detector (matched against the line) and a prefix builder.
const BLOCKS = {
  bullet: { re: /^(\s*)[-*+] (?!\[[ xX]\] )/, make: () => '- ' },
  number: { re: /^(\s*)\d+[.)] /, make: i => `${i + 1}. ` },
  task: { re: /^(\s*)[-*+] \[[ xX]\] /, make: () => '- [ ] ' },
  quote: { re: /^(\s*)> ?/, make: () => '> ' },
  h1: { re: /^(\s*)# (?!#)/, make: () => '# ' },
  h2: { re: /^(\s*)## (?!#)/, make: () => '## ' },
  h3: { re: /^(\s*)### (?!#)/, make: () => '### ' },
};
const LIST_KINDS = ['bullet', 'number', 'task'];
const HEADING_KINDS = ['h1', 'h2', 'h3'];
const ANY_HEADING = /^(\s*)#{1,6} /;
const ANY_LIST = /^(\s*)([-*+]|\d+[.)]) (\[[ xX]\] )?/;

export function toggleBlock(v, kind) {
  const { doc } = v.state;
  const changes = [];
  const seen = new Set();
  const lines = [];
  for (const r of v.state.selection.ranges) {
    const last = doc.lineAt(r.to > r.from && doc.lineAt(r.to).from === r.to ? r.to - 1 : r.to).number;
    for (let n = doc.lineAt(r.from).number; n <= last; n++) if (!seen.has(n)) { seen.add(n); lines.push(doc.line(n)); }
  }
  const spec = BLOCKS[kind];
  const content = lines.filter(l => l.text.trim());
  const allHave = content.length > 0 && content.every(l => spec.re.test(l.text));
  let i = 0;
  for (const line of lines) {
    if (!line.text.trim()) continue;
    const m = spec.re.exec(line.text);
    if (allHave) {                      // toggle off
      changes.push({ from: line.from + m[1].length, to: line.from + m[0].length });
    } else {
      let strip = null;
      if (LIST_KINDS.includes(kind)) strip = ANY_LIST.exec(line.text);
      else if (HEADING_KINDS.includes(kind)) strip = ANY_HEADING.exec(line.text);
      else if (spec.re.test(line.text)) { i++; continue; }
      const from = line.from + (strip ? strip[1].length : /^\s*/.exec(line.text)[0].length);
      changes.push({ from, to: strip ? line.from + strip[0].length : from, insert: spec.make(i) });
    }
    i++;
  }
  if (changes.length) v.dispatch({ changes, userEvent: 'input' });
  return true;
}

export function toggleCodeBlock(v) {
  const { doc } = v.state, r = v.state.selection.main;
  const first = doc.lineAt(r.from), last = doc.lineAt(r.to > r.from && doc.lineAt(r.to).from === r.to ? r.to - 1 : r.to);
  const fenceBefore = first.number > 1 && /^\s*```/.test(doc.line(first.number - 1).text);
  const fenceAfter = last.number < doc.lines && /^\s*```\s*$/.test(doc.line(last.number + 1).text);
  if (fenceBefore && fenceAfter) {
    v.dispatch({ changes: [{ from: doc.line(first.number - 1).from, to: first.from }, { from: last.to, to: doc.line(last.number + 1).to }], userEvent: 'input' });
  } else {
    v.dispatch({ changes: [{ from: first.from, insert: '```\n' }, { from: last.to, insert: '\n```' }], userEvent: 'input' });
  }
  return true;
}
