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
- `js/live.js` live-render extension: styles markdown in place, hides markers except at the caret
- `js/ui.js` toast, dialogs, menu; `js/app.js` wiring
- `vendor/` a CodeMirror 6 bundle (`codemirror.js`, built once with esbuild from `@codemirror/{state,view,commands,language,lang-markdown}`; local, works offline)

Notes always render live as you type. **Edit** mode allows changes; **Read** mode is read-only. Ctrl/Cmd+E toggles between them.

## Shortcuts

Ctrl/Cmd+Alt+N new note, Ctrl/Cmd+E edit/read, Ctrl/Cmd+B / I bold / italic, Ctrl/Cmd+\ toggle sidebar, F2 rename, Delete delete, Shift+F10 / context-menu key for menu, Esc then Tab leaves the editor.

Data is stored only in this browser (localStorage). Clearing site data deletes it.
