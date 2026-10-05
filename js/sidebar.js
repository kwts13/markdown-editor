import * as store from './store.js';
import { toast, confirmDialog, folderPicker, showMenu } from './ui.js';

const tree = document.getElementById('tree');
let focusedId = null;        // roving-tabindex item
let selectedFolderId = null; // target for "New folder"
let renamingId = null;
let renameError = '';
let dragged = null;          // {kind,id}
let onNoteOpened = () => {};

const kindOf = id => (store.get().folders[id] ? 'folder' : 'note');
const itemOf = id => store.get().folders[id] || store.get().notes[id];
const liOf = id => tree.querySelector(`li[data-id="${id}"]`);
const treeHasFocus = () => tree.contains(document.activeElement);

export function init({ noteOpened }) {
  onNoteOpened = noteOpened || onNoteOpened;
  store.subscribe(t => { if (t === 'tree') render(); });
  tree.addEventListener('click', onClick);
  tree.addEventListener('dblclick', onDblClick);
  tree.addEventListener('keydown', onKey);
  tree.addEventListener('contextmenu', onContext);
  tree.addEventListener('focusin', e => {
    const li = e.target.closest?.('li[role=treeitem]');
    if (li && li.dataset.id !== focusedId) setFocused(li.dataset.id, false);
  });
  tree.addEventListener('dragstart', onDragStart);
  tree.addEventListener('dragover', onDragOver);
  tree.addEventListener('dragleave', e => { if (!tree.contains(e.relatedTarget)) clearDrop(); });
  tree.addEventListener('drop', onDrop);
  tree.addEventListener('dragend', () => { dragged = null; clearDrop(); });
  document.getElementById('btn-sort').onclick = openSortMenu;
  document.getElementById('btn-new-note').onclick = () => newNote(selectedFolderId);
  document.getElementById('btn-new-folder').onclick = () => newFolder(selectedFolderId);
  render();
}

export function newNote(folderId = null) {
  store.createNote(folderId);
  onNoteOpened({ isNew: true });
}
export function newFolder(parentId = null) {
  const id = store.createFolder(parentId);
  startRename(id);
}

function setFocused(id, focus = true) {
  focusedId = id;
  tree.querySelectorAll('li[role=treeitem]').forEach(li => li.tabIndex = li.dataset.id === id ? 0 : -1);
  if (focus) liOf(id)?.focus();
}

// ---------- sorting ----------
const SORT_LABELS = {
  'name-asc': 'Name (A to Z)', 'name-desc': 'Name (Z to A)',
  'modified-desc': 'Modified (newest first)', 'modified-asc': 'Modified (oldest first)',
  'created-desc': 'Created (newest first)', 'created-asc': 'Created (oldest first)',
  'manual': 'Manual order',
};
function openSortMenu() {
  const btn = document.getElementById('btn-sort'), cur = store.get().ui.sortBy;
  const r = btn.getBoundingClientRect();
  const items = store.SORT_MODES.map(m => ({ label: SORT_LABELS[m], hint: m === cur ? '\u2713' : '', action: () => store.setSort(m) }));
  items.splice(store.SORT_MODES.indexOf('manual'), 0, { sep: true });
  const ff = store.get().ui.foldersFirst;
  items.push({ sep: true }, { label: 'Folders first', hint: ff ? '\u2713' : '', action: () => store.setFoldersFirst(!ff) });
  showMenu(r.left, r.bottom + 4, items);
}
function updateSortButton() {
  const b = document.getElementById('btn-sort'), cur = store.get().ui.sortBy;
  b.title = `Sort notes (${SORT_LABELS[cur]})`; b.setAttribute('aria-label', `Sort notes, currently ${SORT_LABELS[cur]}`);
}

// ---------- render ----------
function render() {
  updateSortButton();
  const hadFocus = treeHasFocus() && !renamingId;
  const st = store.get();
  const expanded = new Set(st.ui.expanded);
  tree.textContent = '';
  const total = Object.keys(st.notes).length + Object.keys(st.folders).length;
  if (total === 0) {
    const e = document.createElement('div'); e.className = 'tree-empty';
    e.innerHTML = '<p>No notes yet</p>';
    const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = 'New note';
    b.onclick = () => newNote(null);
    e.append(b); tree.append(e); return;
  }
  const ul = document.createElement('ul'); ul.setAttribute('role', 'tree'); ul.setAttribute('aria-label', 'Notes');
  tree.append(ul);
  const build = (parentId, level, parentUl) => {
    for (const item of store.children(parentId)) {
      if (st.folders[item.id]) {
        const f = item, open = expanded.has(f.id);
        const li = makeItem(f, 'folder', level);
        li.setAttribute('aria-expanded', open);
        if (selectedFolderId === f.id) li.classList.add('selected-folder');
        parentUl.append(li);
        if (open) {
          const sub = document.createElement('ul'); sub.setAttribute('role', 'group'); li.append(sub);
          build(f.id, level + 1, sub);
          if (!sub.children.length) {
            const e = document.createElement('li'); e.setAttribute('role', 'none'); e.className = 'empty';
            e.style.paddingLeft = (14 + (level + 1) * 16 + 18) + 'px'; e.textContent = 'Empty'; sub.append(e);
          }
        }
      } else {
        const n = item, li = makeItem(n, 'note', level);
        li.setAttribute('aria-selected', n.id === st.ui.openNoteId);
        if (n.id === st.ui.openNoteId) li.classList.add('active');
        parentUl.append(li);
      }
    }
  };
  build(null, 0, ul);
  const items = [...tree.querySelectorAll('li[role=treeitem]')];
  if (!items.find(li => li.dataset.id === focusedId)) focusedId = (liOf(st.ui.openNoteId) || items[0])?.dataset.id;
  items.forEach(li => li.tabIndex = li.dataset.id === focusedId ? 0 : -1);
  if (renamingId) {
    const inp = tree.querySelector('input.rename');
    if (inp) { inp.focus(); inp.select(); }
  } else if (hadFocus) liOf(focusedId)?.focus();
}

function makeItem(item, kind, level) {
  const li = document.createElement('li');
  li.setAttribute('role', 'treeitem');
  li.dataset.id = item.id; li.dataset.kind = kind;
  li.setAttribute('aria-level', level + 1);
  const row = document.createElement('div'); row.className = 'row';
  row.style.paddingLeft = (8 + level * 16) + 'px';
  row.draggable = renamingId !== item.id;
  const chev = document.createElement('span'); chev.className = 'chev'; chev.setAttribute('aria-hidden', 'true');
  chev.textContent = kind === 'folder' ? '›' : '';
  const icon = document.createElement('span'); icon.className = 'icon'; icon.setAttribute('aria-hidden', 'true');
  icon.textContent = kind === 'folder' ? '\u{1F4C1}' : '\u{1F4C4}';
  row.append(chev, icon);
  if (renamingId === item.id) {
    const inp = document.createElement('input'); inp.className = 'rename'; inp.value = item.name;
    inp.setAttribute('aria-label', `Rename ${kind}`);
    inp.maxLength = 200;
    let done = false;
    const finish = (commit, fromBlur) => {
      if (done) return;
      if (commit) {
        const res = store.rename(kind, item.id, inp.value);
        if (!res.ok) {
          if (fromBlur) { done = true; renamingId = null; renameError = ''; toast(res.error); render(); return; }
          renameError = res.error; showRenameError(row, res.error); return;
        }
      }
      done = true; renamingId = null; renameError = '';
      render(); setFocused(item.id, true);
    };
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true, false); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    inp.addEventListener('input', () => showRenameError(row, ''));
    inp.addEventListener('blur', () => finish(true, true));
    row.append(inp);
    li.append(row);
    if (renameError) showRenameError(row, renameError);
    return li;
  }
  const label = document.createElement('span'); label.className = 'label'; label.textContent = item.name; label.title = item.name;
  row.append(label);
  li.append(row);
  return li;
}
function showRenameError(row, msg) {
  let e = row.querySelector('.rename-error');
  if (!msg) { e?.remove(); return; }
  if (!e) { e = document.createElement('div'); e.className = 'rename-error'; e.setAttribute('role', 'alert'); row.append(e); }
  e.textContent = msg;
}

export function startRename(id) {
  if (!itemOf(id)) return;
  store.reveal(itemOf(id).parentId ?? itemOf(id).folderId);
  renamingId = id; renameError = '';
  render();
  setTimeout(() => { const i = tree.querySelector('input.rename'); i?.focus(); i?.select(); }, 0);
}

// ---------- actions ----------
function openItem(id) {
  if (kindOf(id) === 'note') { store.open(id); onNoteOpened(); }
}
function toggleFolder(id) {
  selectedFolderId = id;
  store.setExpanded(id, !store.get().ui.expanded.includes(id));
}
async function deleteItem(id) {
  const kind = kindOf(id), item = itemOf(id);
  let msg, title, ok;
  if (kind === 'note') { title = 'Delete note?'; msg = `"${item.name}" will be permanently deleted.`; ok = 'Delete note'; }
  else {
    const c = store.countSubtree(id);
    title = 'Delete folder?'; ok = 'Delete folder';
    msg = c.notes + c.folders === 0 ? `Empty folder "${item.name}" will be deleted.`
      : `Deleting "${item.name}" will also permanently delete ${c.notes} note${c.notes === 1 ? '' : 's'} and ${c.folders} subfolder${c.folders === 1 ? '' : 's'} inside it.`;
  }
  const yes = await confirmDialog({ title, message: msg, okLabel: ok, danger: true });
  if (!yes) { liOf(id)?.focus(); return; }
  const idx = [...tree.querySelectorAll('li[role=treeitem]')].findIndex(l => l.dataset.id === id);
  const wasOpen = store.get().ui.openNoteId;
  if (kind === 'note') store.deleteNote(id); else store.deleteFolder(id);
  if (selectedFolderId && !store.get().folders[selectedFolderId]) selectedFolderId = null;
  const items = [...tree.querySelectorAll('li[role=treeitem]')];
  (items[Math.min(idx, items.length - 1)] || items[0])?.focus();
  if (store.get().ui.openNoteId !== wasOpen) onNoteOpened(true);
}
async function moveItem(id) {
  const kind = kindOf(id);
  const options = [{ id: null, label: 'Root (top level)', level: 0, disabled: !store.canMove(kind, id, null) }];
  const walk = (pid, level) => {
    for (const f of store.childFolders(pid)) {
      const bad = (kind === 'folder' && store.isDescendant(f.id, id)) || !store.canMove(kind, id, f.id);
      options.push({ id: f.id, label: f.name, level, disabled: bad });
      walk(f.id, level + 1);
    }
  };
  walk(null, 1);
  const res = await folderPicker({ title: `Move "${itemOf(id).name}" to...`, options });
  if (!res) { liOf(id)?.focus(); return; }
  doMove(kind, id, res.id);
  setFocused(id, true);
}
function doMove(kind, id, target) {
  const r = store.move(kind, id, target);
  if (!r.ok) toast(r.error);
  else if (r.renamed) toast(`Name already taken there; renamed to "${r.renamed}".`);
}

function menuFor(id) {
  const kind = kindOf(id);
  const items = [];
  if (kind === 'folder') {
    items.push({ label: 'New note here', action: () => newNote(id) });
    items.push({ label: 'New folder here', action: () => newFolder(id) });
    items.push({ sep: true });
  } else items.push({ label: 'Open', action: () => openItem(id) });
  items.push({ label: 'Rename', hint: 'F2', action: () => startRename(id) });
  items.push({ label: 'Move to...', action: () => moveItem(id) });
  items.push({ sep: true });
  items.push({ label: 'Delete', hint: 'Del', danger: true, action: () => deleteItem(id) });
  return items;
}

// ---------- events ----------
function onClick(e) {
  const li = e.target.closest('li[role=treeitem]');
  if (!li) { selectedFolderId = null; return; }
  if (e.target.closest('input')) return;
  const id = li.dataset.id;
  setFocused(id, true);
  if (li.dataset.kind === 'folder') toggleFolder(id);
  else { selectedFolderId = null; openItem(id); }
}
function onDblClick(e) {
  const li = e.target.closest('li[role=treeitem]');
  if (!li || e.target.closest('input')) return;
  startRename(li.dataset.id);
}
function onContext(e) {
  e.preventDefault();
  const li = e.target.closest('li[role=treeitem]');
  if (!li) {
    showMenu(e.clientX, e.clientY, [
      { label: 'New note', action: () => newNote(null) }, { label: 'New folder', action: () => newFolder(null) }]);
    return;
  }
  setFocused(li.dataset.id, true);
  showMenu(e.clientX, e.clientY, menuFor(li.dataset.id));
}
function onKey(e) {
  const li = e.target.closest('li[role=treeitem]');
  if (!li || e.target.tagName === 'INPUT') return;
  const id = li.dataset.id, kind = li.dataset.kind;
  const items = [...tree.querySelectorAll('li[role=treeitem]')];
  const i = items.indexOf(li);
  const open = kind === 'folder' && li.getAttribute('aria-expanded') === 'true';
  const go = x => { if (x) setFocused(x.dataset.id, true); e.preventDefault(); };
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {   // Alt+Up/Down: move among siblings
    e.preventDefault();
    const it = itemOf(id), parentId = (kind === 'folder' ? it.parentId : it.folderId) || null;
    const sibs = store.children(parentId);
    const k = sibs.findIndex(x => x.id === id), ref = sibs[k + (e.key === 'ArrowUp' ? -1 : 1)];
    if (ref) { doReorder(kind, id, parentId, ref.id, e.key === 'ArrowDown'); setFocused(id, true); }
    return;
  }
  switch (e.key) {
    case 'ArrowDown': return go(items[i + 1]);
    case 'ArrowUp': return go(items[i - 1]);
    case 'Home': return go(items[0]);
    case 'End': return go(items[items.length - 1]);
    case 'ArrowRight':
      if (kind === 'folder' && !open) { store.setExpanded(id, true); setFocused(id, true); }
      else if (open) go(li.querySelector('li[role=treeitem]'));
      return e.preventDefault();
    case 'ArrowLeft':
      if (open) { store.setExpanded(id, false); setFocused(id, true); }
      else go(li.parentElement.closest('li[role=treeitem]'));
      return e.preventDefault();
    case 'Enter': case ' ':
      e.preventDefault();
      if (kind === 'folder') { toggleFolder(id); setFocused(id, true); } else openItem(id);
      return;
    case 'F2': e.preventDefault(); return startRename(id);
    case 'Delete': case 'Backspace':
      if (e.key === 'Backspace' && !e.metaKey) return;
      e.preventDefault(); return deleteItem(id);
    case 'ContextMenu': case 'F10': {
      if (e.key === 'F10' && !e.shiftKey) return;
      e.preventDefault();
      const r = li.querySelector('.row').getBoundingClientRect();
      return showMenu(r.left + 24, r.bottom, menuFor(id));
    }
  }
}

// ---------- drag and drop ----------
function onDragStart(e) {
  const li = e.target.closest?.('li[role=treeitem]');
  if (!li) return;
  dragged = { kind: li.dataset.kind, id: li.dataset.id };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', li.dataset.id);
}
function dropTargetFor(e) {
  const li = e.target.closest?.('li[role=treeitem]');
  if (!li) return { folderId: null };
  if (li.dataset.kind === 'folder') return { folderId: li.dataset.id, li };
  const n = store.get().notes[li.dataset.id];
  return { folderId: n.folderId, li: n.folderId ? liOf(n.folderId) : null };
}
function clearDrop() {
  tree.classList.remove('drop-root');
  tree.querySelectorAll('.drop-target, .drop-before, .drop-after').forEach(x => x.classList.remove('drop-target', 'drop-before', 'drop-after'));
}
// Dropping near the top/bottom edge of a sibling reorders; the middle of a folder still moves into it.
function reorderTarget(e) {
  if (!dragged) return null;
  const li = e.target.closest?.('li[role=treeitem]');
  if (!li || li.dataset.id === dragged.id) return null;
  const item = itemOf(li.dataset.id), parentId = (li.dataset.kind === 'folder' ? item.parentId : item.folderId) || null;
  if (dragged.kind === 'folder' && parentId && (parentId === dragged.id || store.isDescendant(parentId, dragged.id))) return null;
  const row = li.querySelector('.row'), r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
  const isFolder = li.dataset.kind === 'folder', openFolder = isFolder && li.getAttribute('aria-expanded') === 'true';
  const pos = isFolder ? (y < 0.3 ? 'before' : y > 0.7 && !openFolder ? 'after' : null) : (y < 0.5 ? 'before' : 'after');
  if (!pos) return null;
  const cur = itemOf(dragged.id), curParent = (dragged.kind === 'folder' ? cur.parentId : cur.folderId) || null;
  if (store.get().ui.sortBy !== 'manual' && curParent !== parentId) return null;   // outside Manual, only same-folder drops reorder; others stay plain moves
  return { row, pos, parentId, refId: li.dataset.id };
}
function onDragOver(e) {
  if (!dragged) return;
  const rt = reorderTarget(e);
  if (rt) { clearDrop(); e.preventDefault(); e.dataTransfer.dropEffect = 'move'; rt.row.classList.add(rt.pos === 'before' ? 'drop-before' : 'drop-after'); return; }
  const t = dropTargetFor(e);
  clearDrop();
  if (!store.get().folders[dragged.id] && !store.get().notes[dragged.id]) return;
  if (!store.canMove(dragged.kind, dragged.id, t.folderId)) return; // not a valid target: no preventDefault
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  if (t.li) t.li.querySelector('.row').classList.add('drop-target'); else tree.classList.add('drop-root');
}
function doReorder(kind, id, parentId, refId, after) {
  const wasManual = store.get().ui.sortBy === 'manual';
  const r = store.reorder(kind, id, parentId, refId, after);
  if (!r.ok) toast(r.error);
  else if (r.renamed) toast(`Name already taken there; renamed to "${r.renamed}".`);
  else if (!wasManual) toast('Switched to manual order.');
}
function onDrop(e) {
  if (!dragged) return;
  e.preventDefault();
  const rt = reorderTarget(e);
  if (rt) { const d = dragged; dragged = null; clearDrop(); doReorder(d.kind, d.id, rt.parentId, rt.refId, rt.pos === 'after'); setFocused(d.id, false); return; }
  const t = dropTargetFor(e);
  const d = dragged; dragged = null; clearDrop();
  if (store.canMove(d.kind, d.id, t.folderId)) doMove(d.kind, d.id, t.folderId);
}

export function focusActive() { const id = store.get().ui.openNoteId; liOf(id)?.scrollIntoView({ block: 'nearest' }); }
