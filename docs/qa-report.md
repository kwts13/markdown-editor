# QA Report - Markdown Notes MVP

Date: 2026-10-05. Tester: QA Specialist. Build: static app served with `python3 -m http.server`, tested in the Browser pane (Chromium-based) using real clicks, drags and keystrokes. Some setup (large content, nested-folder data, simulating storage failure/corruption) used JS in the page. Not tested: Firefox, Safari, Edge.

## Summary

- 38 Pass, 0 Fail, 1 Not tested (AC-15 "No notes yet" state, effectively unreachable) after fixes.
- Before fixes, 4 criteria were failing or partly failing: AC-37 (banner), AC-39 (contrast), AC-6 (raw `<form>`/`<input>` allowed through sanitiser), AC-7 (Tab on list items). Details below.
- 6 fixes applied (F1-F6). 6 low-priority issues outstanding.

## Acceptance criteria

| AC | Result | Notes |
|----|--------|-------|
| AC-1 | Pass | Fresh storage: "Untitled" created, selected, textarea focused (typed immediately). |
| AC-2 | Pass | Reloaded 3x without typing: no empty-note accumulation; edited notes kept. |
| AC-3 | Pass | New note button and Ctrl+Alt+N both create and focus editor. |
| AC-4 | Pass | Plain textarea, monospace, soft wrap, no toolbar. |
| AC-5 | Pass | Edit/Split/Preview and Ctrl+E. Rendered headings, bold/italic/strike, inline + fenced code, blockquote, ol/ul, task lists, links, hr, table. |
| AC-6 | Pass (after F3) | `<script>`, `onerror`, `onclick`, `<iframe>`, `<svg onload>`, `javascript:` hrefs all neutralised, no alert fired. Raw `<form>`/`<input>`/`<button>` survived before F3. |
| AC-7 | Pass (after F2) | Tab / Shift+Tab / Esc-then-Tab work. Tab on a list line inserted spaces after the marker (`-   c`) instead of nesting; fixed. |
| AC-8 | Pass | Real Enter key: list continues, numbered list increments, empty marker ends list. Ctrl+B/I wrap selection. Toggle-off and undo granularity after B then I not fully verified. |
| AC-9 | Pass | Typed and reloaded immediately (navigate right after typing): text persisted (flush on unload). Status shows Saving.../Saved. |
| AC-10 | Pass | 10,000-line / 727 KB note: only one keystroke event >16 ms (40 ms, first key); save of that blob takes about 5 ms. See O1 for Preview/Split rendering. |
| AC-11 | Pass | Folders first, then notes, alphabetical (observed: "Renamed" sorted above "Untitled"). Case-insensitivity from code. |
| AC-12 | Pass | |
| AC-13 | Pass | Sidebar updates immediately on rename (sidebar or title field). |
| AC-14 | Pass | Collapse/expand button, drag-resize (persisted across reload), keyboard resizer in code. Ctrl+\ not confirmed (see O4). Collapse bug fixed (F1). |
| AC-15 | Not tested | "Empty" under empty folder: Pass. "No notes yet" is unreachable in normal use because a note is always created on load and after the last delete. |
| AC-16 | Pass | Untitled, Untitled 1, 2, 3... |
| AC-17 | Pass | Double-click, F2, context menu, Enter commits, Esc cancels. |
| AC-18 | Pass | Empty title field rejected, name reverted (toast). Whitespace trimmed. |
| AC-19 | Pass | "untitled" vs "Untitled" rejected inline, case-insensitive. Same name in different folders allowed. |
| AC-20 | Pass | `/` rejected inline. Trim OK. 100-char limit from code only (`validateName`). |
| AC-21 | Pass | Delete key opens confirm, Cancel is default focus, Esc cancels with no change, Tab+Enter confirms. Deleting open note opened another note and focused editor. |
| AC-22 | Pass | New folder at root or inside selected folder, enters rename immediately. |
| AC-23 | Pass | Rename rules shared with notes. |
| AC-24 | Pass | "Empty folder X will be deleted." |
| AC-25 | Pass | Dialog: "will also permanently delete 1 note and 2 subfolders" (correct counts across 3 levels). Cancel default focus. Cancel changed nothing; confirm removed whole subtree and switched open note. |
| AC-26 | Pass | Expanded state restored after reload. |
| AC-27 | Pass | Real drag: note onto folder, note to empty sidebar area (root). Highlight classes in code. |
| AC-28 | Pass | Context menu (Shift+F10) then "Move to..." picker, fully keyboard operable. |
| AC-29 | Pass | Collision auto-suffixed ("Renamed 1") with toast (OQ-4 default). |
| AC-30 | Pass | Folder dropped onto its own child blocked. Valid folder move via drag/picker not exercised (shares code path with notes). |
| AC-31 | Pass | 10 levels rendered and indented correctly, deep note reachable. |
| AC-32 | Pass | Subtree delete verified. Subtree move by code review. |
| AC-33 | Pass | Notes, folders, names, content, sidebar width, view mode restored. Opens to fresh note per OQ-1. |
| AC-34 | Pass | Only local resources requested. Caveat: remote `![](https://...)` images in preview fetch from the network (O3). |
| AC-35 | Pass | Simulated QuotaExceededError on setItem: "Not saved" plus persistent banner, text kept in editor; after storage recovered the next edit saved everything and cleared the banner. Storage unavailable at load verified by code only. |
| AC-36 | Pass | `version: 1` in stored blob. |
| AC-37 | Pass (after F4) | Corrupt JSON: app starts empty and raw blob kept under `mdnotes:backup:<ts>`, but the user notice was cleared immediately by the first "Saved" status. Fixed. |
| AC-38 | Pass | Roving tabindex, Up/Down, F2, Delete, Shift+F10 verified. Left/Right expand/collapse by code. ARIA roles present in DOM. |
| AC-39 | Pass (after F6) | Contrast computed for all token pairs: all AA except light-mode blockquote text (3.2:1). Fixed to 5.4:1. Dark theme viewed; light theme not visually reviewed. |

## Extra scenarios requested

| Scenario | Result |
|----------|--------|
| Delete key + confirm | Pass (note and folder). |
| Non-empty folder delete with counts | Pass. |
| Nested folders (10 levels) | Pass. |
| Storage-failure banner | Pass (QuotaExceeded simulated, recovery verified). |
| Corrupt-data recovery | Pass after F4. |
| Rapid typing then immediate reload | Pass (flush on unload/blur). |
| Duplicate names (rename, move) | Pass. |
| XSS in preview | Pass after F3 for forms; script/event handlers/javascript: URLs safe throughout. |
| Large note performance | Pass in Edit (see O1 for Preview). |
| Narrow viewport (375 px) | Fail before F1/F5: sidebar ate 280 px leaving a ~95 px editor and clipped toolbar. Fixed. |

## Bugs fixed (all in code, re-tested)

- F1 (P2) `css/styles.css`: `#main` had no explicit grid column. When the sidebar and resizer were `display:none` (collapsed, or narrow view) the main pane auto-placed into the 0-width first column and the editor squashed to nothing. Added `grid-column: 3`.
- F2 (P3) `js/editor.js`: Tab on a list item now nests the whole line (`  - c`) instead of inserting spaces after the marker. Shift+Tab then outdents correctly.
- F3 (P2) `js/editor.js`: sanitiser now forbids `form`, `style`, `button`, `select`, `textarea` and removes non-checkbox `<input>`. Raw HTML could previously render a working form/inputs (phishing / data-submission surface) in preview. Task-list checkboxes unaffected.
- F4 (P2) `js/app.js`: corrupt-data notice was hidden immediately by the "Saved" status handler. Notice is now retained and re-shown whenever there is no save error (AC-37).
- F5 (P3) `css/styles.css`, `js/app.js`: at <=640 px the sidebar is an overlay (85vw max), topbar wraps, split stacks vertically, sidebar auto-collapses on load and after selecting a note. Mobile UI is an MVP non-goal; this makes the app usable, not polished.
- F6 (P3) `css/styles.css`: light-mode `--quote` colour `#8a8fa0` (3.2:1) to `#646a7a` (5.4:1).

## Outstanding issues (not fixed)

| ID | Priority | Issue | Repro / notes |
|----|----------|-------|---------------|
| O1 | P3 | Preview/Split re-render is synchronous and slow on huge notes: ~510 ms for 10,000 lines, so Split mode stutters while typing in very large notes (re-render runs 150 ms after each pause). | Make a 10k-line note, switch to Split, type. Consider rendering on idle or capping/diffing. |
| O2 | P3 | No automatic retry after a failed save. Data stays dirty and is retried on next edit/blur/visibility change, but if the user stops typing the banner persists until then. | Simulate quota error, restore, wait: stays "Not saved" until another edit. |
| O3 | P3 | Remote images in markdown (`![](https://...)`) load from the network when previewed (tracking pixel / IP leak) although note content is not sent. Consider blocking remote images or noting it. | Type `![x](http://example.com/a.png)`, open Preview, observe request. |
| O4 | P4 | Ctrl/Cmd+\ sidebar shortcut could not be confirmed with the automation key mapping (button works). Verify manually. | |
| O5 | P4 | After F5, collapsing the sidebar on a narrow window persists `sidebarCollapsed` for desktop use too (one click to reopen). | Load at <640 px, then widen. |
| O6 | P4 | Corrupt-data notice is not dismissible and disappears only on next load. Title-bar rename errors appear as a toast, not inline (AC-18 allows sidebar inline; title field uses toast). Open note inside a collapsed folder has no visible highlight. | |
| O7 | P4 | "Storage unavailable at load" (localStorage throwing on read) was not exercised live, only by code review. Cross-browser (Firefox/Safari) untested. | |
