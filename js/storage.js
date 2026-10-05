// Swappable storage module. Interface: load() -> {data, error, backedUp}, save(data) -> {ok, error}.
// To move to IndexedDB later, keep this shape (make it async) and change only this file.
export const SCHEMA_VERSION = 1;
const KEY = 'mdnotes:data';
const BACKUP_PREFIX = 'mdnotes:backup:';

function migrate(data) {
  // Future: if (data.version === 1) { ...; data.version = 2 }
  return data;
}

function valid(d) {
  return d && typeof d === 'object' && typeof d.version === 'number' &&
    d.folders && typeof d.folders === 'object' && !Array.isArray(d.folders) &&
    d.notes && typeof d.notes === 'object' && !Array.isArray(d.notes);
}

export function load() {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch (e) {
    return { data: null, error: 'unavailable', backedUp: false };
  }
  if (raw == null) return { data: null, error: null, backedUp: false };
  try {
    const parsed = JSON.parse(raw);
    if (!valid(parsed)) throw new Error('bad shape');
    if (parsed.version > SCHEMA_VERSION) throw new Error('newer version');
    return { data: migrate(parsed), error: null, backedUp: false };
  } catch (e) {
    let backedUp = false;
    try { localStorage.setItem(BACKUP_PREFIX + Date.now(), raw); backedUp = true; } catch (_) {}
    return { data: null, error: 'corrupt', backedUp };
  }
}

export function save(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, version: SCHEMA_VERSION }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.name === 'QuotaExceededError' ? 'full' : 'unavailable' };
  }
}
