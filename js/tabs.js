// The tab bar above the note: every open note is a tab; click to switch, middle-click or × to close, drag to reorder.
import * as store from './store.js';
import { showMenu } from './ui.js';

const bar = document.getElementById('tabs');
let onChange = () => {};      // called after the active note changes so the editor can load it
let dragId = null;

export function init({ changed, newNote }) {
  onChange = changed;
  store.subscribe(t => { if (t === 'tabs' || t === 'tree') render(); });
  document.getElementById('tab-new').onclick = newNote;
  bar.addEventListener('keydown', onKey);
  bar.addEventListener('dragstart', e => {
    const tab = e.target.closest?.('.tab');
    if (!tab) return;
    dragId = tab.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
    tab.classList.add('dragging');
  });
  bar.addEventListener('dragover', e => {
    if (!dragId) return;
    const tab = e.target.closest?.('.tab');
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    bar.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
    if (tab && tab.dataset.id !== dragId) { const r = tab.getBoundingClientRect(); tab.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after'); }
  });
  bar.addEventListener('drop', e => {
    if (!dragId) return;
    e.preventDefault();
    const tab = e.target.closest?.('.tab'), tabs = store.get().ui.tabs;
    let to = tabs.length - 1;
    if (tab && tab.dataset.id !== dragId) {
      const r = tab.getBoundingClientRect(), idx = tabs.indexOf(tab.dataset.id), from = tabs.indexOf(dragId);
      to = idx + (e.clientX < r.left + r.width / 2 ? 0 : 1) - (from < idx ? 1 : 0);
    }
    const id = dragId; dragId = null;
    store.moveTab(id, to);
  });
  bar.addEventListener('dragend', () => { dragId = null; bar.querySelectorAll('.dragging, .drop-before, .drop-after').forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-after')); });
  render();
}

function activate(id) { if (store.get().ui.openNoteId !== id) { store.open(id); onChange(); } }
export function closeTab(id) {
  const wasActive = store.get().ui.openNoteId === id;
  store.closeTab(id);
  if (wasActive) onChange();
}
export function closeActive() { closeTab(store.get().ui.openNoteId); }

function render() {
  const st = store.get(), tabs = st.ui.tabs || [];
  bar.textContent = '';
  for (const id of tabs) {
    const n = st.notes[id];
    if (!n) continue;
    const active = id === st.ui.openNoteId;
    const tab = document.createElement('div');
    tab.className = 'tab' + (active ? ' active' : ''); tab.dataset.id = id; tab.draggable = true;
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', active); tab.tabIndex = active ? 0 : -1;
    const path = store.folderPath(n.folderId); tab.title = (path.length ? path.join(' / ') + ' / ' : '') + n.name;
    const label = document.createElement('span'); label.className = 'tab-label'; label.textContent = n.name;
    const x = document.createElement('button'); x.className = 'tab-close'; x.type = 'button'; x.tabIndex = -1; x.textContent = '×';
    x.setAttribute('aria-label', 'Close ' + n.name); x.title = 'Close';
    x.addEventListener('mousedown', e => e.stopPropagation());
    x.addEventListener('click', e => { e.stopPropagation(); closeTab(id); });
    tab.append(label, x);
    tab.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });   // no autoscroll on middle-click
    tab.addEventListener('click', () => activate(id));
    tab.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); closeTab(id); } });
    tab.addEventListener('contextmenu', e => { e.preventDefault(); menu(e.clientX, e.clientY, id); });
    bar.append(tab);
  }
  bar.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function menu(x, y, id) {
  const tabs = store.get().ui.tabs, i = tabs.indexOf(id);
  const items = [{ label: 'Close', action: () => closeTab(id) }];
  if (tabs.length > 1) items.push({ label: 'Close other tabs', action: () => { activate(id); store.closeTabs(tabs.filter(t => t !== id)); onChange(); } });
  if (i < tabs.length - 1) items.push({ label: 'Close tabs to the right', action: () => {
    const open = store.get().ui.openNoteId, right = tabs.slice(i + 1);
    if (right.includes(open)) activate(id);
    store.closeTabs(right); onChange();
  } });
  showMenu(x, y, items);
}

function onKey(e) {
  const tab = e.target.closest?.('.tab');
  if (!tab) return;
  const all = [...bar.querySelectorAll('.tab')], i = all.indexOf(tab);
  const go = t => { if (t) { e.preventDefault(); t.focus(); activate(t.dataset.id); bar.querySelector('.tab.active')?.focus(); } };
  if (e.key === 'ArrowRight') go(all[i + 1]);
  else if (e.key === 'ArrowLeft') go(all[i - 1]);
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); closeTab(tab.dataset.id); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(tab.dataset.id); }
}
