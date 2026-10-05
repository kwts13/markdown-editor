# Markdown Notes (working title) - MVP Requirements

## 1. Goals
- G1: Fast, distraction-free markdown editing in the browser ("Obsidian on the web", minimal slice).
- G2: Zero friction: opening the page lands the user in a new, ready-to-type note.
- G3: Organise notes in a sidebar with nested folders.
- G4: Local-first: no account, no server, data survives reloads.

## 2. Non-goals (MVP)
Sync/accounts/collaboration; wikilinks, backlinks, graph view; tags, search, command palette; plugins/themes; attachments/images upload; export/import of vaults; mobile-optimised UI; undo for delete beyond a confirm dialog; multi-tab live sync; encryption.

## 3. Priorities
MUST = MVP ships only with it. SHOULD = expected, cut last. COULD = if time allows.

## 4. User stories and acceptance criteria

### US-1 New note on load (Must)
As a user, I open the app and can type immediately.
- AC-1: On first visit (no stored data), a new note titled "Untitled" is created and selected, and the editor has keyboard focus.
- AC-2: On later visits, the app opens to a fresh new note (per brief), and previous notes remain in the sidebar. A fresh note that is never edited is discarded on next load, so empty notes do not accumulate (see OQ-1).
- AC-3: A "New note" button and shortcut (Ctrl/Cmd+Alt+N; see OQ-6) create a note and focus the editor.

### US-2 Markdown editing (Must)
- AC-4: Editor is a plain-text markdown source editor with monospaced or readable font, soft wrap, and no toolbar.
- AC-5: Two view modes toggled by button and Ctrl/Cmd+E: Edit (source) and Preview (rendered). Preview renders headings, bold/italic, strikethrough, inline code, fenced code blocks, blockquotes, ordered/unordered lists, task lists, links, horizontal rules, and tables (GFM subset). (Should: side-by-side split mode. Could: live-render in-place like Obsidian, see OQ-2.)
- AC-6: Preview is sanitised; raw HTML/script in markdown cannot execute.
- AC-7 (Must): Tab inserts two spaces (or indents selected lines); Shift+Tab outdents. Escape then Tab leaves the editor to preserve keyboard accessibility.
- AC-8 (Should): Enter within a list continues the list marker; Enter on an empty marker ends the list. Ctrl/Cmd+B / I wrap the selection in `**` / `*`.
- AC-9 (Must): Autosave: changes persist within 1s of last keystroke (debounced) and on blur/`visibilitychange`/`beforeunload`. No save button. A subtle "Saved" status is shown.
- AC-10: Typing in a 10,000-line note shows no perceptible input lag (<50ms per keystroke on a mid-range laptop).

### US-3 Sidebar listing (Must)
- AC-11: Sidebar lists all notes and folders as a tree; folders first, then notes, each sorted alphabetically (case-insensitive).
- AC-12: Selecting a note opens it in the editor; the active note is highlighted.
- AC-13: Note title in the sidebar is the note's name (see US-4); updates immediately on rename.
- AC-14 (Should): Sidebar is collapsible and resizable; collapsed state persists.
- AC-15: Empty state: with zero notes the sidebar shows "No notes yet" with a New note action; with an empty folder it shows "Empty" when expanded.

### US-4 Note create / rename / delete (Must)
- AC-16: Notes have a name separate from content (Obsidian-style; file-like). Default "Untitled", then "Untitled 1", "Untitled 2" for uniqueness within a folder.
- AC-17: Rename via double-click or F2 / context menu; Enter commits, Escape cancels.
- AC-18: Empty or whitespace-only name is rejected; previous name is kept and an inline message is shown.
- AC-19: Duplicate name within the same folder (case-insensitive) is rejected with an inline message. Same name in different folders is allowed.
- AC-20: Names may not contain `/` or `\`; leading/trailing whitespace is trimmed; max 100 chars.
- AC-21: Delete via context menu or Delete key on a focused item, with a confirm dialog. Deleting the open note opens the most recent other note, or a new note if none remain.

### US-5 Folder create / rename / delete (Must)
- AC-22: "New folder" creates a folder (root, or inside the selected folder) and enters rename mode immediately. Default "New folder", uniquified.
- AC-23: Folder rename follows AC-17 to AC-20 (folder names must be unique among sibling folders; folders and notes have separate namespaces, see OQ-5).
- AC-24: Deleting an empty folder asks for simple confirmation.
- AC-25: Deleting a non-empty folder shows a confirm dialog stating the number of notes and subfolders that will be deleted; Cancel is default focus. Confirming deletes everything inside; cancelling changes nothing.
- AC-26: Folders can be collapsed/expanded; expanded state persists across reloads (Should).

### US-6 Move notes into folders (Must)
- AC-27: Drag a note onto a folder moves it there; drag onto the root area moves it to root. Drop target is visibly highlighted.
- AC-28: Non-drag fallback (Must): context menu "Move to..." opens a folder picker (tree incl. "Root"), keyboard operable.
- AC-29: Moving a note into a folder holding a same-named note is rejected with a message (or auto-suffixed; see OQ-4).
- AC-30 (Should): Folders can be moved the same two ways. A folder cannot be moved into itself or its descendants; such drops are blocked.

### US-7 Nested folders (Must)
- AC-31: Folders can contain folders to arbitrary depth (UI tested to 10 levels), indented visually, creatable via folder context menu "New folder / New note here".
- AC-32: Moving or deleting a folder applies to its entire subtree.

### US-8 Persistence (Must)
- AC-33: After reload, all notes, folder structure, names, content, and the last open note are restored (see OQ-1 for the on-load rule).
- AC-34: Data is stored locally in the browser only; no network requests carry note content.
- AC-35: If storage is unavailable or full, the user sees a persistent warning that changes are not being saved; the app does not lose in-memory content silently.
- AC-36: Data schema carries a version number to allow later migration.
- AC-37 (Should): Corrupt/unreadable stored data does not blank the app; app starts empty and keeps the raw blob under a backup key.

### US-9 Accessibility and keyboard (Should)
- AC-38: Sidebar tree uses ARIA tree semantics and arrow-key navigation; all actions reachable without a mouse.
- AC-39: Meets WCAG AA contrast; respects `prefers-color-scheme` (Could: manual toggle).

## 5. Technical direction (recommendation)
- Static site, no backend, no build step: `index.html` + ES modules + CSS, served from any static host or opened locally via a simple dev server.
- Editor: plain `<textarea>` for MVP (robust, accessible, trivial Tab handling), or CodeMirror 6 loaded via ESM CDN if live-render is pulled into scope (see OQ-2). Markdown: `marked` or `markdown-it` plus `DOMPurify`, via ESM CDN, pinned versions (vendor into repo to work offline).
- Persistence: IndexedDB preferred for scale; `localStorage` single JSON blob is acceptable for MVP (5MB limit; simplest). Recommend localStorage behind a small storage module interface so it can swap to IndexedDB.
- Data model: flat maps with ids: `folders {id, name, parentId}`, `notes {id, name, folderId|null, content, updatedAt}`, plus `ui {openNoteId, expanded[], sidebarWidth}`. IDs are random (crypto.randomUUID); names are labels, so renames never break references.
- Vanilla JS with a tiny state store is sufficient; avoid frameworks unless the team prefers one.
- Targets: latest Chrome, Firefox, Safari, Edge on desktop.

## 6. Open questions and defaults
| # | Question | Recommended default |
|---|----------|---------------------|
| OQ-1 | "Opens to new note" every visit vs. restoring last note? | Always open a new note on load; discard previous untouched empty notes; last-edited notes are one click away in the sidebar. |
| OQ-2 | Live-render (Obsidian-style) vs. edit/preview toggle? | Edit/Preview toggle for MVP; live-render is a post-MVP upgrade (needs CodeMirror). |
| OQ-3 | Note name vs. first-line title? | Separate name, default "Untitled"; Could: auto-name from first `# heading` while still default-named. |
| OQ-4 | Move collision: reject or auto-suffix? | Auto-suffix (" 1") on move, reject on rename. |
| OQ-5 | Can a folder and a note share a name in the same parent? | Yes (separate namespaces). |
| OQ-6 | New-note shortcut (Ctrl+N is browser-reserved)? | Ctrl/Cmd+Alt+N; button always available. |
| OQ-7 | Show ".md" extension in names? | No; hidden, names are plain labels. |
| OQ-8 | Delete: confirm vs. undo? | Confirm dialog for MVP; Could: toast with Undo. |
| OQ-9 | Manual note ordering? | No; alphabetical only. |
| OQ-10 | Export/backup? | Out of MVP; Could: download all as zip of .md files (recommended next, as local-only data is fragile). |
| OQ-11 | Project name/branding? | "Markdown Notes" placeholder. |

## 7. Out-of-scope risks to note
Local-only storage means data is lost if the user clears site data; mitigate with a visible one-line notice and export as the first follow-up.
