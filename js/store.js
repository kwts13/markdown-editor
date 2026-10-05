// State store: ID-based flat maps. folders {id,name,parentId}, notes {id,name,folderId,content,updatedAt}.
import * as storage from './storage.js';

export const MAX_NAME = 100;
const listeners = new Set();
let state = { folders: {}, notes: {}, ui: { openNoteId: null, expanded: [], sidebarWidth: 280, sidebarCollapsed: false, viewMode: 'edit', author: '', sortBy: 'name-asc', foldersFirst: false } };
let saveTimer = null;
let dirty = false;
let saveError = null;
let initProblem = null;

export const get = () => state;
export const getSaveError = () => saveError;
export const getInitProblem = () => initProblem;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (type, detail) => listeners.forEach(fn => fn(type, detail));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

const DEFAULT_RE = /^Untitled( \d+)?$/;
const TEMPLATE_RE = /^---\ndate:[^\n]*\nauthor:[^\n]*\n---\n?$/;   // a note nobody has typed in yet
const isUntouched = n => DEFAULT_RE.test(n.name) && (n.content === '' || TEMPLATE_RE.test(n.content));

// Every new note starts with Properties: the creation date and the author (the name last entered, if any).
function defaultContent() {
  const d = new Date(), pad = x => String(x).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const author = (state.ui.author || '').trim();
  const quoted = !author ? '' : /^[\w][\w .'-]*$/.test(author) && !/^(true|false|null|yes|no|on|off)$/i.test(author) && !/^[\d.-]+$/.test(author) ? ' ' + author : ' ' + JSON.stringify(author);
  return `---\ndate: ${date}\nauthor:${quoted}\n---\n`;
}

export function init() {
  const { data, error, backedUp } = storage.load();
  if (error) initProblem = { error, backedUp };
  if (data) {
    const folders = {}, notes = {};
    for (const [id, f] of Object.entries(data.folders)) {
      if (f && typeof f.name === 'string') folders[id] = { id, name: f.name, parentId: f.parentId || null, createdAt: f.createdAt || 0, order: Number.isFinite(f.order) ? f.order : undefined };
    }
    for (const f of Object.values(folders)) if (f.parentId && !folders[f.parentId]) f.parentId = null;
    for (const [id, n] of Object.entries(data.notes)) {
      if (n && typeof n.name === 'string') {
        notes[id] = { id, name: n.name, folderId: n.folderId && folders[n.folderId] ? n.folderId : null,
          content: typeof n.content === 'string' ? n.content : '', updatedAt: n.updatedAt || 0,
          createdAt: n.createdAt || n.updatedAt || 0, order: Number.isFinite(n.order) ? n.order : undefined };
      }
    }
    const ui = { ...state.ui, ...(data.ui || {}) };
    ui.expanded = (ui.expanded || []).filter(id => folders[id]);
    if (!['edit', 'read'].includes(ui.viewMode)) ui.viewMode = 'edit';
    if (!SORT_MODES.includes(ui.sortBy)) ui.sortBy = 'name-asc';
    state = { folders, notes, ui };
    if (!ui.unifiedOrder) mergeLegacyOrders();
    for (const f of Object.values(state.folders)) {   // folders from older versions have no creation time: use their oldest note
      if (f.createdAt) continue;
      const times = Object.values(state.notes).filter(n => subtreeFolderIds(f.id).includes(n.folderId)).map(n => n.createdAt || n.updatedAt || 0).filter(Boolean);
      f.createdAt = times.length ? Math.min(...times) : Date.now();
    }
    // AC-2: discard untouched empty default-named notes
    for (const n of Object.values(state.notes)) {
      if (isUntouched(n)) delete state.notes[n.id];
    }
  }
  const id = createNote(null, { silent: true });
  state.ui.openNoteId = id;
  if (state.ui.viewMode === 'read') state.ui.viewMode = 'edit';
  persistNow();
  emit('tree'); emit('open');
}

// ---------- persistence ----------
function schedule() {
  dirty = true;
  clearTimeout(saveTimer);
  emit('save', 'pending');
  saveTimer = setTimeout(persistNow, 600);
}
export function persistNow() {
  clearTimeout(saveTimer);
  const res = storage.save(state);
  if (res.ok) { saveError = null; dirty = false; emit('save', 'saved'); }
  else { saveError = res.error; emit('save', 'error'); }
}
export function flush() { if (dirty) persistNow(); }
export const isDirty = () => dirty;

// ---------- queries ----------
export const SORT_MODES = ['name-asc', 'name-desc', 'modified-desc', 'modified-asc', 'created-desc', 'created-asc', 'manual'];
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
function folderModified(f) {
  let t = f.createdAt || 0;
  for (const id of subtreeFolderIds(f.id)) for (const n of Object.values(state.notes)) if (n.folderId === id) t = Math.max(t, n.updatedAt || 0);
  return t;
}
function comparator(kind) {
  const mode = state.ui.sortBy || 'name-asc';
  const by = (get, dir) => (a, b) => (dir * (get(a) - get(b))) || byName(a, b);
  const modified = kind === 'folder' ? folderModified : n => n.updatedAt || 0;
  const created = x => x.createdAt || x.updatedAt || 0;
  switch (mode) {
    case 'name-desc': return (a, b) => byName(b, a);
    case 'modified-desc': return by(modified, -1);
    case 'modified-asc': return by(modified, 1);
    case 'created-desc': return by(created, -1);
    case 'created-asc': return by(created, 1);
    case 'manual': return (a, b) => ((a.order ?? Infinity) - (b.order ?? Infinity) || 0) || byName(a, b);
    default: return byName;
  }
}
// Folders are listed before notes; each group follows the chosen sort.
export function childFolders(parentId) {
  return Object.values(state.folders).filter(f => f.parentId === parentId).sort(comparator('folder'));
}
export function childNotes(folderId) {
  return Object.values(state.notes).filter(n => n.folderId === folderId).sort(comparator('note'));
}

// ---------- manual order ----------
// In Manual mode folders and notes share one ordered list per parent, so a folder can sit between notes.
const allSiblings = parentId => [...Object.values(state.folders).filter(f => f.parentId === parentId),
  ...Object.values(state.notes).filter(n => n.folderId === parentId)];
const groupParents = () => [null, ...Object.keys(state.folders)];
const nextOrder = (parentId, exceptId) => 1 + Math.max(-1, ...allSiblings(parentId).filter(x => x.id !== exceptId).map(x => x.order ?? -1));
// order for an item added to a list: only when the whole list is already ordered (otherwise seedManual handles it later)
const orderForNew = (parentId, exceptId) => (allSiblings(parentId).filter(x => x.id !== exceptId).every(x => x.order !== undefined) ? nextOrder(parentId, exceptId) : undefined);
// What the sidebar shows inside a folder: one mixed list in Manual mode, otherwise folders first, then notes.
export function children(parentId) {
  const items = allSiblings(parentId), mode = state.ui.sortBy || 'name-asc';
  if (mode === 'manual') return items.sort(comparator('note'));
  // every sort applies to folders and notes alike; "Folders first" just groups the folders on top
  const isFolder = x => !!state.folders[x.id];
  const key = new Map(items.map(x => [x.id, mode.startsWith('modified') ? (isFolder(x) ? folderModified(x) : x.updatedAt || 0) : x.createdAt || x.updatedAt || 0]));
  const dir = mode.endsWith('-desc') ? -1 : 1;
  items.sort(mode.startsWith('name') ? (a, b) => dir * byName(a, b) : (a, b) => (dir * (key.get(a.id) - key.get(b.id))) || byName(a, b));
  return state.ui.foldersFirst ? [...items.filter(isFolder), ...items.filter(x => !isFolder(x))] : items;
}

// Give every item a manual position. Brand-new orders start from what is currently shown, so switching
// to Manual keeps the list looking the same; items that already have a position are left alone.
function seedManual() {
  for (const parentId of groupParents()) {
    const list = allSiblings(parentId);
    const missing = list.filter(x => x.order === undefined);
    if (!missing.length) continue;
    if (!list.some(x => x.order !== undefined)) children(parentId).forEach((x, i) => { x.order = i; });
    else {
      let n = nextOrder(parentId);
      missing.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).forEach(x => { x.order = n++; });
    }
  }
}
// Earlier versions ordered folders and notes separately; merge them (folders first) into one list per parent.
function mergeLegacyOrders() {
  for (const parentId of groupParents()) {
    const list = allSiblings(parentId);
    if (!list.some(x => x.order !== undefined)) continue;
    const byOrder = (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || byName(a, b);
    const folders = list.filter(x => state.folders[x.id]).sort(byOrder), notes = list.filter(x => state.notes[x.id]).sort(byOrder);
    [...folders, ...notes].forEach((x, i) => { x.order = i; });
  }
  state.ui.unifiedOrder = true;
}
export function setFoldersFirst(on) {
  state.ui.foldersFirst = !!on;
  schedule(); emit('tree'); emit('ui');
}
export function setSort(mode) {
  if (!SORT_MODES.includes(mode)) return;
  if (mode === 'manual') seedManual();
  state.ui.sortBy = mode;
  schedule(); emit('tree'); emit('ui');
}
// Place an item among its siblings: before/after refId (a sibling of the same kind), or at the end when refId is null.
// Moving into another folder also renames on a name clash, like move().
export function reorder(kind, id, parentId, refId, after = false) {   // refId may be a folder or a note
  parentId = parentId || null;
  const item = kind === 'folder' ? state.folders[id] : state.notes[id];
  if (!item) return { ok: false, error: 'Nothing to move.' };
  if (kind === 'folder' && parentId && isDescendant(parentId, id)) return { ok: false, error: 'A folder cannot be moved into itself or its subfolders.' };
  if (state.ui.sortBy !== 'manual') { seedManual(); state.ui.sortBy = 'manual'; }
  const key = kind === 'folder' ? 'parentId' : 'folderId';
  const oldName = item.name;
  if ((item[key] || null) !== parentId) {
    item[key] = parentId;
    item.name = uniqueName(kind, parentId, item.name, id);
    if (parentId) reveal(parentId);
  }
  const list = allSiblings(parentId).filter(x => x.id !== id).sort(comparator('note'));
  let at = refId ? list.findIndex(x => x.id === refId) : -1;
  at = at < 0 ? list.length : at + (after ? 1 : 0);
  list.splice(at, 0, item);
  list.forEach((x, i) => { x.order = i; });
  schedule(); emit('tree'); emit('ui');
  return { ok: true, renamed: item.name !== oldName ? item.name : null };
}

export function isDescendant(folderId, ancestorId) {
  let cur = folderId;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true;
    seen.add(cur);
    cur = state.folders[cur]?.parentId || null;
  }
  return false;
}
export function subtreeFolderIds(folderId) {
  const out = [folderId];
  for (const f of childFolders(folderId)) out.push(...subtreeFolderIds(f.id));
  return out;
}
export function countSubtree(folderId) {
  const ids = new Set(subtreeFolderIds(folderId));
  const notes = Object.values(state.notes).filter(n => ids.has(n.folderId)).length;
  return { notes, folders: ids.size - 1 };
}

function siblingNames(kind, parentId, exceptId) {
  const list = kind === 'folder' ? Object.values(state.folders).filter(f => f.parentId === parentId)
    : Object.values(state.notes).filter(n => n.folderId === parentId);
  return list.filter(x => x.id !== exceptId).map(x => x.name.toLowerCase());
}
function uniqueName(kind, parentId, base, exceptId) {
  const taken = new Set(siblingNames(kind, parentId, exceptId));
  if (!taken.has(base.toLowerCase())) return base;
  let i = 1;
  while (taken.has(`${base} ${i}`.toLowerCase())) i++;
  return `${base} ${i}`;
}

export function validateName(kind, id, raw) {
  const name = String(raw).trim();
  if (!name) return { error: 'Name cannot be empty.' };
  if (/[\/\\]/.test(name)) return { error: 'Name cannot contain / or \\.' };
  if (name.length > MAX_NAME) return { error: `Name must be ${MAX_NAME} characters or fewer.` };
  const item = kind === 'folder' ? state.folders[id] : state.notes[id];
  const parentId = kind === 'folder' ? item.parentId : item.folderId;
  if (siblingNames(kind, parentId, id).includes(name.toLowerCase())) {
    return { error: `A ${kind} named "${name}" already exists here.` };
  }
  return { name };
}

// ---------- mutations ----------
export function createNote(folderId = null, opts = {}) {
  const id = uid();
  state.notes[id] = { id, name: uniqueName('note', folderId, 'Untitled'), folderId, content: defaultContent(), updatedAt: Date.now(), createdAt: Date.now(), order: orderForNew(folderId) };
  if (folderId) reveal(folderId);
  if (!opts.silent) { state.ui.openNoteId = id; if (state.ui.viewMode === 'read') state.ui.viewMode = 'edit'; schedule(); emit('tree'); emit('open'); }
  return id;
}
export function createFolder(parentId = null) {
  const id = uid();
  state.folders[id] = { id, name: uniqueName('folder', parentId, 'New folder'), parentId, createdAt: Date.now(), order: orderForNew(parentId) };
  if (parentId) reveal(parentId);
  schedule(); emit('tree');
  return id;
}
// ---------- wikilinks ----------
// [[Name]], [[Folder/Name]], [[Name|alias]], [[Name#Heading]] and [[#Heading]] (this note).
export function folderPath(folderId) {
  const names = [];
  for (let f = state.folders[folderId]; f; f = state.folders[f.parentId]) names.unshift(f.name);
  return names;
}
// Find the note a link target points at. Names match case-insensitively; with several matches, prefer the
// note in the same folder as the one containing the link, then the oldest.
export function resolveNote(target, fromId) {
  const parts = String(target).split('#')[0].split('/').map(x => x.trim().toLowerCase()).filter(Boolean);
  const name = parts.pop();
  if (!name) return null;
  const hits = Object.values(state.notes).filter(n => {
    if (n.name.toLowerCase() !== name) return false;
    if (!parts.length) return true;
    const path = folderPath(n.folderId).map(x => x.toLowerCase());
    return parts.every((p, i) => path[path.length - parts.length + i] === p);
  });
  if (!hits.length) return null;
  const from = state.notes[fromId];
  return hits.sort((a, b) => ((b.folderId === from?.folderId) - (a.folderId === from?.folderId)) || (a.createdAt || 0) - (b.createdAt || 0))[0];
}
export function createNoteNamed(rawName, folderId = null) {
  const name = String(rawName).split('/').pop().replace(/[\\]/g, '').trim().slice(0, MAX_NAME) || 'Untitled';
  const id = createNote(folderId, { silent: true });
  state.notes[id].name = uniqueName('note', folderId, name, id);
  state.notes[id].content = defaultContent();
  schedule(); emit('tree');
  return id;
}
// Rewrite [[links]] that point at a note being renamed so they keep working.
function relinkAfterRename(note, oldName, newName) {
  const re = /\[\[([^\[\]\n|#]*?)((?:#[^\[\]\n|]*)?(?:\|[^\[\]\n]*)?)\]\]/g;
  let changed = false;
  for (const n of Object.values(state.notes)) {
    const next = n.content.replace(re, (all, target, rest) => {
      const last = target.split('/').pop().trim();
      if (last.toLowerCase() !== oldName.toLowerCase()) return all;
      if (resolveNote(target, n.id)?.id !== note.id) return all;
      const prefix = target.includes('/') ? target.slice(0, target.lastIndexOf('/') + 1) : '';
      return `[[${prefix}${newName}${rest}]]`;
    });
    if (next !== n.content) { n.content = next; n.updatedAt = Date.now(); changed = true; }
  }
  return changed;
}

export function rename(kind, id, raw) {
  const v = validateName(kind, id, raw);
  if (v.error) return { ok: false, error: v.error };
  const item = kind === 'folder' ? state.folders[id] : state.notes[id];
  if (item.name !== v.name) {
    let relinked = false;
    if (kind === 'note') relinked = relinkAfterRename(item, item.name, v.name);   // before the name changes, so links still resolve
    item.name = v.name; schedule(); emit('tree');
    if (relinked) emit('content');
  }
  return { ok: true, name: v.name };
}
export function canMove(kind, id, targetFolderId) {
  if (kind === 'folder') {
    if (targetFolderId && isDescendant(targetFolderId, id)) return false;
    return (state.folders[id].parentId || null) !== (targetFolderId || null);
  }
  return (state.notes[id].folderId || null) !== (targetFolderId || null);
}
export function move(kind, id, targetFolderId) {
  targetFolderId = targetFolderId || null;
  if (!canMove(kind, id, targetFolderId)) return { ok: false, error: kind === 'folder' && targetFolderId && isDescendant(targetFolderId, id)
    ? 'A folder cannot be moved into itself or its subfolders.' : 'Already in that location.' };
  const item = kind === 'folder' ? state.folders[id] : state.notes[id];
  const old = item.name;
  if (kind === 'folder') item.parentId = targetFolderId; else item.folderId = targetFolderId;
  item.name = uniqueName(kind, targetFolderId, item.name, id);
  item.order = orderForNew(targetFolderId, id);
  if (targetFolderId) reveal(targetFolderId);
  schedule(); emit('tree');
  return { ok: true, renamed: item.name !== old ? item.name : null };
}
function afterDeleteOpenCheck() {
  if (!state.notes[state.ui.openNoteId]) {
    const rest = Object.values(state.notes).sort((a, b) => b.updatedAt - a.updatedAt);
    if (rest.length) { state.ui.openNoteId = rest[0].id; reveal(rest[0].folderId); emit('open'); }
    else createNote(null);
  }
}
export function deleteNote(id) {
  delete state.notes[id];
  afterDeleteOpenCheck(); schedule(); emit('tree');
}
export function deleteFolder(id) {
  const ids = new Set(subtreeFolderIds(id));
  for (const n of Object.values(state.notes)) if (ids.has(n.folderId)) delete state.notes[n.id];
  for (const fid of ids) delete state.folders[fid];
  state.ui.expanded = state.ui.expanded.filter(x => !ids.has(x));
  afterDeleteOpenCheck(); schedule(); emit('tree');
}
export function open(id) {
  if (!state.notes[id] || state.ui.openNoteId === id) return;
  flush();
  state.ui.openNoteId = id;
  reveal(state.notes[id].folderId);
  schedule(); emit('open'); emit('tree');
}
export function setContent(id, content) {
  const n = state.notes[id];
  if (!n || n.content === content) return;
  n.content = content; n.updatedAt = Date.now();
  schedule();
}
// expand a folder and all of its ancestors
export function reveal(folderId) {
  let cur = folderId;
  const set = new Set(state.ui.expanded);
  while (cur) { set.add(cur); cur = state.folders[cur]?.parentId || null; }
  state.ui.expanded = [...set];
}
export function setExpanded(id, on) {
  const set = new Set(state.ui.expanded);
  on ? set.add(id) : set.delete(id);
  state.ui.expanded = [...set];
  schedule(); emit('tree');
}
export function setUi(patch) {
  Object.assign(state.ui, patch);
  schedule(); emit('ui');
}
