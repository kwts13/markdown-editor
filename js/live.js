// Live-render ("live preview") for the CodeMirror editor: markdown syntax is styled in place and its
// markers are hidden except where the caret / selection is, like Obsidian's Live Preview.
import { Decoration, ViewPlugin, WidgetType, EditorView, StateField, StateEffect, syntaxTree } from '../vendor/codemirror.js';
import { frontmatter, frontmatterBody, parseProps } from './properties.js';
import * as store from './store.js';
import { WIKILINK_RE, splitTarget } from './wikilinks.js';

const hide = Decoration.replace({});
const lineDeco = cls => Decoration.line({ attributes: { class: cls } });
const markDeco = (cls, attrs) => Decoration.mark({ class: cls, attributes: attrs });
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

// ---- videos: ![](youtube / vimeo / video-file url) ----
function videoEmbed(url) {
  let m;
  if ((m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i.exec(url))) return { kind: 'iframe', src: 'https://www.youtube-nocookie.com/embed/' + m[1] };
  if ((m = /^https?:\/\/(?:www\.)?vimeo\.com\/(?:video\/)?(\d+)/i.exec(url))) return { kind: 'iframe', src: 'https://player.vimeo.com/video/' + m[1] };
  if (/^https?:\/\/[^\s]+\.(mp4|webm|ogv|mov)(\?[^\s]*)?$/i.test(url)) return { kind: 'video', src: url };
  return null;
}
class VideoWidget extends Widget {
  constructor(v) { super(v.kind + ' ' + v.src); this.v = v; }
  toDOM() {
    const wrap = document.createElement('div'); wrap.className = 'cm-video';
    if (this.v.kind === 'iframe') {
      const f = document.createElement('iframe');
      f.src = this.v.src; f.loading = 'lazy'; f.title = 'Embedded video'; f.allowFullscreen = true;
      f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen';
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups');
      wrap.append(f);
    } else {
      const v = document.createElement('video'); v.src = this.v.src; v.controls = true; v.preload = 'metadata'; wrap.append(v);
    }
    return wrap;
  }
  ignoreEvent() { return true; }
}

// ---- callouts: > [!note] Title ----
class CalloutLabel extends Widget {
  toDOM() { const s = document.createElement('span'); s.className = 'cm-callout-label'; s.textContent = this.key; return s; }
}
const CALLOUT_TYPES = { note: 'note', info: 'info', tip: 'tip', hint: 'tip', success: 'success', check: 'success', done: 'success', question: 'question', help: 'question', faq: 'question',
  warning: 'warning', caution: 'warning', attention: 'warning', danger: 'danger', error: 'danger', failure: 'danger', bug: 'bug', example: 'example', quote: 'quote', cite: 'quote', abstract: 'info', summary: 'info', todo: 'info' };

// ---- <details><summary> sections, foldable from the chevron ----
const toggleFold = StateEffect.define();
const inCodeAt = (state, pos) => {
  for (let n = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) if (/^(FencedCode|CodeBlock|InlineCode|CodeText)$/.test(n.name)) return true;
  return false;
};
function detailsBlocks(state) {
  const doc = state.doc, out = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n), t = line.text.trim().toLowerCase();
    if (t !== '<details>' && t !== '<details open>') continue;
    if (inCodeAt(state, line.from)) continue;
    let depth = 1, close = -1;
    for (let k = n + 1; k <= doc.lines; k++) {
      const tk = doc.line(k).text.trim().toLowerCase();
      if (tk === '<details>' || tk === '<details open>') depth++;
      else if (tk === '</details>' && --depth === 0) { close = k; break; }
    }
    if (close < 0) continue;
    const sm = n + 1 < close ? /^(\s*)<summary>(.*)<\/summary>\s*$/i.exec(doc.line(n + 1).text) : null;
    out.push({ open: n, summary: sm ? n + 1 : null, close });
  }
  return out;
}
class FoldedWidget extends Widget { toDOM() { const d = document.createElement('div'); d.className = 'cm-folded'; return d; } }
class DetailsToggle extends Widget {
  toDOM(view) {
    const b = document.createElement('span'); b.className = 'cm-details-toggle' + (this.key ? ' folded' : ''); b.textContent = '\u25B8';
    b.setAttribute('role', 'button'); b.setAttribute('aria-label', this.key ? 'Expand section' : 'Collapse section');
    b.addEventListener('mousedown', e => { e.preventDefault(); view.dispatch({ effects: toggleFold.of(view.state.doc.lineAt(view.posAtDOM(b)).from) }); });
    return b;
  }
  ignoreEvent() { return true; }
}
function foldDecos(state, folds) {
  if (!folds.length) return Decoration.none;
  const blocks = detailsBlocks(state), out = [];
  for (const p of folds) {
    if (p > state.doc.length) continue;
    const ln = state.doc.lineAt(p).number, b = blocks.find(x => x.summary === ln);
    if (b && b.close - 1 > b.summary) out.push(Decoration.replace({ block: true, widget: new FoldedWidget('f') }).range(state.doc.line(b.summary + 1).from, state.doc.line(b.close - 1).to));
  }
  return Decoration.set(out, true);
}
const foldField = StateField.define({
  create: () => ({ folds: [], decos: Decoration.none }),
  update(v, tr) {
    let folds = tr.docChanged ? v.folds.map(p => tr.changes.mapPos(p, -1)) : v.folds;
    for (const e of tr.effects) if (e.is(toggleFold)) folds = folds.includes(e.value) ? folds.filter(p => p !== e.value) : [...folds, e.value];
    if (!tr.docChanged && folds === v.folds) return v;
    return { folds, decos: foldDecos(tr.state, folds) };
  },
  provide: f => [EditorView.decorations.from(f, v => v.decos), EditorView.atomicRanges.of(view => view.state.field(f).decos)],
});

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

  // Properties the typed-field panel can't model (nested YAML, comments...) fall back to styled source text
  const fmAny = frontmatter(state.doc);
  const fm = fmAny && parseProps(frontmatterBody(state.doc, fmAny)) ? null : fmAny;
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
        if (fmAny && n.from < fmAny.to && name !== 'Document') return false;   // front matter is handled separately
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
          const vid = videoEmbed(url);
          if (vid && !touches(n.from, n.to)) { out.push(Decoration.replace({ widget: new VideoWidget(vid) }).range(n.from, n.to)); return false; }
          if (!vid && !touches(n.from, n.to) && SAFE_IMG.test(url)) {
            const first = n.node.firstChild, second = first && first.nextSibling;
            const alt = first && second ? text(first.to, second.from) : '';
            out.push(Decoration.replace({ widget: new ImageWidget(url, alt) }).range(n.from, n.to));
            return false;
          }
        } else if (name === 'Blockquote') {
          const first = state.doc.lineAt(n.from), last = state.doc.lineAt(n.to).number;
          const cm = /^(\s*>\s*)\[!([\w-]+)\]([+-]?)/.exec(first.text);
          if (cm && (!parent || parent.name !== 'Blockquote')) {
            const type = CALLOUT_TYPES[cm[2].toLowerCase()] || 'note';
            for (let l = first.number; l <= last; l++) {
              const ln = state.doc.line(l);
              out.push(lineDeco(`cm-callout cm-callout-${type}` + (l === first.number ? ' cm-callout-top' : '') + (l === last ? ' cm-callout-bottom' : '')).range(ln.from));
            }
            if (!lineTouched(first.from)) {
              const at = first.from + cm[1].length, endAt = at + cm[2].length + 3 + cm[3].length;
              const title = text(endAt, first.to).trim();
              out.push(Decoration.replace({ widget: new CalloutLabel(title ? '' : cm[2][0].toUpperCase() + cm[2].slice(1).toLowerCase()) }).range(at, endAt));
              if (title) out.push(markDeco('cm-callout-title').range(Math.min(first.to, endAt + (text(endAt, endAt + 1) === ' ' ? 1 : 0)), first.to));
            }
          } else {
            for (let l = first.number; l <= last; l++) out.push(lineDeco('cm-quote').range(state.doc.line(l).from));
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

  // <details> sections
  const folds = view.state.field(foldField, false)?.folds || [];
  for (const b of detailsBlocks(state)) {
    const open = state.doc.line(b.open), close = state.doc.line(b.close);
    const rangeTouched = touches(open.from, close.to);
    for (let l = b.open; l <= b.close; l++) {
      const ln = state.doc.line(l);
      out.push(lineDeco('cm-details' + (l === b.open ? ' cm-details-top' : '') + (l === b.close ? ' cm-details-bottom' : '') +
        ((l === b.open || l === b.close) && !touches(ln.from, ln.to) ? ' cm-details-collapsed' : '')).range(ln.from));
    }
    if (!touches(open.from, open.to) && open.from < open.to) out.push(hide.range(open.from, open.to));
    if (!touches(close.from, close.to) && close.from < close.to) out.push(hide.range(close.from, close.to));
    if (b.summary) {
      const sl = state.doc.line(b.summary), m = /^(\s*)(<summary>)(.*)(<\/summary>)\s*$/i.exec(sl.text);
      out.push(Decoration.widget({ widget: new DetailsToggle(folds.includes(sl.from)), side: -1 }).range(sl.from));
      if (m && !touches(sl.from, sl.to)) {
        out.push(hide.range(sl.from + m[1].length, sl.from + m[1].length + m[2].length));
        const endTag = sl.from + sl.text.trimEnd().length;
        out.push(hide.range(endTag - m[4].length, endTag));
      }
      out.push(markDeco('cm-details-summary').range(sl.from, sl.to));
    }
  }

  // [[wikilinks]]
  const openId = store.get().ui.openNoteId;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (fmAny && line.from <= fmAny.to) continue;
      if (!line.text.includes('[[')) continue;
      for (const m of line.text.matchAll(new RegExp(WIKILINK_RE.source, 'g'))) {
        const start = line.from + m.index, end = start + m[0].length, target = m[1].trim();
        if (!target || inCodeAt(state, start)) continue;
        const { note } = splitTarget(target);
        const unresolved = note && !store.resolveNote(target, openId);
        const attrs = { 'data-wikilink': target };
        const cls = 'cm-wikilink' + (unresolved ? ' unresolved' : '');
        if (touches(start, end)) { out.push(markDeco(cls, attrs).range(start, end)); continue; }
        out.push(hide.range(start, start + 2), hide.range(end - 2, end));
        if (m[2] !== undefined && m[2].trim()) {
          const aliasFrom = start + 2 + m[1].length + 1;
          out.push(hide.range(start + 2, aliasFrom), markDeco(cls, attrs).range(aliasFrom, end - 2));
        } else out.push(markDeco(cls, attrs).range(start + 2, end - 2));
      }
    }
  }
  return Decoration.set(out, true);
}

const plugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(u) {
    if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || u.transactions.some(tr => tr.effects.some(e => e.is(toggleFold)))) this.decorations = build(u.view);
  }
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

// Ctrl/Cmd+click a [[wikilink]] in the editor (plain click when reading) to go to that note
const openWikilinks = EditorView.domEventHandlers({
  mousedown(e, view) {
    const a = e.target.closest && e.target.closest('[data-wikilink]');
    if (!a || e.button !== 0) return false;
    if (view.state.facet(EditorView.editable) && !(e.ctrlKey || e.metaKey)) return false;
    e.preventDefault();
    document.dispatchEvent(new CustomEvent('wikilink', { detail: { target: a.getAttribute('data-wikilink') } }));
    return true;
  },
});

export const liveRender = [foldField, plugin, openLinks, openWikilinks, EditorView.editorAttributes.of({ class: 'cm-live' })];
