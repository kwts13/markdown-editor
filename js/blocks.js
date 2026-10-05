// Editing helpers for markdown blocks that are plain text underneath: leaving quotes/callouts with Enter, and
// moving around pipe tables with Tab / Shift+Tab / Enter.
import { syntaxTree } from '../vendor/codemirror.js';

// Enter on an empty quote / callout line (just `>` marks) leaves the quote in one press and drops the stray marker.
export function exitQuote(view) {
  const { state } = view, sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (sel.head !== line.to || !/^\s*(>\s*)+$/.test(line.text)) return false;
  const rest = line.text.replace(/>\s*$/, '');   // peel one nesting level (usually the only one)
  const text = /^\s*$/.test(rest) ? '' : rest;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: text }, selection: { anchor: line.from + text.length }, userEvent: 'input' });
  return true;
}

// ---- tables ----
const inTable = (state, pos) => {
  for (let n = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) if (n.name === 'Table') return true;
  return false;
};
const isDelim = text => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(text);
// cells of a row: [{ from, to }] with from..to the trimmed content (absolute doc offsets); empty cells get from == to
function cellsOf(line) {
  const t = line.text, pipes = [];
  for (let i = 0; i < t.length; i++) { if (t[i] === '\\') i++; else if (t[i] === '|') pipes.push(i); }
  const bounds = [];
  if (!pipes.length) return [];
  if (t.slice(0, pipes[0]).trim()) bounds.push([-1, pipes[0]]);
  for (let i = 0; i + 1 < pipes.length; i++) bounds.push([pipes[i], pipes[i + 1]]);
  if (t.slice(pipes[pipes.length - 1] + 1).trim()) bounds.push([pipes[pipes.length - 1], t.length]);
  return bounds.map(([a, b]) => {
    const raw = t.slice(a + 1, b), lead = raw.length - raw.trimStart().length, trimmed = raw.trim();
    const from = a + 1 + (trimmed ? lead : Math.min(1, raw.length));
    return { from: line.from + from, to: line.from + from + trimmed.length, a: line.from + a + 1, b: line.from + b };
  });
}
function where(state) {
  const sel = state.selection.main;
  if (!inTable(state, sel.head)) return null;
  const line = state.doc.lineAt(sel.head);
  if (!/\|/.test(line.text) || isDelim(line.text)) return null;
  const cells = cellsOf(line);
  if (!cells.length) return null;
  let col = cells.findIndex(c => sel.head >= c.a && sel.head <= c.b);
  if (col < 0) col = sel.head < cells[0].a ? 0 : cells.length - 1;
  return { line, cells, col };
}
const rowAt = (state, n, dir) => {   // the next real row (not the --- delimiter row) in a direction, or null
  for (let k = n + dir; k >= 1 && k <= state.doc.lines; k += dir) {
    const l = state.doc.line(k);
    if (!/\|/.test(l.text) || !inTable(state, l.from)) return null;
    if (!isDelim(l.text)) return l;
  }
  return null;
};
const select = (view, c) => view.dispatch({ selection: { anchor: c.from, head: c.to }, scrollIntoView: true, userEvent: 'select' });
const blankRow = (line, n) => (/^\s*/.exec(line.text)[0]) + '|' + '   |'.repeat(n);
function addRowAfter(view, w, col) {
  const insert = '\n' + blankRow(w.line, w.cells.length);
  const first = w.line.to + 1 + /^\s*/.exec(w.line.text)[0].length + 1;   // after the "| " of the new row
  const offset = cellsOf({ text: insert.slice(1), from: w.line.to + 1 })[col];
  view.dispatch({ changes: { from: w.line.to, insert }, selection: { anchor: offset ? offset.from : first }, scrollIntoView: true, userEvent: 'input' });
}

// Tab / Shift+Tab: next / previous cell; Tab in the very last cell adds a row. Returns false outside tables.
export function tableTab(view, dir) {
  const w = where(view.state);
  if (!w) return false;
  const target = w.cells[w.col + dir];
  if (target) { select(view, target); return true; }
  const next = rowAt(view.state, w.line.number, dir);
  if (next) { const cs = cellsOf(next); select(view, dir > 0 ? cs[0] : cs[cs.length - 1]); return true; }
  if (dir > 0) { addRowAfter(view, w, 0); return true; }
  return true;   // Shift+Tab in the first cell: stay put rather than indent the row
}
// Enter: same column of the next row (a new row at the end); on an empty last row it leaves the table.
export function tableEnter(view) {
  const w = where(view.state);
  if (!w || !view.state.selection.main.empty) return false;
  const next = rowAt(view.state, w.line.number, 1);
  if (next) { const cs = cellsOf(next); select(view, cs[Math.min(w.col, cs.length - 1)]); return true; }
  const empty = w.cells.every(c => c.from === c.to);
  const prev = rowAt(view.state, w.line.number, -1);
  if (empty && prev) {   // a blank row at the end: drop it and continue below the table
    view.dispatch({ changes: { from: w.line.from, to: w.line.to, insert: '' }, selection: { anchor: w.line.from }, userEvent: 'input' });
    return true;
  }
  addRowAfter(view, w, w.col);
  return true;
}
