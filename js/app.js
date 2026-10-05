import * as store from './store.js';
import * as sidebar from './sidebar.js';
import * as editor from './editor.js';

const app = document.getElementById('app');
const banner = document.getElementById('banner');
const statusEl = document.getElementById('save-status');
const resizer = document.getElementById('resizer');

store.init();
const narrow = () => matchMedia('(max-width: 640px)').matches;
sidebar.init({ noteOpened: ({ isNew } = {}) => {
  if (narrow() && !store.get().ui.sidebarCollapsed) { store.setUi({ sidebarCollapsed: true }); applyLayout(); }
  editor.load();
  if (isNew) editor.focusTitle(); else editor.focusEditor();
} });
editor.init();

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

// ---------- global shortcuts ----------
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.altKey && e.code === 'KeyN') { e.preventDefault(); sidebar.newNote(null); }
  else if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyE') { e.preventDefault(); editor.toggleMode(); }
  else if (mod && !e.altKey && e.code === 'Backslash') { e.preventDefault(); toggleSidebar(); }
});
document.getElementById('btn-new-note-top')?.addEventListener('click', () => sidebar.newNote(null));

editor.focusTitle();   // the page always opens on a new note: start by naming it
