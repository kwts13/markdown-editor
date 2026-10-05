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
- `js/editor.js` CodeMirror 6 editor, preview (marked + DOMPurify), shortcuts
- `js/live.js` live-render extension: styles markdown in place, hides markers except at the caret
- `js/ui.js` toast, dialogs, menu; `js/app.js` wiring
- `vendor/` marked 12.0.2, DOMPurify 3.1.6 and a CodeMirror 6 bundle (`codemirror.js`, built once with esbuild from `@codemirror/{state,view,commands,language,lang-markdown}`; local, works offline)

View modes: **Live** (default, rendered as you type), **Source** (raw markdown), **Split**, **Preview**. Ctrl/Cmd+E toggles preview.

## Shortcuts

Ctrl/Cmd+Alt+N new note, Ctrl/Cmd+E edit/preview, Ctrl/Cmd+B / I bold / italic, Ctrl/Cmd+\ toggle sidebar, F2 rename, Delete delete, Shift+F10 / context-menu key for menu, Esc then Tab leaves the editor.

Data is stored only in this browser (localStorage). Clearing site data deletes it.
