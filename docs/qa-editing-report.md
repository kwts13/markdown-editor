# QA report: why some rendered components are hard to edit

Branch: `feature/slash-commands-wikilinks`. Investigation only; no app source files were changed.
Tested in the Browser pane against a throw-away copy of the app on `http://localhost:8765` (own localStorage; `:8000` untouched). Real key presses and mouse clicks were used; CodeMirror state was only *read* (selection, doc text, height map) to prove what happened. macOS, so undo is Cmd+Z (Ctrl+Z does nothing, as expected).

To check the fixes proposed below, I also ran a patched COPY of the app (in the session scratchpad, served on `:8766`; the project files are unchanged). The patch was two things: (a) only replace/widget decorations are atomic, (b) the margins in finding 1 set to 0. With it, arrow keys step one character, Backspace deletes one character, and Down moves line by line.

## Summary: the answer to "it's hard to edit some of these components"

Two systemic bugs cause most of the pain. Each is a few lines and affects many components at once.

1. **Clicks and Up/Down land on the wrong line** (CSS margins on CodeMirror widgets and decorated lines break its height map). Everything below the Properties panel is mis-targeted, getting worse further down the note.
2. **Every styled range is "atomic"** (`live.js` hands all decorations, including plain styling marks, to `EditorView.atomicRanges`). The caret can never move *into* bold, italic, strike, inline code, links, wikilinks, or the `<summary>` line. Backspace right after one deletes the whole thing, and clicking inside snaps to an edge.

On top of those: media widgets swallow clicks, wikilinks navigate on mousedown, the Properties panel can be broken with one Backspace, and callouts, tables and `<details>` lack the small keyboard affordances an Obsidian-style editor needs.

---

## Findings

Severity: Blocker = cannot do the task / data-structure loss in normal use; High = common task is painful or surprising; Medium = workaround exists; Low = polish.

### 1. Clicks, drag-selection and Up/Down arrows hit the wrong line (Blocker)

- **Component:** whole note body (worst under Properties, callouts, `<details>`, fences, videos).
- **Repro:** open a note with Properties and a few blocks. Click on the text of `Some text with a ... here.` (the line right under the heading). The caret ends on the blank line *below* it. Click on `Heading one`: caret lands on the blank line under the heading. Click far down the page: the caret can land 1-2 lines off, and the editor sometimes scrolls. With the caret on the heading line press Down: it goes to `Some text...`, skipping the blank line. Down again skips the blank line and the callout body, and so on. Sequence observed with Down from line 7: 8, 10, 12, 14, 17, 19 (callout body line 13, the `<summary>` line 16 and `Hidden body text` line 18 are never visited with Down).
- **Expected:** the caret lands where you click / on the next line.
- **Why (measured):** `view.lineBlockAt(pos).top` (what click and vertical motion use) differs from the real DOM position by exactly 29 px under the Properties panel and keeps growing (about 57 px, two lines, near the bottom of my test note). 29 px = `.props { margin: 0 0 29px }`; CodeMirror's height map ignores margins on block widgets and on `.cm-line` elements. More margin sources add on top: `.cm-callout-top/bottom` (4px), `.cm-details-top/bottom` (4px), `.cm-fence-top/bottom` (4px), `.cm-video { margin: 6px 0 }`, `.cm-prop-bottom { margin-bottom: 29px }` (raw front-matter fallback).
- **Proof:** injecting `.props{margin:0} .cm-callout-top,... {margin:0}` leaves a remaining offset of 0-4 px (just line-box vs glyph), and then Down steps line by line and clicks land correctly.
- **Fix (CSS only, quick win):** no vertical margins on widgets or `.cm-line`s. Use `padding` (counted in height) or `border` / `box-shadow` / a wrapper element with padding inside the widget (`.props`: put the 29px as `padding-bottom` of a wrapper inside the widget DOM, or `border-bottom: 29px solid transparent`). For callout/details/fence "gap above/below" use `padding-top/bottom` on the first/last line or `border-top: 4px solid transparent`. For `.cm-video`, wrap with padding. After the change call `view.requestMeasure()` once to confirm `lineBlockAt` vs `coordsAtPos` agree (my check script: compare `coordsAtPos(line.from).top` with `lineBlockAt(line.from).top + view.documentTop`; should be within a few px).
- **Files:** `css/styles.css` lines ~197 (`.props`), 129, 262-265, 271-274, 279.

### 2. Caret cannot enter bold / italic / strike / code / links / wikilinks / summary; Backspace eats the whole span (Blocker)

- **Components:** `**bold**`, `*em*`, `~~s~~`, `` `code` ``, `[text](url)`, `[[wikilink]]`, `[[Note|alias]]`, `<summary>` text, callout title (while the line is not active), and any other mark.
- **Repro (bold):** line `x **bold text** y`. Put the caret at col 2 (start of the bold) and press Right: it jumps to col 15 (the end of the span); the raw `**bold text**` is on screen the whole time. Press Backspace at col 15: all 13 characters `**bold text**` are deleted in one keystroke. Clicking in the middle of the bold word puts the caret at col 2; clicking again in the middle of the raw text puts it at col 15. Double-click selects a word inside (so editing is possible by selecting first), but Left/Right from there still jumps to an edge.
- **Repro (wikilink):** `Some text with a [[Target Note]] link`. Caret at col 17 (just before `[[`), Right -> col 32 (past `]]`). Caret at col 32, Backspace -> the whole `[[Target Note]]` is deleted. So the README promise "move the caret into it with the arrow keys" does not work.
- **Repro (details summary):** `<summary>My summary</summary>`. Caret col 0, Right -> col 29. Caret at end, Backspace -> the entire summary line contents including the tags are deleted and the section loses its title. Clicking in the middle of "My summary" puts the caret at col 29 (after `</summary>`); typing there breaks the tag. There is effectively no way to edit the summary text, other than selecting it with the mouse (double-click selects a word) and typing over it.
- **Why:** `js/live.js` last lines of the plugin: `EditorView.atomicRanges.of(v => v.plugin(p)?.decorations || Decoration.none)` hands the *entire* decoration set to atomicRanges, so every `Decoration.mark` (`cm-strong`, `cm-em`, `cm-strike`, `cm-icode`, `cm-link`, `cm-wikilink`, `cm-callout-title`, `cm-details-summary`, `cm-prop-key`) is treated as one indivisible unit by cursor motion, Backspace/Delete, and mouse placement. Only the hidden-marker replace decorations (and widgets) should be atomic.
- **Fix (quick win):** in `provide:` build a second RangeSet that contains only `Decoration.replace` ranges (those with a widget or `hide`), e.g. collect them into a separate array `atomic` in `build()` and return `Decoration.set(atomic, true)`, or filter `decorations` by `value.spec.widget || value === hide`. Same for the `foldField` provide (that one is already replace-only, fine). Verified in the patched copy: Right steps 2,3,4,5; Backspace after `**bold text**` deleted one `*`.
- **Side effect to keep in mind after the fix:** hidden markers are still atomic (good) and reveal when the caret touches the span, so editing flows like Obsidian.

### 3. Wikilinks cannot be edited with the mouse; a click navigates (and can create a note) (High)

- **Repro:** click on `Target Note` or `alias text` in rendered text. The app opens the target note immediately (on mousedown). For an unresolved link it creates a new empty note and opens it. A drag that starts on the link cannot select text. There is no way back except the sidebar (no back button/shortcut).
- **Expected:** in Edit mode, click places the caret (revealing `[[ ]]`); following a link is Ctrl/Cmd+click (as already done for normal links in the same file) or a click in Read mode.
- **Why:** `js/live.js` `openWikilinks` handles `mousedown`, `preventDefault`s it and dispatches the `wikilink` event; `js/app.js` `document.addEventListener('wikilink', ...)` calls `store.createNoteNamed` when no match. Combined with finding 2, there is no pointer or keyboard route into the link text, so the only edit path is "arrow next to link, then click inside the revealed raw text" and that click then snaps (finding 2).
- **Fix:** (a) in Edit mode require Ctrl/Cmd (or Alt) + click; plain click places the caret; Read mode keeps plain click. (b) Add a keyboard "follow link" command (e.g. Ctrl/Cmd+Enter with the caret in/next to a link). (c) Do not auto-create on a single plain click; confirm or toast "Note not found, Ctrl+click again to create". (d) Move the handler to `click`/`mouseup` and ignore it if the mouse moved (so drag-select works). Also add `title="Ctrl+click to open"`.

### 4. Media widgets: video swallows the click and keyboard; image is click-dead; broken image is invisible (High)

- **Components:** `![](youtube/vimeo/mp4)`, `![](image)`.
- **Repro (video):** click in the middle of the rendered YouTube player. Nothing happens to the editor: the caret stays where it was and keyboard focus moves into the iframe (`document.activeElement` is the IFRAME). In my first attempt the click also started playing the video. Further typing goes to the player (Space, K, F, arrows act on the video), not the note. Backspace/Delete do nothing. The only mouse way to reveal the `![](url)` line is clicking in the empty strip to the right of the widget, and that only exists when the editor is wider than the widget's 720px max width; on a narrow window the player fills the line and there is no mouse way in at all (only arrow keys from the neighbouring line).
- **Repro (image):** with a loadable image (I used a base64 SVG) click on the picture. Caret does not move (stayed on the previous line), focus stays. Clicking on blank space to the right of the picture on the same line reveals the raw markdown (works, but not discoverable).
- **Repro (broken image):** `![](https://example.com/x.png)` (unreachable) renders as a 0x0 image: just an empty gap with no icon, no alt text, no way to see or click it. The user sees a blank space in the note and no clue that an image link exists.
- **Layout jump:** when the caret reaches an image/video line (arrow keys or click beside), the widget is replaced by the raw line, so a ~270px player collapses to one line and the page below jumps. Leaving restarts the iframe.
- **Why:** `VideoWidget` / `ImageWidget` in `live.js` use the default `ignoreEvent()` (VideoWidget explicitly returns true) so CodeMirror ignores mouse events inside; a cross-origin iframe also takes pointer events itself. There is no error handler on `<img>`.
- **Fix:** (a) put a transparent shield over the iframe (`pointer-events:none` on the iframe, or an overlay div) that handles `mousedown` by dispatching `selection: {anchor: widgetFrom}` (reveals the raw line), with a small "Play" or double-click to interact; (b) for `ImageWidget`: `ignoreEvent(e) { return false; }` and set selection on `mousedown`/`click`; (c) `img.onerror` -> replace with a visible placeholder showing the alt/URL (and `title`), so the block is visible and clickable; (d) optionally an "Edit" pencil on hover that reveals the source, and keep the widget visible (shown under the raw line, like Obsidian) while the caret is on it, so the page does not jump.

### 5. Properties panel: one Backspace destroys it (High)

- **Repro:** note with Properties and text on the first body line. Put the caret at the very start of that first body line and press Backspace. The text merges into the closing fence (`---Hello`), `frontmatter()` no longer matches, and the whole panel is replaced by raw lines (`date:`, `tags:`, bullets) and a stray horizontal rule. Cmd+Z restores it.
- **Why:** `propertiesExtension` `transactionFilter` in `js/properties.js` only moves the caret/adds a trailing line; nothing stops a change that touches the newline after the closing `---`.
- **Fix:** add `EditorState.changeFilter` (or extend the transaction filter) to reject/transform edits that delete or overwrite `[fm.to - 3, fm.to + 1)`, or bind Backspace/Delete at `head === fm.to + 1` to a no-op/focus-the-panel command. Quick win.

### 6. Properties panel: smaller keyboard/mouse problems (Medium)

- **Click on the panel's empty area then type:** clicking the header strip / padding keeps editor focus but typing goes nowhere (I typed `zzz`; document unchanged). Silent. Fix: `mousedown` on non-control area -> `preventDefault()` and focus the first input (or `view.focus()` + place the caret after the panel).
- **Keyboard path in and out is hidden:** Up arrow from the first body line does nothing (does not enter the panel or the title). Shift+Tab from the body goes to the title; Tab from the title goes to the editor; only Esc then Tab reaches the panel, and the first stop is the destructive **Remove** (all properties; no confirmation, though undo works). Fix: ArrowUp (and Backspace on an empty first line) from the first body line focuses the last panel field; make Remove not the first tab stop (put it last / `tabindex=-1` with a context menu) and add a confirm or toast with Undo.
- **Enter in the last value field** returns to the editor; there is no "Enter adds a new row". Adding several properties requires clicking `+ Add property` each time.
- **No reordering** of properties; list chips cannot be edited in place (delete and re-add only); Backspace on an empty chip box removes the last chip (easy to lose one).
- **Rows with an empty name** are shown but not written, and vanish on the next rebuild (undo/redo, note reload).
- **Date typing:** the native date input; typing "01" into the focused month segment via synthetic input did not change the value in my environment (not conclusive, native control). Enter/Escape return to the editor (works).
- **Undo/redo:** works and the panel follows (typing `status` then `open` undo in two steps: value, then row). Good.

### 7. Callout / quote: leaving takes three Enters and leaves stray `>` lines (Medium)

- **Repro:** caret at end of `> callout body line`. Enter -> `> `. Enter again -> the blank line becomes `>` and another `> ` is created (you are still inside). A third Enter finally exits. Result: two blank lines (`>`) left inside the callout. Same for a plain `> quote`. Backspace on an empty `> ` removes the marker in one press (fine).
- **Why:** default `markdownKeymap` Enter (`insertNewlineContinueMarkup`) behaviour for empty quote lines, not overridden in `js/editor.js`.
- **Fix:** add a high-priority Enter handler: on a line that is only `>` marks (and optional space) remove the marker and exit the quote (one Enter). Quick win.
- Changing the callout type or editing its title works only after the caret is on the first line (raw `> [!warning] Title` appears); with finding 2 fixed this is fine. The type label widget is atomic, so a click on it first reveals the source (two clicks to edit).

### 8. Tables: raw text with no editing help (Medium)

- **Repro:** caret in a table cell, press Tab: two spaces are inserted at the start of the row (`  | A | B |`), nothing moves to the next cell, and enough Tabs make the row an indented code block (table breaks). Enter in the middle of a row splits the row (`  | A` / `  | B |`) and breaks the table. Enter at the end of the last row gives an empty line (no new `| |` row). No add row/column control exists except re-running `/table`. Columns do not align.
- **Why:** `Tab` in `js/editor.js` is `indentMore`; no Table-aware keymap; `live.js` only adds `cm-table` line styling.
- **Fix:** table-aware Tab/Shift+Tab (move between cells, append a row at the last cell), Enter in a table row appends an empty row, optional "format table" (pad columns) command; longer term render tables as a proper widget with add row/column buttons.

### 9. `<details>` sections (Medium)

- **Summary editing:** see finding 2 (atomic summary). After fix 2 the caret can enter the summary.
- **Closing line unreachable with Down:** from the blank line above `</details>` Down jumps over it (the closing and opening lines are collapsed to 2px/font-size 2px via `cm-details-collapsed`); Up from below does reach it. Fix: do not shrink with `font-size:2px`; use `display:none`-like replace decoration for the tag text only (keep line height normal) or make the whole `<details>`/`</details>` lines a replace widget.
- **Fold chevron** is a `span role=button` with no `tabindex` and no shortcut, so folding is mouse-only. Fix: `tabindex=0` plus Enter/Space handler and a command (e.g. Ctrl+Alt+[ / ]) on the summary line.
- **Fold state is not persisted**: it lives in a StateField (`foldField`) and is recreated by `view.setState(newState(...))` on every note switch (from code reading), so every folded section reopens when you come back. Fix: store folds per note in `store.ui` or in the doc (`<details>` without `open`, as Obsidian does).
- Folded content is replaced by an atomic block, so it is untouched by arrow motion (the caret skips from the summary to after `</details>`); to delete a folded section you must select it from outside (works). Typing in the summary while folded works.
- Fold toggle by mouse works and does not move the caret (good).

### 10. Read mode still lets you change the note (Medium)

- **Repro:** switch to Read, click a task checkbox: the underlying markdown changes (`- [ ] task one` -> `- [x] task one`), while Properties checkboxes are disabled in Read mode.
- **Why:** `CheckWidget` in `live.js` calls `view.dispatch(...)` directly; `EditorState.readOnly` does not block programmatic dispatches.
- **Fix:** check `view.state.facet(EditorView.editable)`/`readOnly` in the click handler (or deliberately allow it and document it; make Properties consistent).

### 11. Narrow viewport (Medium)

- At 375px wide the sidebar covers about 85% of the screen on first load (needs manual collapse), and with it collapsed the content is wider than the viewport: `.cm-content` is 368px inside a 331px scroller, the Properties panel runs to x=395 (Remove, delete x and chips clipped), and callouts/details extend past the edge, so the page scrolls horizontally. Likely the grid/`min-width` of the properties row (`grid-template-columns: 28px minmax(70px,110px) 1fr 24px`, input min widths) plus fixed paddings. Fix: `min-width:0` on grid children and `.props`, `overflow:hidden`; auto-collapse the sidebar under ~640px. Task checkboxes (13px) and the fold chevron (about 19x14px) are small touch targets.

### 12. Slash and `[[` popups (Low)

- Works: `/` mid-line, typing, Backspace through the popup (it closes at `/`), Escape dismisses (does not reopen for that `/`), Enter/Tab accept, Cmd+Z after a command goes back to the typed `/table 2x2`; `[[Tar` + Enter inserts `Target Note]]` with the caret after it.
- Minor: `/c` also shows `/toc` and `/todo-list` (substring match ranks as results); typing `[[` does not auto-insert `]]`, leaving an unclosed link until the user types it; both popups exist as separate `.suggest` elements (fine).

### 13. Other observations (Low)

- Hidden code-fence lines (`cm-fence-hidden`: 8px font, `line-height .6` -> about 5px) are almost unclickable; reaching the opening fence to change the language needs an arrow key from the first code line (Up). Works, but undiscoverable.
- Console: four `404` (favicon) errors and the warning "Allow attribute will take precedence over 'allowfullscreen'" from the video iframe (`f.allowFullscreen = true` plus `f.allow = ...fullscreen`). No JavaScript exceptions.
- Unreproduced: once, after an Escape, Ctrl+Z (a no-op on macOS) and Cmd+Z in a row, focus ended up on the sidebar "Resize sidebar" handle. I could not reproduce it again.
- Typing `#Heading` after deleting only the space (heading marker visible while the caret is on the line) behaves like any markdown editor; two Backspaces turn a heading back into text.

---

## What works well

- Headings, lists, numbered lists, tasks: Enter continues the marker, Enter on an empty item exits in one press, Backspace at the start of a task merges as expected.
- Marker reveal when the caret is on/next to an element (heading `#`, list/quote markers, `[[ ]]`, fences, callout header, `<details>` tags).
- Checkbox click toggles without moving the caret; Cmd+Z reverts it.
- Floating toolbar: appears on selection, Bold wraps correctly, Cmd+Z undoes it in one step and keeps the selection.
- Slash commands (`/table 2x2`, `/callout`, etc.) and the `[[` completion work from the keyboard; selection is placed on the first placeholder (e.g. `Column 1`).
- Properties panel: typing keeps focus while the document updates; undo/redo stay in sync with the panel; the caret is kept out of the panel; Cmd+A + Delete empties the note cleanly (undoable); Enter/Escape in fields return to the editor.
- Details fold toggle by mouse; fold chevron mousedown does not steal the selection.
- Read mode shows rendered elements without revealing raw source.

---

## Prioritized fix plan

| # | Fix | Resolves | Effort |
|---|-----|----------|--------|
| 1 | **Make only replace decorations atomic** (`live.js` `provide: atomicRanges`). | Finding 2 (bold/italic/code/links/wikilink/summary caret + Backspace; callout title) and unblocks 3 and 9 | Quick win (about 10 lines). Do first |
| 2 | **Remove vertical margins from widgets and decorated lines** (`styles.css`: `.props`, callout, details, fence, video, `.cm-prop-bottom`); use padding/border. | Finding 1: wrong click/drag/arrow targets everywhere below Properties | Quick win (CSS) |
| 3 | **Wikilink click policy**: Ctrl/Cmd+click (Edit) or plain click (Read), on click not mousedown, no auto-create without confirmation, keyboard "follow link". | Finding 3 | Quick win |
| 4 | **Protect Properties**: change filter for the closing fence/newline, click-in-panel focus handling, ArrowUp-into-panel, safer Tab order (Remove last), Enter adds a row. | Findings 5 and 6 | Quick win for the filter; small for the rest |
| 5 | **Media widget interaction**: iframe shield + mousedown selects the source, image click, broken-image placeholder, optional edit affordance and keeping the widget visible while the caret is on it. | Finding 4 | Medium |
| 6 | **Block exits and tables**: one-Enter exit from empty quote/callout lines; table Tab/Shift+Tab/Enter helpers (add row), later a table widget. | Findings 7 and 8 | Quick win (Enter); Medium (tables) |
| 7 | **`<details>` polish**: fix the unreachable closing line, keyboard-accessible chevron, persist folds per note. | Finding 9 | Medium |
| 8 | **Consistency/mobile**: Read mode must not mutate (checkbox), responsive layout (`min-width:0`, auto-collapse sidebar), larger touch targets, favicon and iframe attribute warnings. | Findings 10, 11, 13 | Small |

After items 1 and 2 land, re-run this report's repro steps: those two alone should remove most of the "hard to edit" reports. Then re-test the remaining components (items 3-7) because several of them were masked by those two bugs.

## Test notes

- Test note used: front matter (date, tags), heading, text with two wikilinks, warning callout, `<details>` with summary, broken image, YouTube video, js code fence, 2x2 table, three tasks, bullet, numbered list, quote, inline bold/code/strike/link/italic line.
- Patched copy used for verification lives in the session scratchpad (`.../scratchpad/patched`), not in the project.
- Not fully covered: drag-selection across widgets (blocked by finding 1 on the unpatched build), copy/paste of rendered blocks (CodeMirror copies the underlying markdown text, not exercised in detail), folding + keyboard on the patched build (my last scripted check was blocked by the tool's permission classifier, so I did not retry it).

---

## Fix status

All checks below were re-run in the Browser pane on a throw-away server (`:8765`, own localStorage) with real clicks and key presses; the console showed no JavaScript errors (see the end).

| # | Finding | Status | Result of the repro after the fix |
|---|---------|--------|-----------------------------------|
| 1 | Margins break the height map | Fixed | No vertical margins remain on `.props`, callout, details, fence, video, hr or the raw front-matter fallback (padding / a wrapper / a background-line instead). `lineBlockAt` vs the real DOM top is 0 px for every line of a note mixing all components, at the top and at the bottom; clicks on text, a task and the last line land on the right line; Down visited every line 18..43 in order, Up likewise. |
| 2 | Styling marks are atomic | Fixed | Only `hide` / replace / widget decorations are atomic. Right steps one character at a time through bold, italic, strike, code, link and the `<summary>` line; Backspace after `**bold text**` deleted one `*`; hidden markers still reveal when the caret touches the span. |
| 3 | Wikilinks | Fixed | Plain click still navigates (on mouseup, so a drag over a link selects text and does not navigate; verified). Alt/Option+click and a click on an already-raw link only place the caret (verified). Arrow keys enter the link and show `[[ ]]`. Creating a missing note shows the toast `Created note "X"`; in Read mode a missing note is not created (toast says so). Links have a `title` hint. README updated. Not done: a "follow link" keyboard command, back navigation (owner call, see below). |
| 4 | Media widgets | Fixed / Partly | Image click reveals the raw markdown; broken image shows a dashed placeholder with the alt text / URL and a tooltip; video has a pencil (and clickable padding) that puts the caret on the source. A click inside a cross-origin player still moves focus into the iframe (so playing works) - a page cannot hear Esc there; the pencil is shown on hover, on focus and always on touch, and clicking anywhere else returns focus. Esc works for `<video>` files. Skipped: keeping the player visible under the raw line (the page still jumps when the source is revealed) - needs a second widget per line, little value. The iframe `allow`/`allowfullscreen` warning is gone. |
| 5 | Backspace destroys the panel | Fixed | A change filter rejects edits that touch the closing `---`/newline; Backspace on the first body line is a no-op (on an empty one it steps into the panel). Verified Backspace and Alt+Backspace: panel intact. |
| 6 | Properties smaller issues | Partly | Fixed: click on the empty area focuses the first field (typing works, verified), click in the gap below puts the caret in the body; Up from the first body line focuses the first field, Ctrl/Cmd+Alt+P too; Esc returns to the editor; first Tab stop is the name field, Remove is last (Tab out of the last control returns to the note, Shift+Tab from the first goes to the title); Remove now toasts "Ctrl/Cmd+Z brings them back"; Ctrl/Cmd+Enter in a value adds a row. Skipped: Enter-adds-row (Enter keeps returning to the note, as the report listed that as working), reordering, in-place chip editing, empty-name rows surviving a rebuild, native date input quirks - each is a feature rather than an editing bug. |
| 7 | Callout / quote exit | Fixed | Enter on an empty `>` line removes the marker and exits (two Enters from the end of a body line: new line, then exit; no stray `>` lines left). |
| 8 | Tables | Partly | Tab / Shift+Tab move between cells (skipping the `---` row), Tab in the last cell appends a row, Enter moves to the same cell in the next row and appends one at the end; Enter on an empty last row leaves the table. Verified. Skipped: column alignment / add-column controls / a real table widget (larger feature). |
| 9 | `<details>` | Fixed | Hidden `<details>`/`</details>` lines now keep a real height so Down reaches them (verified: Down visited every line). Chevron has `tabindex`, Enter/Space; Ctrl/Cmd+Alt+[ folds the section at the caret. Fold state is kept per note while switching notes (verified; in memory for the session, not saved to disk). Summary text is now editable with the arrow keys. |
| 10 | Read mode mutates | Fixed | Checkbox click in Read mode leaves the text unchanged; in Edit mode it toggles. Missing wikilink targets are not created in Read mode. |
| 11 | Narrow viewport | Fixed | At 375px: no horizontal overflow (document, scroller and Properties panel all within 375px; sidebar collapsed on load). Grid column made `minmax(0,1fr)`, date input tightened, larger task checkbox / chevron touch targets on coarse pointers or narrow screens. |
| 12 | Slash / `[[` popups | Partly | `[[` now auto-closes to `[[]]` (typing `]]` steps over, Backspace inside empty `[[]]` removes both; verified). `/c` still lists `/toc` and `/todo-list` because their aliases (`contents`, `checklist`) start with `c`; the substring-only matches are now hidden when a prefix match exists. |
| 13 | Other | Partly | Hidden fence lines are taller (about 18px) so they can be clicked and reached with Down. The iframe attribute warning is fixed. The favicon 404 is `/favicon.ico` requested by the Browser pane / python server despite the inline icon link in `index.html`; not an app bug, left. The unreproduced focus-on-resizer issue and the `#Heading` behaviour: no change. |

Console after the fixes: no JavaScript exceptions (the only errors are the favicon 404s above and the deliberately unreachable image URL used for the broken-image check).
