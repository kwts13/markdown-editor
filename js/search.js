// Note search: matches note names, body text and Properties (front matter). Pure logic, no DOM.
//   plain words      every word must appear in the name, the text or a property (key or value)
//   "quoted phrase"  matched as one piece
//   key:value        the note needs a property called key whose value contains value (lists match any item)
//   key:             the note just needs that property
import { parseProps } from './properties.js';

// Split a note into its front-matter block and body (same rule the editor uses to decide what is a Properties block).
const PROP_LINE = /^(\s*$|[^\s:#][^:]*:(\s.*)?$|\s+\S.*|-\s.*|#.*)/;
export function splitNote(content) {
  const lines = content.split('\n');
  if (lines.length < 2 || lines[0].trimEnd() !== '---') return { yaml: '', body: content };
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trimEnd();
    if (t === '---' || t === '...') return { yaml: lines.slice(1, i).join('\n'), body: lines.slice(i + 1).join('\n') };
    if (!PROP_LINE.test(t)) break;
  }
  return { yaml: '', body: content };
}

// Properties as [{key, text}] where text is the value as a plain string (lists joined with ", ").
function readProps(yaml) {
  if (!yaml.trim()) return [];
  const rows = parseProps(yaml);
  if (rows) return rows.map(r => ({ key: r.key, items: Array.isArray(r.value) ? r.value : [String(r.value)] }));
  const out = [];   // YAML the panel can't model: fall back to simple "key: value" lines
  for (const line of yaml.split('\n')) { const m = /^([^\s:#-][^:]*):\s*(.*)$/.exec(line); if (m) out.push({ key: m[1].trim(), items: [m[2].trim()] }); }
  return out;
}
const valueText = p => p.items.join(', ');

const cache = new Map();   // note id -> { stamp, index }
function indexOf(note) {
  const stamp = note.updatedAt + ':' + note.content.length + ':' + note.name;
  const hit = cache.get(note.id);
  if (hit && hit.stamp === stamp) return hit.index;
  const { yaml, body } = splitNote(note.content);
  const index = { name: note.name.toLowerCase(), body, bodyL: body.toLowerCase(), props: readProps(yaml) };
  cache.set(note.id, { stamp, index });
  return index;
}

export function parseQuery(q) {
  const terms = [], re = /([A-Za-z0-9_-]+):"([^"]*)"|([A-Za-z0-9_-]+):(?!\/\/)(\S*)|"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(q))) {
    if (m[1] !== undefined) terms.push({ kind: 'prop', key: m[1].toLowerCase(), value: m[2].trim().toLowerCase() });
    else if (m[3] !== undefined) terms.push({ kind: 'prop', key: m[3].toLowerCase(), value: m[4].toLowerCase() });
    else terms.push({ kind: 'text', text: (m[5] ?? m[6]).toLowerCase() });
  }
  return terms;
}

// Returns null for no match, else { score, snippet, props, nameMatch } for display.
export function matchNote(note, terms) {
  const ix = indexOf(note);
  let score = 0, snippet = null, nameMatch = false;
  const props = [];
  for (const t of terms) {
    if (t.kind === 'prop') {
      const p = ix.props.find(p => p.key.toLowerCase() === t.key);
      if (!p || (t.value && !p.items.some(i => i.toLowerCase().includes(t.value)))) return null;
      if (!props.includes(p)) props.push(p);
      score += 50;
      continue;
    }
    let hit = false;
    if (ix.name.includes(t.text)) { hit = true; nameMatch = true; score += ix.name.startsWith(t.text) ? 100 : 60; }
    for (const p of ix.props) {
      if (p.key.toLowerCase().includes(t.text) || p.items.some(i => i.toLowerCase().includes(t.text))) { hit = true; if (!props.includes(p)) props.push(p); score += 30; }
    }
    const at = ix.bodyL.indexOf(t.text);
    if (at >= 0) {
      hit = true; score += 10;
      if (!snippet) {
        const from = Math.max(0, at - 30), to = Math.min(ix.body.length, at + t.text.length + 70);
        const clean = s => s.replace(/\s+/g, ' ');
        snippet = { before: (from > 0 ? '…' : '') + clean(ix.body.slice(from, at)), match: ix.body.slice(at, at + t.text.length), after: clean(ix.body.slice(at + t.text.length, to)) + (to < ix.body.length ? '…' : '') };
      }
    }
    if (!hit) return null;
  }
  return { score, snippet, props: props.map(p => ({ key: p.key, value: valueText(p) })), nameMatch };
}

export function search(notes, query) {
  const terms = parseQuery(query);
  if (!terms.length) return { terms, results: [] };
  const results = [];
  for (const note of Object.values(notes)) {
    const m = matchNote(note, terms);
    if (m) results.push({ note, ...m });
  }
  results.sort((a, b) => b.score - a.score || (b.note.updatedAt || 0) - (a.note.updatedAt || 0) || a.note.name.localeCompare(b.note.name));
  return { terms, results };
}

// Words worth highlighting / jumping to inside a note: the free-text terms plus property values.
export const highlightWords = terms => terms.map(t => (t.kind === 'text' ? t.text : t.value)).filter(Boolean);
