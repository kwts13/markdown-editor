// "/" commands: type / at the start of a line or after a space to insert blocks and embeds.
// Every command writes plain markdown (or a widely supported extension), so notes stay portable.
import { syntaxTree } from '../vendor/codemirror.js';
import { suggest } from './suggest.js';
import { frontmatter } from './properties.js';

const S = '\u0001', E = '\u0002';   // markers in templates: the selection to leave after inserting

function parts(text) {
  const a = text.indexOf(S), b = text.indexOf(E);
  const clean = text.replace(S, '').replace(E, '');
  if (a < 0) return { text: clean, from: clean.length, to: clean.length };
  return { text: clean, from: a, to: b < 0 ? a : b - 1 };
}

// Insert `template` in place of the typed /command. Block-level templates start on their own line.
function put(view, { from, to }, template, { block = false, blank = false } = {}) {
  const doc = view.state.doc, line = doc.lineAt(from);
  let prefix = '';
  if (block) {
    if (doc.sliceString(line.from, from).trim()) prefix = '\n';                 // "some text /table": move to a new line
    if (blank) {                                                                  // some blocks need a blank line above
      const fm = frontmatter(doc);
      const above = prefix ? true : line.number > 1 && doc.line(line.number - 1).text.trim() !== '' && !(fm && line.number - 1 <= fm.last);
      if (above) prefix += '\n';
    }
  }
  const t = parts(template);
  view.dispatch({
    changes: { from, to, insert: prefix + t.text },
    selection: { anchor: from + prefix.length + t.from, head: from + prefix.length + t.to },
    scrollIntoView: true, userEvent: 'input.complete',
  });
}

const CALLOUTS = ['note', 'info', 'tip', 'success', 'question', 'warning', 'danger', 'bug', 'example', 'quote'];

function headings(state) {   // [{level, text}] for every # heading outside code and the Properties block
  const fm = frontmatter(state.doc), out = [], tree = syntaxTree(state);
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (fm && line.from <= fm.to) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.text);
    if (!m) continue;
    const node = tree.resolveInner(line.from, 1);
    if (/FencedCode|CodeBlock|CodeText/.test(node.name) || node.parent?.name === 'FencedCode') continue;
    out.push({ level: m[1].length, text: m[2].replace(/[*_`]/g, '').trim() });
  }
  return out;
}

const COMMANDS = [
  { name: 'code', icon: '{ }', title: 'Code block', detail: 'Optional language: /code python', arg: true,
    run: (v, r) => put(v, r, '```' + (r.arg || '').trim().split(/\s+/)[0] + '\n' + S + E + '\n```', { block: true }) },
  { name: 'table', icon: '▦', title: 'Table', detail: 'Optional size: /table 4x3 (columns x rows)', arg: true,
    run: (v, r) => {
      const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec((r.arg || '').trim());
      const cols = Math.min(8, Math.max(1, m ? +m[1] : 3)), rows = Math.min(20, Math.max(1, m ? +m[2] : 3));
      const row = cells => '| ' + cells.join(' | ') + ' |';
      const head = Array.from({ length: cols }, (_, i) => (i === 0 ? S : '') + 'Column ' + (i + 1) + (i === 0 ? E : ''));
      const body = Array.from({ length: rows }, () => row(Array(cols).fill('  ')));
      put(v, r, [row(head), row(Array(cols).fill('---')), ...body].join('\n'), { block: true, blank: true });
    } },
  { name: 'callout', icon: 'ⓘ', title: 'Callout', detail: 'Types: ' + CALLOUTS.slice(0, 6).join(', ') + '. e.g. /callout warning', arg: true,
    run: (v, r) => {
      const t = (r.arg || '').trim().toLowerCase();
      put(v, r, `> [!${CALLOUTS.includes(t) ? t : 'note'}]\n> ${S}${E}`, { block: true });
    } },
  { name: 'details', icon: '▸', title: 'Collapsible section', detail: 'A heading that folds its content away', arg: true,
    run: (v, r) => put(v, r, `<details>\n<summary>${S}${(r.arg || '').trim() || 'Summary'}${E}</summary>\n\nDetails\n\n</details>`, { block: true, blank: true }) },
  { name: 'toc', icon: '≡', title: 'Table of contents', detail: 'A list of links to this note’s headings (static: re-run to refresh)', alias: ['contents'],
    run: (v, r) => {
      const hs = headings(v.state);
      if (!hs.length) return put(v, r, '_No headings yet._', { block: true });
      const min = Math.min(...hs.map(h => h.level));
      put(v, r, hs.map(h => `${'  '.repeat(h.level - min)}- [[#${h.text}]]`).join('\n') + '\n', { block: true });
    } },
  { name: 'image', icon: '▣', title: 'Image', detail: 'From a web address: /image https://…', arg: true,
    run: (v, r) => {
      const url = (r.arg || '').trim();
      put(v, r, url ? `![](${url})` : `![](${S}https://${E})`);
    } },
  { name: 'video', icon: '▶', title: 'Video', detail: 'YouTube, Vimeo or a video file URL: /video https://…', arg: true,
    run: (v, r) => {
      const url = (r.arg || '').trim();
      put(v, r, url ? `![](${url})` : `![](${S}https://${E})`, { block: true });
    } },
  { name: 'todo-list', icon: '☑', title: 'To-do list', detail: 'Three unchecked tasks', alias: ['todo', 'tasks', 'checklist'],
    run: (v, r) => put(v, r, `- [ ] ${S}${E}\n- [ ] \n- [ ] `, { block: true }) },
  { name: 'link', icon: '\u{1F517}', title: 'Web link', detail: 'Text and address: /link https://…', arg: true,
    run: (v, r) => {
      const url = (r.arg || '').trim();
      put(v, r, `[${S}link text${E}](${url || 'https://'})`);
    } },
];

const matches = (c, q) => {
  if (!q) return 0;
  const names = [c.name, ...(c.alias || [])];
  if (names.some(n => n.startsWith(q))) return 1;
  if (names.some(n => n.includes(q))) return 2;
  return 3;
};

const source = view => {
  const { state } = view, head = state.selection.main.head, line = state.doc.lineAt(head);
  const m = /(^|\s)\/([a-z0-9-]*)(?: (.*))?$/i.exec(line.text.slice(0, head - line.from));
  if (!m) return null;
  const from = line.from + m.index + m[1].length, name = m[2].toLowerCase(), arg = m[3];
  const fm = frontmatter(state.doc);
  if (fm && from <= fm.to) return null;
  const inCode = syntaxTree(state).resolveInner(from, 1);
  if (/FencedCode|CodeBlock|InlineCode|CodeText/.test(inCode.name) || inCode.parent?.name === 'FencedCode') return null;
  let list;
  if (arg !== undefined) list = COMMANDS.filter(c => c.arg && [c.name, ...(c.alias || [])].includes(name));   // "/code js": only commands that take an argument
  else list = COMMANDS.filter(c => matches(c, name) < 3).sort((a, b) => matches(a, name) - matches(b, name));
  return {
    from, to: head, arg,
    items: list.map(c => ({ title: '/' + c.name + ' — ' + c.title, detail: c.detail, icon: c.icon, apply: (v, r) => c.run(v, r) })),
  };
};

export const slashCommands = suggest(source);
