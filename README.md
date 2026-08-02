# ScoreCode 0.3.0

**Real kod editor** — Tauri (Rust backend) + CodeMirror 6 (editor engine).

## Arxitektura

```
┌─────────────────────────────────────────────────────┐
│                   ScoreCode 0.3.0                    │
│                                                      │
│  Rust (src-tauri/src/main.rs)   JS (src/main.js)    │
│  ════════════════════════════   ═══════════════════  │
│  ✅ read_directory              ✅ CodeMirror 6      │
│  ✅ read_file (UTF-8)           ✅ Syntax highlight  │
│  ✅ write_file                  ✅ Bracket matching  │
│  ✅ create_file                 ✅ Autocomplete      │
│  ✅ create_directory            ✅ Fold/unfold       │
│  ✅ delete_path (file+dir)      ✅ Search/replace    │
│  ✅ rename_path                 ✅ UI / Tabs         │
│  ✅ search_in_files (fast)      ✅ Modals            │
│  ✅ start_watching (notify)     ✅ Context menus     │
│  ✅ stop_watching               ✅ Theme switcher    │
│  ✅ load_settings (JSON)        ✅ Settings panel    │
│  ✅ save_settings               ✅ File watcher UI   │
│  ✅ get_settings_path           ✅ Search results    │
└─────────────────────────────────────────────────────┘
```

## Supported languages (syntax highlighting)

Rust, JavaScript, TypeScript, JSX/TSX, Python, Java, Kotlin,
CSS/SCSS, HTML, Vue, Svelte, JSON, Markdown, SQL, C, C++, Go

## Settings file location

- **Windows:** `%APPDATA%\scorecode\settings.json`
- **macOS:** `~/Library/Application Support/scorecode/settings.json`
- **Linux:** `~/.config/scorecode/settings.json`

## Build

```bash
npm install
npm run tauri build
```

## Dev

```bash
npm run tauri dev
```

## New Cargo dependencies

- `notify = "6.1"` — file system watcher (papka o'zgarishlarini kuzatadi)
- `walkdir = "2.4"` — rekursiv papka qidirish
- `dirs = "5.0"` — OS-specific config/home directory topish
