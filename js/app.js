import * as store from './store.js';
import * as sidebar from './sidebar.js';
import * as editor from './editor.js';
import * as searchPanel from './searchpanel.js';
import * as tabs from './tabs.js';
import { splitTarget } from './wikilinks.js';
import { toast } from './ui.js';

const app = document.getElementById('app');
const banner = document.getElementById('banner');
const statusEl = document.getElementById('save-status');
const resizer = document.getElementById('resizer');

store.init();
const narrow = () => matchMedia('(max-width: 640px)').matches;
const noteOpened = ({ isNew, find } = {}) => {
  if (narrow() && !store.get().ui.sidebarCollapsed) { store.setUi({ sidebarCollapsed: true }); applyLayout(); }
  editor.load();
  if (isNew) editor.focusTitle(); else editor.focusEditor();
  if (find) editor.revealText(find);   // opened from a search: jump to the match
};
sidebar.init({ noteOpened });
tabs.init({ changed: () => noteOpened({}), newNote: () => sidebar.newNote(null) });
searchPanel.init({ open: (id, find) => { store.open(id); noteOpened({ find }); } });
editor.init();
// Following a [[wikilink]]: open the note (creating it if it doesn't exist yet), then jump to a #heading if given.
document.addEventListener('wikilink', e => {
  const { note: name, heading } = splitTarget(e.detail.target);
  const from = store.get().ui.openNoteId;
  let note = name ? store.resolveNote(e.detail.target, from) : store.get().notes[from];
  let created = false;
  if (!note) {
    if (e.detail.readOnly) return toast(`"${name}" doesn't exist yet. Switch to Edit mode to create it.`);   // Read mode changes nothing
    const folder = store.get().notes[from]?.folderId ?? null;
    note = store.get().notes[store.createNoteNamed(name, folder)];
    created = true;
  }
  if (note.id !== from) { store.open(note.id, { newTab: !!e.detail.newTab }); noteOpened({}); }
  if (created) toast(`Created note "${note.name}"`);
  if (heading) editor.revealHeading(heading) || toast(`No heading "${heading}" in "${note.name}".`);
});
document.addEventListener('props:author', e => { if (store.get().ui.author !== e.detail) store.setUi({ author: e.detail }); });

// ---------- layout ----------
function applyLayout() {
  const { sidebarWidth, sidebarCollapsed } = store.get().ui;
  app.style.setProperty('--sidebar-w', sidebarWidth + 'px');
  app.classList.toggle('collapsed', !!sidebarCollapsed);
  document.getElementById('btn-collapse').setAttribute('aria-expanded', !sidebarCollapsed);
  resizer.setAttribute('aria-valuenow', sidebarWidth);
}
function toggleSidebar() { store.setUi({ sidebarCollapsed: !store.get().ui.sidebarCollapsed }); applyLayout(); }
document.getElementById('btn-collapse').onclick = toggleSidebar;
document.getElementById('rail-expand').onclick = toggleSidebar;
document.getElementById('rail-new-note').onclick = () => sidebar.newNote(null);

// ---------- theme ----------
const darkMq = matchMedia('(prefers-color-scheme: dark)');
const effTheme = () => store.get().ui.theme || (darkMq.matches ? 'dark' : 'light');
function applyTheme() {
  const { theme } = store.get().ui, root = document.documentElement, eff = effTheme();
  if (theme) root.dataset.theme = theme; else delete root.dataset.theme;
  root.dataset.eff = eff;
  const b = document.getElementById('btn-theme');
  b.title = b.ariaLabel = eff === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}
document.getElementById('btn-theme').onclick = () => { store.setUi({ theme: effTheme() === 'dark' ? 'light' : 'dark' }); applyTheme(); };
darkMq.addEventListener('change', applyTheme);
applyTheme();

const clampW = w => Math.max(180, Math.min(600, Math.round(w)));
resizer.addEventListener('pointerdown', e => {
  resizer.setPointerCapture(e.pointerId);
  const move = ev => { store.get().ui.sidebarWidth = clampW(ev.clientX); applyLayout(); };
  const up = () => { resizer.removeEventListener('pointermove', move); resizer.removeEventListener('pointerup', up); store.setUi({ sidebarWidth: store.get().ui.sidebarWidth }); };
  resizer.addEventListener('pointermove', move); resizer.addEventListener('pointerup', up);
});
resizer.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  store.setUi({ sidebarWidth: clampW(store.get().ui.sidebarWidth + (e.key === 'ArrowRight' ? 16 : -16)) }); applyLayout();
});
applyLayout();
if (narrow() && !store.get().ui.sidebarCollapsed) { store.setUi({ sidebarCollapsed: true }); applyLayout(); }

// ---------- save status / warnings ----------
let notice = '';   // persistent notice (e.g. corrupt-data recovery) shown whenever there is no save error
function showBanner(msg) { banner.textContent = msg; banner.hidden = !msg; }
function setStatus(kind) {
  if (kind === 'error') {
    statusEl.textContent = 'Not saved'; statusEl.dataset.state = 'error';
    showBanner(store.getSaveError() === 'full'
      ? 'Browser storage is full. Your changes are NOT being saved. Copy important notes elsewhere; delete notes to free space.'
      : 'Browser storage is unavailable. Your changes are NOT being saved and will be lost when you close this tab.');
  } else {
    statusEl.textContent = kind === 'pending' ? 'Saving...' : 'Saved'; statusEl.dataset.state = kind;
    if (kind === 'saved') showBanner(notice);
  }
}
store.subscribe((t, d) => { if (t === 'save') setStatus(d); });
const prob = store.getInitProblem();
if (prob) {
  if (prob.error === 'unavailable') { setStatus('error'); showBanner('Browser storage is unavailable. Your changes are NOT being saved and will be lost when you close this tab.'); }
  else notice = ('Saved data could not be read, so the app started empty. The old data was kept under a backup key in this browser storage.' + (prob.backedUp ? '' : ' (Backup failed.)'));
}
setStatus(store.getSaveError() ? 'error' : 'saved');
if (prob && prob.error === 'unavailable') setStatus('error');

window.addEventListener('beforeunload', store.flush);
window.addEventListener('pagehide', store.flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); });

// ---------- back / forward through the notes you've opened ----------
const btnBack = document.getElementById('btn-back'), btnForward = document.getElementById('btn-forward');
let navStack = [], navIdx = -1, navigating = false;
const navLive = i => !!store.get().notes[navStack[i]] && navStack[i] !== store.get().ui.openNoteId;
const navTarget = dir => { for (let i = navIdx + dir; i >= 0 && i < navStack.length; i += dir) if (navLive(i)) return i; return -1; };
function updateNav() { btnBack.disabled = navTarget(-1) < 0; btnForward.disabled = navTarget(1) < 0; }
function recordNav() {
  const id = store.get().ui.openNoteId;
  if (!navigating && id && navStack[navIdx] !== id) {
    navStack = navStack.slice(0, navIdx + 1); navStack.push(id);
    if (navStack.length > 100) navStack.shift();
    navIdx = navStack.length - 1;
  }
  updateNav();
}
function navGo(dir) {
  const i = navTarget(dir);
  if (i < 0) return;
  navIdx = i; navigating = true;
  store.open(navStack[i]); noteOpened({});
  navigating = false; updateNav();
}
btnBack.onclick = () => navGo(-1);
btnForward.onclick = () => navGo(1);
store.subscribe(t => { if (t === 'open') recordNav(); });
recordNav();

// ---------- export ----------
// The note's content already carries its YAML properties block, so the file is the note as plain markdown.
document.getElementById('btn-export').onclick = () => {
  const st = store.get(), n = st.notes[st.ui.openNoteId];
  if (!n) return;
  store.flush();
  const name = (n.name || 'note').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '-').trim().replace(/^\.+/, '') || 'note';
  const text = n.content.endsWith('\n') || n.content === '' ? n.content : n.content + '\n';
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name + '.md' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ---------- global shortcuts ----------
// Ctrl/Cmd+Alt+W closes the current tab (the browser keeps plain Ctrl/Cmd+W for itself).
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && e.code === 'KeyW') { e.preventDefault(); tabs.closeActive(); }
}, true);
// Ctrl/Cmd+Space opens search. Capture phase so the editor can't swallow it. Ctrl/Cmd+K does the same: on a Mac,
// Cmd+Space is normally taken by Spotlight and never reaches the page.
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.code === 'Space' || e.code === 'KeyK')) {
    e.preventDefault(); e.stopPropagation();
    searchPanel.toggle();
  }
}, true);
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.altKey && e.code === 'KeyN') { e.preventDefault(); sidebar.newNote(null); }
  else if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyE') { e.preventDefault(); editor.toggleMode(); }
  else if (mod && !e.altKey && e.code === 'Backslash') { e.preventDefault(); toggleSidebar(); }
});
document.getElementById('btn-new-note-top')?.addEventListener('click', () => sidebar.newNote(null));

editor.focusTitle();   // the page always opens on a new note: start by naming it
