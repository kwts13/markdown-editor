# Markdown Notes

Local-first, Obsidian-style markdown notes in the browser. Static site, vanilla ES modules, no build step, no backend.

## Run

ES modules need http(s), so serve the folder (opening index.html via file:// will not work):

    python3 -m http.server 8000
    # then open http://localhost:8000

## Layout

- `index.html`, `css/styles.css`
- `js/storage.js` swappable localStorage module (schema version, corrupt-data backup)
- `js/store.js` state (ID-based flat maps), mutations, debounced autosave
- `js/sidebar.js` tree, rename, drag/drop, context menu, move picker
- `js/editor.js` CodeMirror 6 editor, edit/read modes, shortcuts
- `js/toolbar.js` floating formatting toolbar shown above selected text; `js/format.js` the formatting commands (also used by Ctrl/Cmd+B / I)
- `js/properties.js` Properties panel: typed-field editor (text, list, number, checkbox, date) over a `---` YAML front-matter block
- `js/search.js` search logic (names, text, properties; `key:value` and "phrases") and `js/searchpanel.js`, the Ctrl/Cmd+Space overlay
- `js/slash.js` the `/` command menu (`/code /table /callout /details /toc /image /video /todo-list /link`), `js/suggest.js` its popup (also used for `[[` completion), `js/wikilinks.js` `[[wikilink]]` helpers
- `js/live.js` live-render extension: styles markdown in place, hides markers except at the caret
- `js/ui.js` toast, dialogs, menu; `js/app.js` wiring
- `vendor/` a CodeMirror 6 bundle (`codemirror.js`, built once with esbuild from `@codemirror/{state,view,commands,language,lang-markdown}`; local, works offline)

Notes always render live as you type. **Edit** mode allows changes; **Read** mode is read-only. Ctrl/Cmd+E toggles between them.

## Shortcuts

Sidebar sorting: the arrows button sorts notes and folders together by name, modified or created date (a folder's modified date is its newest note), or Manual order; "Folders first" groups folders on top in the non-manual sorts. In Manual order folders and notes share one list, so a folder can sit between notes. Drag a note or folder near the edge of a sibling to place it there (this switches to Manual); drop on the middle of a folder to move into it. Alt+Up/Down reorders the focused item.

Search (Ctrl/Cmd+Space, or Ctrl/Cmd+K): opens a search overlay; plain words match note names, text and properties; `author:Sam` or `tags:todo` match a property's value, `tags:` any note that has the property, and quotes keep a phrase together. Arrow keys pick a result, Enter opens it and jumps to the match.

Slash commands: type `/` at the start of a line (or after a space) to insert a code block, table (`/table 4x3`), callout (`/callout warning`), collapsible section, table of contents (static), image or video (a URL: YouTube, Vimeo or a video file), to-do list or web link. Wikilinks: type `[[` to pick a note; `[[Note]]`, `[[Note|alias]]`, `[[Folder/Note]]`, `[[Note#Heading]]` and `[[#Heading]]` all work. Click a link to follow it (a link to a missing note creates it); to edit one, move the caret into it with the arrow keys. Renaming a note updates links to it.

Ctrl/Cmd+Alt+N new note, Ctrl/Cmd+E edit/read, Ctrl/Cmd+B / I bold / italic, Ctrl/Cmd+\ toggle sidebar, F2 rename, Delete delete, Shift+F10 / context-menu key for menu, Esc then Tab leaves the editor.

Data is stored only in this browser (localStorage). Clearing site data deletes it.
