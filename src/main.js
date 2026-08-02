// ===== ScoreCode 0.3.0 — main.js =====
// UI logic + CodeMirror 6 integration
// Barcha fayl operatsiyalari Rust backend orqali (invoke)
import { EditorState, Compartment }   from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter,
  highlightSpecialChars, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor, highlightActiveLine,
  scrollPastEnd
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { foldGutter, indentOnInput, syntaxHighlighting,
         defaultHighlightStyle, bracketMatching,
         foldKeymap, indentUnit } from "@codemirror/language";
import { closeBrackets, autocompletion,
         closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { javascript } from "@codemirror/lang-javascript";
import { python }     from "@codemirror/lang-python";
import { rust }       from "@codemirror/lang-rust";
import { java }       from "@codemirror/lang-java";
import { css }        from "@codemirror/lang-css";
import { html }       from "@codemirror/lang-html";
import { json }       from "@codemirror/lang-json";
import { markdown }   from "@codemirror/lang-markdown";
import { sql }        from "@codemirror/lang-sql";
import { cpp }        from "@codemirror/lang-cpp";
import { go }         from "@codemirror/lang-go";

// ─── Tauri invoke wrapper ────────────────────────────────────────────────────
const invoke = window.__TAURI__?.tauri?.invoke
  ?? (async (cmd, args) => {
    console.warn(`[mock] invoke("${cmd}", ${JSON.stringify(args)})`);
    if (cmd === 'load_settings') return {};
    if (cmd === 'read_directory') return [];
    if (cmd === 'read_file') return '// mock content\n';
    if (cmd === 'search_in_files') return [];
    return null;
  });

const { open: dialogOpen, save: dialogSave } =
  window.__TAURI__?.dialog ?? { open: async()=>null, save: async()=>null };

const { appWindow } =
  window.__TAURI__?.window ?? {
    appWindow: { close:()=>{}, minimize:()=>{}, toggleMaximize:()=>{} }
  };

const copyText = window.__TAURI__?.clipboard?.writeText ?? (async t => {
  try { await navigator.clipboard.writeText(t); } catch {}
});

const shellOpen = window.__TAURI__?.shell?.open ?? (() => {});

// ─── Language map ────────────────────────────────────────────────────────────
const LANG_MAP = {
  js: javascript(), mjs: javascript(), cjs: javascript(),
  ts: javascript({ typescript: true }),
  tsx: javascript({ typescript: true, jsx: true }),
  jsx: javascript({ jsx: true }),
  py: python(),
  rs: rust(),
  java: java(),
  kt: java(),
  css: css(), scss: css(), sass: css(),
  html: html(), htm: html(), vue: html(), svelte: html(),
  json: json(),
  md: markdown(), mdx: markdown(),
  sql: sql(),
  c: cpp(), cpp: cpp(), h: cpp(), hpp: cpp(), cc: cpp(),
  go: go(),
};

const LANG_NAMES = {
  js:'JavaScript', mjs:'JavaScript', ts:'TypeScript', tsx:'TypeScript',
  jsx:'JavaScript', py:'Python', rs:'Rust', java:'Java', kt:'Kotlin',
  css:'CSS', scss:'SCSS', html:'HTML', htm:'HTML', vue:'Vue',
  svelte:'Svelte', json:'JSON', md:'Markdown', sql:'SQL',
  c:'C', cpp:'C++', h:'C/C++', hpp:'C++', go:'Go',
};

function getLang(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return LANG_MAP[ext] || null;
}
function getLangName(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return LANG_NAMES[ext] || 'Текст';
}

const FILE_ICONS = {
  rs:'🦀', js:'📜', mjs:'📜', ts:'🔷', tsx:'🔷', jsx:'📜',
  html:'🌐', htm:'🌐', css:'🎨', scss:'🎨', json:'{}',
  md:'📝', toml:'⚙', yaml:'⚙', yml:'⚙', py:'🐍',
  java:'☕', kt:'🎯', go:'🐹', c:'©', cpp:'➕', h:'©',
  txt:'📄', sh:'⚡', bat:'⚡', xml:'📋', sql:'🗄',
  vue:'💚', svelte:'🔥', php:'🐘', rb:'💎', swift:'🍎',
  dart:'🎯', lua:'🌙', cs:'🔵', env:'🔒',
};
const FILE_ICON_CLS = {
  rs:'icon-rs', js:'icon-js', mjs:'icon-js', ts:'icon-ts', tsx:'icon-ts',
  jsx:'icon-js', html:'icon-html', htm:'icon-html', css:'icon-css',
  scss:'icon-css', json:'icon-json', md:'icon-md', toml:'icon-toml',
  yaml:'icon-toml', yml:'icon-toml', py:'icon-py', java:'icon-java',
  kt:'icon-java', go:'icon-rs', c:'icon-rs', cpp:'icon-rs',
};
function fileIcon(name) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return { emoji: FILE_ICONS[ext] || '📄', cls: FILE_ICON_CLS[ext] || 'icon-txt' };
}

// ─── STATE ───────────────────────────────────────────────────────────────────
const state = {
  tabs:      [],       // [{id, name, path, content, modified, lang}]
  activeTab: null,
  rootPath:  null,
  settings: {
    fontSize: 14, tabSize: 4, wordWrap: false,
    theme: 'dark', sidebarWidth: 220,
  },
  searchDebounce: null,
  ctxFilePath: null,
  ctxIsFolder: false,
  ctxTabId: null,
};

// ─── CodeMirror compartments (hot-swap) ─────────────────────────────────────
const langComp    = new Compartment();
const tabComp     = new Compartment();
const wrapComp    = new Compartment();
const themeComp   = new Compartment();

let cmView = null; // active EditorView

function buildCMExtensions(langExt) {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    scrollPastEnd(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    langComp.of(langExt || []),
    tabComp.of(indentUnit.of(' '.repeat(state.settings.tabSize))),
    wrapComp.of(state.settings.wordWrap ? EditorView.lineWrapping : []),
    EditorView.updateListener.of(update => {
      if (update.docChanged) {
        markModified();
        updateCursor();
      }
      if (update.selectionSet) updateCursor();
    }),
    EditorView.theme({
      '&': { height: '100%', backgroundColor: 'var(--base)' },
      '.cm-scroller': { fontFamily: 'var(--font-editor)', fontSize: state.settings.fontSize + 'px', lineHeight: '1.7' },
    }),
  ];
}

function initCM() {
  const host = document.getElementById('cm-host');
  if (!host) return;
  host.innerHTML = '';

  cmView = new EditorView({
    state: EditorState.create({
      doc: '',
      extensions: buildCMExtensions(null),
    }),
    parent: host,
  });
}

function setCMContent(content, langExt) {
  if (!cmView) return;
  cmView.dispatch({
    effects: [langComp.reconfigure(langExt || [])],
  });
  cmView.dispatch({
    changes: { from: 0, to: cmView.state.doc.length, insert: content },
  });
  // Scroll to top
  cmView.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
}

function getCMContent() {
  return cmView ? cmView.state.doc.toString() : '';
}

function updateCMFontSize(size) {
  if (!cmView) return;
  // Re-create theme compartment with new font size
  cmView.dispatch({
    effects: EditorView.updateConfig.of({}),
  });
  // Direct DOM approach for font size
  const scroller = cmView.dom.querySelector('.cm-scroller');
  if (scroller) scroller.style.fontSize = size + 'px';
  const gutters = cmView.dom.querySelector('.cm-gutters');
  if (gutters) gutters.style.fontSize = size + 'px';
}

function updateCMTabSize(size) {
  if (!cmView) return;
  cmView.dispatch({
    effects: tabComp.reconfigure(indentUnit.of(' '.repeat(size))),
  });
}

function updateCMWordWrap(on) {
  if (!cmView) return;
  cmView.dispatch({
    effects: wrapComp.reconfigure(on ? EditorView.lineWrapping : []),
  });
}

// ─── DOM refs ────────────────────────────────────────────────────────────────
const els = {
  titlebarTitle:   document.getElementById('titlebar-title'),
  tabsList:        document.getElementById('tabs-list'),
  editorContainer: document.getElementById('editor-container'),
  welcome:         document.getElementById('welcome'),
  fileTree:        document.getElementById('file-tree'),
  treeEmpty:       document.getElementById('tree-empty'),
  statusCursor:    document.getElementById('status-cursor'),
  statusLang:      document.getElementById('status-lang'),
  statusEncoding:  document.getElementById('status-encoding'),
  panelExplorer:   document.getElementById('panel-explorer'),
  panelSearch:     document.getElementById('panel-search'),
  panelSettings:   document.getElementById('panel-settings'),
  searchInput:     document.getElementById('search-input'),
  searchResults:   document.getElementById('search-results'),
  sidebar:         document.getElementById('sidebar'),
  resizeHandle:    document.getElementById('resize-handle'),
  // Settings
  fontsizeDisplay: document.getElementById('fontsize-display'),
  fontsizeDec:     document.getElementById('fontsize-dec'),
  fontsizeInc:     document.getElementById('fontsize-inc'),
  setWordwrap:     document.getElementById('set-wordwrap'),
  currentThemeLabel: document.getElementById('current-theme-label'),
  // Theme modal
  themeModalOverlay: document.getElementById('theme-modal-overlay'),
  themeModalClose:   document.getElementById('theme-modal-close'),
  themeOptDark:      document.getElementById('theme-opt-dark'),
  themeOptLight:     document.getElementById('theme-opt-light'),
  openThemeModal:    document.getElementById('open-theme-modal'),
  // New file modal
  newfileModalOverlay: document.getElementById('newfile-modal-overlay'),
  newfileInput:        document.getElementById('newfile-input'),
  newfileDirLabel:     document.getElementById('newfile-dir-label'),
  newfileExtBadge:     document.getElementById('newfile-ext-badge'),
  newfileLangHint:     document.getElementById('newfile-lang-hint'),
  newfileCancel:       document.getElementById('newfile-cancel'),
  newfileCreate:       document.getElementById('newfile-create'),
  // New folder modal
  newfolderModalOverlay: document.getElementById('newfolder-modal-overlay'),
  newfolderInput:        document.getElementById('newfolder-input'),
  newfolderDirLabel:     document.getElementById('newfolder-dir-label'),
  newfolderCancel:       document.getElementById('newfolder-cancel'),
  newfolderCreate:       document.getElementById('newfolder-create'),
  // Context menus
  contextMenu:    document.getElementById('context-menu'),
  tabContextMenu: document.getElementById('tab-context-menu'),
};

// ─── TABS ────────────────────────────────────────────────────────────────────
function renderTabs() {
  els.tabsList.innerHTML = '';
  state.tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === state.activeTab ? ' active' : '') + (tab.modified ? ' modified' : '');
    el.dataset.id = tab.id;
    const icon = fileIcon(tab.name);
    el.innerHTML = `
      <span class="tab-icon ${icon.cls}">${icon.emoji}</span>
      <span class="tab-name">${tab.name}</span>
      <button class="tab-close" title="Закрыть">✕</button>`;
    el.addEventListener('click', e => {
      if (e.target.classList.contains('tab-close') || e.target.closest('.tab-close')) return;
      activateTab(tab.id);
    });
    el.addEventListener('contextmenu', e => { e.preventDefault(); showTabCtx(e.clientX, e.clientY, tab.id); });
    el.querySelector('.tab-close').addEventListener('click', () => closeTab(tab.id));
    els.tabsList.appendChild(el);
  });

  const hasTab = state.tabs.length > 0;
  els.welcome.classList.toggle('hidden', hasTab);
  els.editorContainer.classList.toggle('hidden', !hasTab);
  if (!hasTab) els.titlebarTitle.textContent = '';
}

function activateTab(id) {
  // Save current CM content to previous tab
  if (state.activeTab && cmView) {
    const cur = state.tabs.find(t => t.id === state.activeTab);
    if (cur) cur.content = getCMContent();
  }
  state.activeTab = id;
  const tab = state.tabs.find(t => t.id === id);
  if (!tab) return;

  const langExt = getLang(tab.name);
  setCMContent(tab.content, langExt);
  els.statusLang.textContent = getLangName(tab.name);
  els.titlebarTitle.textContent = tab.name + ' — ScoreCode';
  renderTabs();
  updateActiveFileInTree(tab.path);
  cmView?.focus();
}

function closeTab(id) {
  const idx = state.tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  state.tabs.splice(idx, 1);
  if (state.activeTab === id) {
    const next = state.tabs[idx] || state.tabs[idx - 1];
    state.activeTab = next ? next.id : null;
    if (next) {
      setCMContent(next.content, getLang(next.name));
      els.statusLang.textContent = getLangName(next.name);
      els.titlebarTitle.textContent = next.name + ' — ScoreCode';
    } else {
      setCMContent('', null);
    }
  }
  renderTabs();
}

function openFileInEditor(name, path, content) {
  const existing = state.tabs.find(t => t.path === path);
  if (existing) { activateTab(existing.id); return; }
  const id = Date.now() + Math.random();
  state.tabs.push({ id, name, path, content, modified: false });
  activateTab(id);
}

function markModified() {
  const tab = state.tabs.find(t => t.id === state.activeTab);
  if (tab && !tab.modified) {
    tab.modified = true;
    renderTabs();
  }
}

function updateCursor() {
  if (!cmView) return;
  const pos    = cmView.state.selection.main.head;
  const line   = cmView.state.doc.lineAt(pos);
  const lineNo = line.number;
  const col    = pos - line.from + 1;
  els.statusCursor.textContent = `Стр ${lineNo}, Кол ${col}`;
}

function updateActiveFileInTree(path) {
  document.querySelectorAll('.tree-item[data-path]').forEach(el => {
    el.classList.toggle('selected', el.dataset.path === path);
  });
}

// ─── FILE TREE (Rust backend) ─────────────────────────────────────────────────
async function openFolder() {
  try {
    const selected = await dialogOpen({ directory: true, multiple: false, title: 'Открыть папку' });
    if (!selected) return;
    state.rootPath = selected;
    // Save last folder to settings
    state.settings.lastFolder = selected;
    await saveSettings();
    await renderFileTree(selected, null, 0);
    // Start file watcher via Rust
    try { await invoke('start_watching', { path: selected }); } catch {}
  } catch (e) { console.error('openFolder:', e); }
}

async function renderFileTree(dirPath, parentEl, depth) {
  const container = parentEl || els.fileTree;
  if (!parentEl) {
    container.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'tree-item';
    header.style.paddingLeft = '8px';
    const folderName = dirPath.split(/[\\/]/).pop();
    header.innerHTML = `<span class="tree-icon icon-folder">📁</span><span class="tree-name" style="font-weight:600;color:var(--text)">${folderName}</span>`;
    header.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e.clientX, e.clientY, null, dirPath, true); });
    container.appendChild(header);
  }

  let entries;
  try {
    // ← Rust orqali o'qiydi, sorted, filtered
    entries = await invoke('read_directory', { path: dirPath });
  } catch (e) {
    console.error('read_directory:', e);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'tree-item';
    item.style.paddingLeft = (8 + depth * 14 + 14) + 'px';

    if (entry.is_dir) {
      item.innerHTML = `<span class="tree-icon icon-folder">📁</span><span class="tree-name">${entry.name}</span>`;
      let expanded = false, subEl = null;
      item.addEventListener('click', async () => {
        expanded = !expanded;
        item.querySelector('.tree-icon').textContent = expanded ? '📂' : '📁';
        if (expanded) {
          subEl = document.createElement('div');
          item.after(subEl);
          await renderFileTree(entry.path, subEl, depth + 1);
        } else {
          subEl?.remove(); subEl = null;
        }
      });
      item.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e.clientX, e.clientY, null, entry.path, true); });
    } else {
      const icon = fileIcon(entry.name);
      item.innerHTML = `<span class="tree-icon ${icon.cls}">${icon.emoji}</span><span class="tree-name">${entry.name}</span>`;
      item.dataset.path = entry.path;
      item.addEventListener('click', async () => {
        document.querySelectorAll('.tree-item.selected').forEach(e => e.classList.remove('selected'));
        item.classList.add('selected');
        try {
          // ← Rust orqali o'qiydi
          const content = await invoke('read_file', { path: entry.path });
          openFileInEditor(entry.name, entry.path, content);
        } catch (e) { console.error('read_file:', e); }
      });
      item.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e.clientX, e.clientY, item, entry.path, false); });
    }
    container.appendChild(item);
  }
}

// File watcher event (Rust -> JS)
if (window.__TAURI__) {
  window.__TAURI__.event.listen('file-changed', async evt => {
    const { kind, path } = evt.payload;
    // Auto-reload if open tab file changed externally
    if (kind === 'modify') {
      const tab = state.tabs.find(t => t.path === path);
      if (tab && tab.id !== state.activeTab) {
        try {
          tab.content = await invoke('read_file', { path });
        } catch {}
      }
    }
    // Refresh tree on create/delete
    if ((kind === 'create' || kind === 'delete') && state.rootPath) {
      await renderFileTree(state.rootPath, null, 0);
    }
  });
}

// ─── SAVE ────────────────────────────────────────────────────────────────────
async function saveCurrentFile() {
  const tab = state.tabs.find(t => t.id === state.activeTab);
  if (!tab) return;
  tab.content = getCMContent();

  if (tab.path) {
    try {
      await invoke('write_file', { path: tab.path, content: tab.content });
      tab.modified = false;
      renderTabs();
    } catch (e) { console.error('write_file:', e); }
  } else {
    const savePath = await dialogSave({ title: 'Сохранить файл', defaultPath: tab.name });
    if (savePath) {
      tab.path = savePath;
      tab.name = savePath.split(/[\\/]/).pop();
      await invoke('write_file', { path: savePath, content: tab.content });
      tab.modified = false;
      renderTabs();
    }
  }
}

// ─── SETTINGS (Rust backend — real settings.json) ────────────────────────────
async function loadSettings() {
  try {
    const s = await invoke('load_settings');
    if (s && typeof s === 'object') {
      state.settings.fontSize    = s.font_size    ?? 14;
      state.settings.tabSize     = s.tab_size     ?? 4;
      state.settings.wordWrap    = s.word_wrap    ?? false;
      state.settings.theme       = s.theme        ?? 'dark';
      state.settings.sidebarWidth = s.sidebar_width ?? 220;
      if (s.last_folder) state.settings.lastFolder = s.last_folder;
    }
  } catch { /* defaults */ }
}

async function saveSettings() {
  try {
    await invoke('save_settings', {
      settings: {
        font_size:     state.settings.fontSize,
        tab_size:      state.settings.tabSize,
        word_wrap:     state.settings.wordWrap,
        theme:         state.settings.theme,
        sidebar_width: parseInt(els.sidebar.style.width) || state.settings.sidebarWidth,
        last_folder:   state.settings.lastFolder ?? null,
      }
    });
  } catch (e) { console.warn('save_settings:', e); }
}

function applyFontSize(size) {
  state.settings.fontSize = Math.max(8, Math.min(40, size));
  els.fontsizeDisplay.textContent = state.settings.fontSize;
  updateCMFontSize(state.settings.fontSize);
  saveSettings();
}
function applyTabSize(size) {
  state.settings.tabSize = size;
  document.querySelectorAll('.tab-size-btn').forEach(b => b.classList.toggle('active', +b.dataset.size === size));
  updateCMTabSize(size);
  saveSettings();
}
function applyWordWrap(on) {
  state.settings.wordWrap = on;
  els.setWordwrap.checked = on;
  updateCMWordWrap(on);
  saveSettings();
}
function applyTheme(theme) {
  state.settings.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  const labels = { dark: 'Catppuccin Mocha', light: 'Catppuccin Latte' };
  els.currentThemeLabel.textContent = labels[theme] || theme;
  els.themeOptDark.classList.toggle('active',  theme === 'dark');
  els.themeOptLight.classList.toggle('active', theme === 'light');
  saveSettings();
}

// ─── ACTIVITY BAR ─────────────────────────────────────────────────────────────
function activatePanel(name) {
  document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('act-' + name)?.classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('panel-' + name)?.classList.remove('hidden');
  if (els.sidebar.classList.contains('collapsed')) els.sidebar.classList.remove('collapsed');
}

// ─── RESIZE SIDEBAR ───────────────────────────────────────────────────────────
(function initResize() {
  let drag = false, startX = 0, startW = 0;
  els.resizeHandle.addEventListener('mousedown', e => {
    drag = true; startX = e.clientX; startW = els.sidebar.offsetWidth;
    els.resizeHandle.classList.add('dragging');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    els.sidebar.style.width = Math.max(160, Math.min(500, startW + e.clientX - startX)) + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!drag) return;
    drag = false;
    els.resizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    saveSettings();
  });
})();

// ─── SEARCH (Rust backend) ────────────────────────────────────────────────────
els.searchInput?.addEventListener('input', e => {
  const q = e.target.value.trim();
  if (!q) { els.searchResults.innerHTML = ''; return; }
  clearTimeout(state.searchDebounce);
  state.searchDebounce = setTimeout(async () => {
    if (state.rootPath) {
      // ← Rust ripgrep-style search
      try {
        const results = await invoke('search_in_files', {
          root: state.rootPath,
          query: q,
          caseSensitive: false,
          maxResults: 100,
        });
        renderSearchResults(results, q);
      } catch {}
    } else {
      // Fallback: search in open tabs
      const results = [];
      state.tabs.forEach(tab => {
        tab.content.split('\n').forEach((line, i) => {
          if (line.toLowerCase().includes(q.toLowerCase())) {
            results.push({ file_name: tab.name, line_number: i+1, line_content: line.trim().slice(0,80) });
          }
        });
      });
      renderSearchResults(results, q);
    }
  }, 300);
});

function renderSearchResults(results, q) {
  if (!results.length) {
    els.searchResults.innerHTML = '<div style="color:var(--overlay0);padding:8px 2px;font-size:12px">Ничего не найдено</div>';
    return;
  }
  const hl = s => s.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'), m => `<mark style="background:rgba(249,226,175,0.35);color:var(--yellow);border-radius:2px">${m}</mark>`);
  els.searchResults.innerHTML = results.slice(0, 60).map(r => `
    <div class="search-result-item" data-path="${r.file_path||''}" data-line="${r.line_number}" style="padding:5px 2px;cursor:pointer;border-radius:4px">
      <div style="color:var(--blue);font-size:11px;margin-bottom:1px">${r.file_name}:${r.line_number}</div>
      <div style="color:var(--overlay1);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${hl(r.line_content || '')}</div>
    </div>`).join('');

  els.searchResults.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('mouseenter', () => el.style.background = 'var(--surface0)');
    el.addEventListener('mouseleave', () => el.style.background = '');
    el.addEventListener('click', async () => {
      const path = el.dataset.path;
      const line = +el.dataset.line;
      if (!path) return;
      const name = path.split(/[\\/]/).pop();
      const existing = state.tabs.find(t => t.path === path);
      if (existing) {
        activateTab(existing.id);
      } else {
        try {
          const content = await invoke('read_file', { path });
          openFileInEditor(name, path, content);
        } catch {}
      }
      // Jump to line in CodeMirror
      if (cmView && line) {
        setTimeout(() => {
          try {
            const lineInfo = cmView.state.doc.line(line);
            cmView.dispatch({ selection: { anchor: lineInfo.from }, scrollIntoView: true });
            cmView.focus();
          } catch {}
        }, 50);
      }
    });
  });
}

// ─── NEW FILE MODAL ───────────────────────────────────────────────────────────
let _newfilePath = null;
const LANG_HINTS_MAP = {
  js:'JavaScript', ts:'TypeScript', py:'Python', rs:'Rust',
  java:'Java', kt:'Kotlin', go:'Go', cpp:'C++', c:'C', cs:'C#',
  html:'HTML страница', css:'CSS стили', json:'JSON данные',
  md:'Markdown файл', sql:'SQL файл', sh:'Shell скрипт',
  txt:'Текстовый файл', vue:'Vue компонент', svelte:'Svelte компонент',
  toml:'TOML конфиг', yaml:'YAML конфиг', yml:'YAML конфиг',
};

function showNewFileModal(dir) {
  _newfilePath = dir || state.rootPath || null;
  els.newfileDirLabel.textContent = _newfilePath ? _newfilePath.split(/[\\/]/).pop() : 'Без папки';
  els.newfileInput.value = '';
  els.newfileExtBadge.textContent = 'TXT';
  els.newfileLangHint.textContent = 'Текстовый файл';
  els.newfileModalOverlay.classList.remove('hidden');
  setTimeout(() => els.newfileInput.focus(), 50);
}
function hideNewFileModal() { els.newfileModalOverlay.classList.add('hidden'); }

els.newfileInput?.addEventListener('input', e => {
  const ext = e.target.value.trim().split('.').pop()?.toLowerCase() || '';
  els.newfileExtBadge.textContent = ext ? ext.toUpperCase() : 'TXT';
  els.newfileLangHint.textContent = LANG_HINTS_MAP[ext] || (ext ? ext.toUpperCase() + ' файл' : 'Текстовый файл');
});
els.newfileInput?.addEventListener('keydown', e => { if (e.key==='Enter') createNewFile(); if (e.key==='Escape') hideNewFileModal(); });
els.newfileCancel?.addEventListener('click', hideNewFileModal);
els.newfileCreate?.addEventListener('click', createNewFile);

async function createNewFile() {
  const name = els.newfileInput.value.trim();
  if (!name) { els.newfileInput.focus(); return; }
  hideNewFileModal();
  if (_newfilePath) {
    const sep = _newfilePath.includes('\\') ? '\\' : '/';
    const filePath = _newfilePath + sep + name;
    try {
      await invoke('create_file', { path: filePath });
      openFileInEditor(name, filePath, '');
      if (state.rootPath) await renderFileTree(state.rootPath, null, 0);
    } catch (e) {
      console.error('create_file:', e);
      openFileInEditor(name, filePath, '');
    }
  } else {
    const id = Date.now() + Math.random();
    state.tabs.push({ id, name, path: null, content: '', modified: true });
    activateTab(id);
  }
}

// ─── NEW FOLDER MODAL ─────────────────────────────────────────────────────────
let _newfolderPath = null;
function showNewFolderModal(dir) {
  _newfolderPath = dir || state.rootPath || null;
  els.newfolderDirLabel.textContent = _newfolderPath ? _newfolderPath.split(/[\\/]/).pop() : 'Корневая папка';
  els.newfolderInput.value = '';
  els.newfolderModalOverlay.classList.remove('hidden');
  setTimeout(() => els.newfolderInput.focus(), 50);
}
function hideNewFolderModal() { els.newfolderModalOverlay.classList.add('hidden'); }

els.newfolderInput?.addEventListener('keydown', e => { if (e.key==='Enter') createNewFolder(); if (e.key==='Escape') hideNewFolderModal(); });
els.newfolderCancel?.addEventListener('click', hideNewFolderModal);
els.newfolderCreate?.addEventListener('click', createNewFolder);

async function createNewFolder() {
  const name = els.newfolderInput.value.trim();
  if (!name) { els.newfolderInput.focus(); return; }
  hideNewFolderModal();
  if (_newfolderPath) {
    const sep = _newfolderPath.includes('\\') ? '\\' : '/';
    try { await invoke('create_directory', { path: _newfolderPath + sep + name }); } catch {}
    if (state.rootPath) await renderFileTree(state.rootPath, null, 0);
  }
}

// ─── CONTEXT MENU (file tree) ─────────────────────────────────────────────────
function showCtxMenu(x, y, item, filePath, isFolder) {
  state.ctxFilePath = filePath;
  state.ctxIsFolder = isFolder;
  const m = els.contextMenu;
  m.classList.remove('hidden');
  m.style.left = Math.min(x, window.innerWidth  - 205) + 'px';
  m.style.top  = Math.min(y, window.innerHeight - 210) + 'px';
}
function hideCtxMenu()    { els.contextMenu.classList.add('hidden'); }

els.contextMenu?.addEventListener('click', async e => {
  const item = e.target.closest('[data-action]');
  if (!item) return;
  hideCtxMenu();
  const act = item.dataset.action;
  const fp  = state.ctxFilePath;

  if (act === 'new-file')   { showNewFileModal(fp); }
  else if (act === 'new-folder') { showNewFolderModal(fp); }
  else if (act === 'copy-path') { try { await copyText(fp); } catch {} }
  else if (act === 'open-in-explorer') {
    const dir = state.ctxIsFolder ? fp : fp.replace(/[/\\][^/\\]+$/, '');
    try { await shellOpen(dir); } catch {}
  }
  else if (act === 'rename') {
    const oldName = fp.split(/[\\/]/).pop();
    const newName = prompt('Переименовать в:', oldName);
    if (newName && newName !== oldName) {
      const sep = fp.includes('\\') ? '\\' : '/';
      const newPath = fp.replace(/[/\\][^/\\]+$/, '') + sep + newName;
      try {
        await invoke('rename_path', { oldPath: fp, newPath });
        if (state.rootPath) await renderFileTree(state.rootPath, null, 0);
      } catch (e) { console.error('rename:', e); }
    }
  }
  else if (act === 'delete') {
    const name = fp.split(/[\\/]/).pop();
    if (confirm(`Удалить "${name}"?`)) {
      try {
        await invoke('delete_path', { path: fp });
        const tab = state.tabs.find(t => t.path === fp);
        if (tab) closeTab(tab.id);
        if (state.rootPath) await renderFileTree(state.rootPath, null, 0);
      } catch (e) { console.error('delete:', e); }
    }
  }
});

// ─── TAB CONTEXT MENU ─────────────────────────────────────────────────────────
function showTabCtx(x, y, tabId) {
  state.ctxTabId = tabId;
  const m = els.tabContextMenu;
  m.classList.remove('hidden');
  m.style.left = Math.min(x, window.innerWidth  - 215) + 'px';
  m.style.top  = Math.min(y, window.innerHeight - 130) + 'px';
}
function hideTabCtx() { els.tabContextMenu.classList.add('hidden'); }

els.tabContextMenu?.addEventListener('click', async e => {
  const item = e.target.closest('[data-action]');
  if (!item) return;
  hideTabCtx();
  const act = item.dataset.action;
  const id  = state.ctxTabId;
  if (act === 'tab-close') { closeTab(id); }
  else if (act === 'tab-close-others') {
    state.tabs = state.tabs.filter(t => t.id === id);
    state.activeTab = id;
    const tab = state.tabs[0];
    if (tab) { setCMContent(tab.content, getLang(tab.name)); }
    renderTabs();
  }
  else if (act === 'tab-close-all') {
    state.tabs = []; state.activeTab = null;
    setCMContent('', null); renderTabs();
  }
  else if (act === 'tab-copy-path') {
    const tab = state.tabs.find(t => t.id === id);
    if (tab?.path) try { await copyText(tab.path); } catch {}
  }
});

document.addEventListener('mousedown', e => {
  if (!els.contextMenu.contains(e.target))    hideCtxMenu();
  if (!els.tabContextMenu.contains(e.target)) hideTabCtx();
});

// ─── THEME MODAL ──────────────────────────────────────────────────────────────
els.openThemeModal?.addEventListener('click', () => els.themeModalOverlay.classList.remove('hidden'));
els.themeModalClose?.addEventListener('click', () => els.themeModalOverlay.classList.add('hidden'));
els.themeModalOverlay?.addEventListener('click', e => { if (e.target === els.themeModalOverlay) els.themeModalOverlay.classList.add('hidden'); });
els.themeOptDark?.addEventListener('click',  () => { applyTheme('dark');  els.themeModalOverlay.classList.add('hidden'); });
els.themeOptLight?.addEventListener('click', () => { applyTheme('light'); els.themeModalOverlay.classList.add('hidden'); });

// ─── WINDOW CONTROLS ─────────────────────────────────────────────────────────
document.getElementById('btn-close')?.addEventListener('click',    () => appWindow.close());
document.getElementById('btn-minimize')?.addEventListener('click', () => appWindow.minimize());
document.getElementById('btn-maximize')?.addEventListener('click', () => appWindow.toggleMaximize());

// ─── ACTIVITY BAR ─────────────────────────────────────────────────────────────
document.getElementById('act-explorer')?.addEventListener('click', () => activatePanel('explorer'));
document.getElementById('act-search')?.addEventListener('click',   () => activatePanel('search'));
document.getElementById('act-settings')?.addEventListener('click', () => activatePanel('settings'));

// ─── PANEL BUTTONS ────────────────────────────────────────────────────────────
['btn-open-folder','btn-open-folder2','btn-open-folder3'].forEach(id =>
  document.getElementById(id)?.addEventListener('click', openFolder));

['btn-new-file','btn-new-file2'].forEach(id =>
  document.getElementById(id)?.addEventListener('click', () => showNewFileModal(state.rootPath)));

document.getElementById('btn-new-folder')?.addEventListener('click', () => showNewFolderModal(state.rootPath));
document.getElementById('btn-save')?.addEventListener('click', saveCurrentFile);
document.getElementById('btn-collapse-sidebar')?.addEventListener('click', () => {
  els.sidebar.classList.add('collapsed');
  document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
});

// ─── SETTINGS CONTROLS ────────────────────────────────────────────────────────
els.fontsizeDec?.addEventListener('click', () => applyFontSize(state.settings.fontSize - 1));
els.fontsizeInc?.addEventListener('click', () => applyFontSize(state.settings.fontSize + 1));
document.querySelectorAll('.tab-size-btn').forEach(btn =>
  btn.addEventListener('click', () => applyTabSize(+btn.dataset.size)));
els.setWordwrap?.addEventListener('change', e => applyWordWrap(e.target.checked));

// ─── KEYBOARD SHORTCUTS ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    hideCtxMenu(); hideTabCtx();
    els.themeModalOverlay?.classList.add('hidden');
    hideNewFileModal(); hideNewFolderModal();
  }
  if ((e.ctrlKey || e.metaKey)) {
    if (e.key === 's') { e.preventDefault(); saveCurrentFile(); }
    if (e.key === 'w') { e.preventDefault(); if (state.activeTab) closeTab(state.activeTab); }
    if (e.key === 'n') { e.preventDefault(); showNewFileModal(state.rootPath); }
    if (e.key === 'b') { e.preventDefault(); activatePanel('explorer'); }
    if (e.key === 'f') { e.preventDefault(); activatePanel('search'); setTimeout(() => els.searchInput?.focus(), 80); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const idx  = state.tabs.findIndex(t => t.id === state.activeTab);
      const next = state.tabs[(idx + 1) % state.tabs.length];
      if (next) activateTab(next.id);
    }
  }
});

// ─── INIT ──────────────────────────────────────────────────────────────────────
async function init() {
  // 1. Load settings from Rust (real settings.json on disk)
  await loadSettings();

  // 2. Apply settings to UI
  applyFontSize(state.settings.fontSize);
  applyTabSize(state.settings.tabSize);
  applyWordWrap(state.settings.wordWrap);
  applyTheme(state.settings.theme);

  // 3. Restore sidebar width
  if (state.settings.sidebarWidth) {
    els.sidebar.style.width = state.settings.sidebarWidth + 'px';
  }

  // 4. Init CodeMirror
  initCM();

  // 5. Render tabs
  renderTabs();

  // 6. Debug: show settings path in console
  try {
    const settingsPath = await invoke('get_settings_path');
    console.log('[ScoreCode] Settings:', settingsPath);
  } catch {}
}

init();
