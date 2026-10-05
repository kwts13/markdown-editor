// State store: ID-based flat maps. folders {id,name,parentId}, notes {id,name,folderId,content,updatedAt}.
import * as storage from './storage.js';

export const MAX_NAME = 100;
const listeners = new Set();
let state = { folders: {}, notes: {}, ui: { openNoteId: null, expanded: [], sidebarWidth: 280, sidebarCollapsed: false, viewMode: 'edit' } };
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

export function init() {
  const { data, error, backedUp } = storage.load();
  if (error) initProblem = { error, backedUp };
  if (data) {
    const folders = {}, notes = {};
    for (const [id, f] of Object.entries(data.folders)) {
      if (f && typeof f.name === 'string') folders[id] = { id, name: f.name, parentId: f.parentId || null };
    }
    for (const f of Object.values(folders)) if (f.parentId && !folders[f.parentId]) f.parentId = null;
    for (const [id, n] of Object.entries(data.notes)) {
      if (n && typeof n.name === 'string') {
        notes[id] = { id, name: n.name, folderId: n.folderId && folders[n.folderId] ? n.folderId : null,
          content: typeof n.content === 'string' ? n.content : '', updatedAt: n.updatedAt || 0 };
      }
    }
    const ui = { ...state.ui, ...(data.ui || {}) };
    ui.expanded = (ui.expanded || []).filter(id => folders[id]);
    if (!['edit', 'read'].includes(ui.viewMode)) ui.viewMode = 'edit';
    state = { folders, notes, ui };
    // AC-2: discard untouched empty default-named notes
    for (const n of Object.values(state.notes)) {
      if (n.content === '' && DEFAULT_RE.test(n.name)) delete state.notes[n.id];
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
export function childFolders(parentId) {
  return Object.values(state.folders).filter(f => f.parentId === parentId).sort(byName);
}
export function childNotes(folderId) {
  return Object.values(state.notes).filter(n => n.folderId === folderId).sort(byName);
}
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

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
  state.notes[id] = { id, name: uniqueName('note', folderId, 'Untitled'), folderId, content: '', updatedAt: Date.now() };
  if (folderId) reveal(folderId);
  if (!opts.silent) { state.ui.openNoteId = id; if (state.ui.viewMode === 'read') state.ui.viewMode = 'edit'; schedule(); emit('tree'); emit('open'); }
  return id;
}
export function createFolder(parentId = null) {
  const id = uid();
  state.folders[id] = { id, name: uniqueName('folder', parentId, 'New folder'), parentId };
  if (parentId) reveal(parentId);
  schedule(); emit('tree');
  return id;
}
export function rename(kind, id, raw) {
  const v = validateName(kind, id, raw);
  if (v.error) return { ok: false, error: v.error };
  const item = kind === 'folder' ? state.folders[id] : state.notes[id];
  if (item.name !== v.name) { item.name = v.name; schedule(); emit('tree'); }
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
