// Live-render ("live preview") for the CodeMirror editor: markdown syntax is styled in place and its
// markers are hidden except where the caret / selection is, like Obsidian's Live Preview.
import { Decoration, ViewPlugin, WidgetType, EditorView, syntaxTree } from '../vendor/codemirror.js';

const hide = Decoration.replace({});
const lineDeco = cls => Decoration.line({ attributes: { class: cls } });
const markDeco = (cls, attrs) => Decoration.mark({ class: cls, attributes: attrs });
// Properties: a block at the very top of the note fenced by --- lines (YAML front matter).
// Only counted when the body looks like properties, so a stray later "---" divider isn't swallowed.
const PROP_LINE = /^(\s*$|[^\s:#][^:]*:(\s.*)?$|\s+\S.*|-\s.*|#.*)/;
export function frontmatter(doc) {
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== '---') return null;
  for (let n = 2; n <= doc.lines; n++) {
    const t = doc.line(n).text.trimEnd();
    if (t === '---' || t === '...') return { first: 1, last: n, from: 0, to: doc.line(n).to };
    if (!PROP_LINE.test(t)) return null;
  }
  return null;
}

const SAFE_IMG = /^(https?:|data:image\/(png|jpe?g|gif|webp|svg\+xml);)/i;

class Widget extends WidgetType {
  constructor(key) { super(); this.key = key; }
  eq(o) { return o.constructor === this.constructor && o.key === this.key; }
}
class PropsLabel extends Widget {
  toDOM() { const s = document.createElement('span'); s.className = 'cm-prop-label'; s.textContent = 'Properties'; return s; }
}
class BulletWidget extends Widget {
  toDOM() { const s = document.createElement('span'); s.className = 'cm-bullet'; s.textContent = '•'; return s; }
}
class RuleWidget extends Widget {
  toDOM() { const s = document.createElement('span'); s.className = 'cm-hr'; return s; }
}
class CheckWidget extends Widget {
  toDOM(view) {
    const box = document.createElement('input');
    box.type = 'checkbox'; box.className = 'cm-task'; box.checked = this.key;
    box.addEventListener('mousedown', e => e.preventDefault());
    box.addEventListener('click', e => {
      e.preventDefault();
      const pos = view.posAtDOM(box);
      const mark = view.state.doc.sliceString(pos, pos + 3);
      if (!/^\[[ xX]\]$/.test(mark)) return;
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.key ? ' ' : 'x' } });
    });
    return box;
  }
  ignoreEvent() { return true; }
}
class ImageWidget extends Widget {
  constructor(url, alt) { super(url + '\n' + alt); this.url = url; this.alt = alt; }
  toDOM() {
    const img = document.createElement('img');
    img.className = 'cm-img'; img.src = this.url; img.alt = this.alt; img.loading = 'lazy';
    return img;
  }
}

function build(view) {
  const { state } = view;
  const sel = view.state.facet(EditorView.editable) ? state.selection.ranges : [];
  const touches = (from, to) => sel.some(r => r.from <= to && r.to >= from);
  const lineTouched = pos => { const l = state.doc.lineAt(pos); return touches(l.from, l.to); };
  const out = [];
  const text = (a, b) => state.doc.sliceString(a, b);
  // hide a marker plus one trailing space (so "# " and "> " vanish together)
  const hideWithSpace = (from, to) => {
    const lineEnd = state.doc.lineAt(from).to;
    out.push(hide.range(from, to < lineEnd && text(to, to + 1) === ' ' ? to + 1 : to));
  };

  const fm = frontmatter(state.doc);
  if (fm) {
    const open = touches(fm.from, fm.to);
    for (let l = fm.first; l <= fm.last; l++) {
      const line = state.doc.line(l);
      const top = l === fm.first, bottom = l === fm.last;
      out.push(lineDeco('cm-prop' + (top ? ' cm-prop-top' : '') + (bottom ? ' cm-prop-bottom' : '') +
        ((top || bottom) && open ? ' cm-prop-fence' : '') + (bottom && !open ? ' cm-prop-collapsed' : '')).range(line.from));
      if (top || bottom) {
        if (!open && line.from < line.to) out.push((top ? Decoration.replace({ widget: new PropsLabel('p') }) : hide).range(line.from, line.to));
      } else {
        const m = /^([^\s:#-][^:]*):(?=\s|$)/.exec(line.text);
        if (m) out.push(markDeco('cm-prop-key').range(line.from, line.from + m[1].length));
      }
    }
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter(n) {
        const { name } = n;
        if (fm && n.from < fm.to && name !== 'Document') return false;   // handled as properties above
        const parent = n.node.parent;
        let m;
        if ((m = /^ATXHeading([1-6])$/.exec(name))) {
          out.push(lineDeco('cm-h cm-h' + m[1]).range(state.doc.lineAt(n.from).from));
        } else if (/^SetextHeading([12])$/.test(name)) {
          out.push(lineDeco('cm-h cm-h' + name.slice(-1)).range(state.doc.lineAt(n.from).from));
        } else if (name === 'HeaderMark') {
          if (parent && /^ATX/.test(parent.name) && !lineTouched(n.from)) hideWithSpace(n.from, n.to);
        } else if (name === 'StrongEmphasis') out.push(markDeco('cm-strong').range(n.from, n.to));
        else if (name === 'Emphasis') out.push(markDeco('cm-em').range(n.from, n.to));
        else if (name === 'Strikethrough') out.push(markDeco('cm-strike').range(n.from, n.to));
        else if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
          if (parent && !touches(parent.from, parent.to)) out.push(hide.range(n.from, n.to));
        } else if (name === 'InlineCode') out.push(markDeco('cm-icode').range(n.from, n.to));
        else if (name === 'CodeMark' && parent && parent.name === 'InlineCode') {
          if (!touches(parent.from, parent.to)) out.push(hide.range(n.from, n.to));
        } else if (name === 'Link') {
          const kids = [];
          for (let c = n.node.firstChild; c; c = c.nextSibling) kids.push(c);
          const urlNode = kids.find(k => k.name === 'URL');
          if (!urlNode) return;
          const url = text(urlNode.from, urlNode.to);
          out.push(markDeco('cm-link', { 'data-href': url }).range(n.from, n.to));
          if (!touches(n.from, n.to)) {
            for (const k of kids) if (k.name === 'LinkMark' || k.name === 'URL' || k.name === 'LinkTitle') out.push(hide.range(k.from, k.to));
          }
        } else if (name === 'Image') {
          const urlNode = n.node.getChild('URL');
          if (!urlNode) return;
          const url = text(urlNode.from, urlNode.to);
          if (!touches(n.from, n.to) && SAFE_IMG.test(url)) {
            const first = n.node.firstChild, second = first && first.nextSibling;
            const alt = first && second ? text(first.to, second.from) : '';
            out.push(Decoration.replace({ widget: new ImageWidget(url, alt) }).range(n.from, n.to));
            return false;
          }
        } else if (name === 'Blockquote') {
          for (let l = state.doc.lineAt(n.from).number, last = state.doc.lineAt(n.to).number; l <= last; l++) {
            out.push(lineDeco('cm-quote').range(state.doc.line(l).from));
          }
        } else if (name === 'QuoteMark') {
          if (!lineTouched(n.from)) hideWithSpace(n.from, n.to);
        } else if (name === 'ListMark') {
          const kind = parent && parent.parent && parent.parent.name;
          if (kind === 'BulletList' && !lineTouched(n.from)) {
            const task = /^\s\[[ xX]\]/.test(text(n.to, n.to + 5));
            if (task) hideWithSpace(n.from, n.to);
            else out.push(Decoration.replace({ widget: new BulletWidget('b') }).range(n.from, n.to));
          }
        } else if (name === 'TaskMarker') {
          out.push(Decoration.replace({ widget: new CheckWidget(/[xX]/.test(text(n.from, n.to))) }).range(n.from, n.to));
        } else if (name === 'HorizontalRule') {
          if (!lineTouched(n.from)) out.push(Decoration.replace({ widget: new RuleWidget('r') }).range(n.from, n.to));
        } else if (name === 'FencedCode') {
          const open = touches(n.from, n.to);
          const first = state.doc.lineAt(n.from).number, last = state.doc.lineAt(n.to).number;
          for (let l = first; l <= last; l++) {
            const line = state.doc.line(l);
            const edge = l === first || (l === last && /^\s*(`{3,}|~{3,})\s*$/.test(line.text));
            out.push(lineDeco('cm-fence' + (l === first ? ' cm-fence-top' : '') + (l === last ? ' cm-fence-bottom' : '') +
              (edge && !open ? ' cm-fence-hidden' : '')).range(line.from));
            if (edge && !open && line.from < line.to) out.push(hide.range(line.from, line.to));
          }
          return false;
        } else if (name === 'Table') {
          for (let l = state.doc.lineAt(n.from).number, last = state.doc.lineAt(n.to).number; l <= last; l++) {
            out.push(lineDeco('cm-table').range(state.doc.line(l).from));
          }
        }
      },
    });
  }
  return Decoration.set(out, true);
}

const plugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(u) { if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged) this.decorations = build(u.view); }
}, {
  decorations: v => v.decorations,
  provide: p => EditorView.atomicRanges.of(v => v.plugin(p)?.decorations || Decoration.none),
});

// Ctrl/Cmd+click opens a rendered link
const openLinks = EditorView.domEventHandlers({
  mousedown(e) {
    if (!(e.ctrlKey || e.metaKey)) return false;
    const a = e.target.closest && e.target.closest('[data-href]');
    if (!a) return false;
    const href = a.getAttribute('data-href');
    if (/^(https?:|mailto:)/i.test(href)) { window.open(href, '_blank', 'noopener,noreferrer'); e.preventDefault(); return true; }
    return false;
  },
});

export const liveRender = [plugin, openLinks, EditorView.editorAttributes.of({ class: 'cm-live' })];
