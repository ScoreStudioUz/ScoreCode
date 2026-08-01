// ===== ScoreEdit — main.js =====
// Tauri API (window.__TAURI__ mavjud bo'lganda ishlaydi)
const { invoke } = window.__TAURI__?.tauri ?? { invoke: async () => {} };
const { open: dialogOpen } = window.__TAURI__?.dialog ?? { open: async () => null };
const { readTextFile, writeTextFile, readDir } = window.__TAURI__?.fs ?? {
  readTextFile: async () => '',
  writeTextFile: async () => {},
  readDir: async () => []
};
const { appWindow } = window.__TAURI__?.window ?? { appWindow: { close: ()=>{}, minimize: ()=>{}, toggleMaximize: ()=>{} } };

// ===== STATE =====
const state = {
  tabs: [],          // [{ id, name, path, content, modified, lang }]
  activeTab: null,   // tab.id
  rootPath: null,
  fontSize: 14,
  tabSize: 4,
  wordWrap: false,
};

// ===== DOM =====
const els = {
  titlebarTitle:   document.getElementById('titlebar-title'),
  tabsList:        document.getElementById('tabs-list'),
  editorTextarea:  document.getElementById('editor-textarea'),
  editorGutter:    document.getElementById('editor-gutter'),
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
  setFontsize:     document.getElementById('set-fontsize'),
  setTabsize:      document.getElementById('set-tabsize'),
  setWordwrap:     document.getElementById('set-wordwrap'),
  setTheme:        document.getElementById('set-theme'),
  resizeHandle:    document.getElementById('resize-handle'),
  sidebar:         document.getElementById('sidebar'),
};

// ===== FILE ICONS =====
const FILE_ICONS = {
  rs:   { emoji: '🦀', cls: 'icon-rs' },
  js:   { emoji: '📜', cls: 'icon-js' },
  mjs:  { emoji: '📜', cls: 'icon-js' },
  ts:   { emoji: '🔷', cls: 'icon-ts' },
  html: { emoji: '🌐', cls: 'icon-html' },
  css:  { emoji: '🎨', cls: 'icon-css' },
  json: { emoji: '{}', cls: 'icon-json' },
  md:   { emoji: '📝', cls: 'icon-md' },
  toml: { emoji: '⚙', cls: 'icon-toml' },
  yaml: { emoji: '⚙', cls: 'icon-toml' },
  yml:  { emoji: '⚙', cls: 'icon-toml' },
  py:   { emoji: '🐍', cls: 'icon-py' },
  java: { emoji: '☕', cls: 'icon-java' },
  kt:   { emoji: '🎯', cls: 'icon-java' },
  go:   { emoji: '🐹', cls: 'icon-rs' },
  c:    { emoji: '©', cls: 'icon-rs' },
  cpp:  { emoji: '➕', cls: 'icon-rs' },
  txt:  { emoji: '📄', cls: 'icon-txt' },
};

function getFileIcon(name) {
  const ext = name.split('.').pop()?.toLowerCase() || 'txt';
  return FILE_ICONS[ext] || FILE_ICONS.txt;
}

function getLang(name) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map = {
    rs:'Rust', js:'JavaScript', ts:'TypeScript', html:'HTML', css:'CSS',
    json:'JSON', md:'Markdown', toml:'TOML', py:'Python', java:'Java',
    kt:'Kotlin', go:'Go', c:'C', cpp:'C++', yaml:'YAML', yml:'YAML',
  };
  return map[ext] || 'Текст';
}

// ===== TABS =====
function renderTabs() {
  els.tabsList.innerHTML = '';
  state.tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === state.activeTab ? ' active' : '') + (tab.modified ? ' modified' : '');
    el.dataset.id = tab.id;
    const icon = getFileIcon(tab.name);
    el.innerHTML = `
      <span class="tab-icon ${icon.cls}">${icon.emoji}</span>
      <span class="tab-name">${tab.name}</span>
      <button class="tab-close" data-id="${tab.id}" title="Закрыть">✕</button>
    `;
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close') || e.target.closest('.tab-close')) return;
      activateTab(tab.id);
    });
    el.querySelector('.tab-close').addEventListener('click', () => closeTab(tab.id));
    els.tabsList.appendChild(el);
  });

  // Show/hide editor vs welcome
  if (state.tabs.length === 0) {
    els.welcome.classList.remove('hidden');
    els.editorContainer.classList.add('hidden');
  } else {
    els.welcome.classList.add('hidden');
    els.editorContainer.classList.remove('hidden');
  }
}

function activateTab(id) {
  // Save current content
  if (state.activeTab) {
    const cur = state.tabs.find(t => t.id === state.activeTab);
    if (cur) cur.content = els.editorTextarea.value;
  }
  state.activeTab = id;
  const tab = state.tabs.find(t => t.id === id);
  if (!tab) return;
  els.editorTextarea.value = tab.content;
  els.statusLang.textContent = getLang(tab.name);
  els.titlebarTitle.textContent = tab.name + ' — ScoreEdit';
  updateGutter();
  renderTabs();
  updateActiveFileInTree(tab.path);
}

function closeTab(id) {
  const idx = state.tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  state.tabs.splice(idx, 1);
  if (state.activeTab === id) {
    const next = state.tabs[idx] || state.tabs[idx - 1];
    state.activeTab = next ? next.id : null;
    if (next) {
      els.editorTextarea.value = next.content;
      els.statusLang.textContent = getLang(next.name);
    } else {
      els.editorTextarea.value = '';
      els.titlebarTitle.textContent = 'ScoreEdit';
    }
  }
  renderTabs();
  updateGutter();
}

function openFileInEditor(name, path, content) {
  const existing = state.tabs.find(t => t.path === path);
  if (existing) { activateTab(existing.id); return; }
  const id = Date.now() + Math.random();
  state.tabs.push({ id, name, path, content, modified: false, lang: getLang(name) });
  activateTab(id);
}

// ===== GUTTER (line numbers) =====
function updateGutter() {
  const lines = els.editorTextarea.value.split('\n').length;
  els.editorGutter.innerHTML = Array.from({length: lines}, (_, i) => i + 1).join('<br>');
}

// ===== FILE TREE =====
async function openFolder() {
  try {
    const selected = await dialogOpen({ directory: true, multiple: false, title: 'Открыть папку' });
    if (!selected) return;
    state.rootPath = selected;
    await renderFileTree(selected);
    els.treeEmpty?.remove();
  } catch (e) {
    console.error('openFolder error:', e);
  }
}

async function renderFileTree(dirPath, parentEl, depth = 0) {
  const container = parentEl || els.fileTree;
  if (!parentEl) {
    container.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'tree-item';
    header.style.paddingLeft = '8px';
    const folderName = dirPath.split(/[\\/]/).pop();
    header.innerHTML = `<span class="tree-icon icon-folder">📁</span><span class="tree-name" style="font-weight:600;color:var(--text)">${folderName}</span>`;
    container.appendChild(header);
  }

  try {
    const entries = await readDir(dirPath, { recursive: false });
    // Folders first, then files
    const sorted = entries.sort((a, b) => {
      if (a.children && !b.children) return -1;
      if (!a.children && b.children) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (entry.name.startsWith('.')) continue; // hide hidden
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.style.paddingLeft = (8 + depth * 14 + 14) + 'px';

      if (entry.children !== undefined) {
        // Folder
        item.innerHTML = `<span class="tree-icon icon-folder">📁</span><span class="tree-name">${entry.name}</span>`;
        let expanded = false;
        item.addEventListener('click', async () => {
          if (!expanded) {
            expanded = true;
            item.querySelector('.tree-icon').textContent = '📂';
            const sub = document.createElement('div');
            sub.className = 'subtree';
            item.after(sub);
            await renderFileTree(entry.path, sub, depth + 1);
          } else {
            expanded = false;
            item.querySelector('.tree-icon').textContent = '📁';
            const sub = item.nextElementSibling;
            if (sub?.classList.contains('subtree')) sub.remove();
          }
        });
      } else {
        // File
        const icon = getFileIcon(entry.name);
        item.innerHTML = `<span class="tree-icon ${icon.cls}">${icon.emoji}</span><span class="tree-name">${entry.name}</span>`;
        item.dataset.path = entry.path;
        item.addEventListener('click', async () => {
          document.querySelectorAll('.tree-item.selected').forEach(el => el.classList.remove('selected'));
          item.classList.add('selected');
          try {
            const content = await readTextFile(entry.path);
            openFileInEditor(entry.name, entry.path, content);
          } catch (e) {
            console.error('readTextFile error:', e);
          }
        });
      }
      container.appendChild(item);
    }
  } catch (e) {
    console.error('readDir error:', e);
  }
}

function updateActiveFileInTree(path) {
  document.querySelectorAll('.tree-item[data-path]').forEach(el => {
    el.classList.toggle('selected', el.dataset.path === path);
  });
}

// ===== SAVE =====
async function saveCurrentFile() {
  const tab = state.tabs.find(t => t.id === state.activeTab);
  if (!tab) return;
  tab.content = els.editorTextarea.value;
  if (tab.path) {
    try {
      await writeTextFile(tab.path, tab.content);
      tab.modified = false;
      renderTabs();
    } catch (e) {
      console.error('save error:', e);
    }
  }
}

// ===== CURSOR POSITION =====
function updateCursor() {
  const text = els.editorTextarea.value;
  const pos  = els.editorTextarea.selectionStart;
  const before = text.substring(0, pos);
  const line = before.split('\n').length;
  const col  = before.split('\n').pop().length + 1;
  els.statusCursor.textContent = `Стр ${line}, Кол ${col}`;
}

// ===== SETTINGS =====
function applyFontSize(size) {
  state.fontSize = size;
  els.editorTextarea.style.fontSize = size + 'px';
  els.editorGutter.style.fontSize   = size + 'px';
}
function applyTabSize(size) {
  state.tabSize = size;
  els.editorTextarea.style.tabSize = size;
}
function applyWordWrap(on) {
  state.wordWrap = on;
  els.editorTextarea.style.whiteSpace = on ? 'pre-wrap' : 'pre';
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// ===== ACTIVITY BAR (panels) =====
function activatePanel(name) {
  document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('act-' + name)?.classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('panel-' + name)?.classList.remove('hidden');
}

// ===== RESIZE SIDEBAR =====
(function initResize() {
  let dragging = false, startX = 0, startW = 0;
  els.resizeHandle.addEventListener('mousedown', e => {
    dragging = true;
    startX = e.clientX;
    startW = els.sidebar.offsetWidth;
    els.resizeHandle.classList.add('dragging');
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const w = Math.max(140, Math.min(400, startW + e.clientX - startX));
    els.sidebar.style.width = w + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    els.resizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

// ===== TAB KEY =====
els.editorTextarea.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = els.editorTextarea.selectionStart;
    const end   = els.editorTextarea.selectionEnd;
    const spaces = ' '.repeat(state.tabSize);
    const val = els.editorTextarea.value;
    els.editorTextarea.value = val.substring(0, start) + spaces + val.substring(end);
    els.editorTextarea.selectionStart = els.editorTextarea.selectionEnd = start + state.tabSize;
    updateGutter();
    markModified();
  }
});

// ===== MARK MODIFIED =====
function markModified() {
  const tab = state.tabs.find(t => t.id === state.activeTab);
  if (tab && !tab.modified) {
    tab.modified = true;
    renderTabs();
  }
}

// ===== NEW FILE =====
function newUntitledFile() {
  const id   = Date.now() + Math.random();
  const name = 'untitled-' + (state.tabs.length + 1) + '.txt';
  state.tabs.push({ id, name, path: null, content: '', modified: true });
  activateTab(id);
}

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 's') { e.preventDefault(); saveCurrentFile(); }
    if (e.key === 'w') { e.preventDefault(); if (state.activeTab) closeTab(state.activeTab); }
    if (e.key === 'n') { e.preventDefault(); newUntitledFile(); }
    if (e.key === 'Tab') {
      e.preventDefault();
      const idx = state.tabs.findIndex(t => t.id === state.activeTab);
      const next = state.tabs[(idx + 1) % state.tabs.length];
      if (next) activateTab(next.id);
    }
  }
});

// ===== EVENTS =====
els.editorTextarea.addEventListener('input', () => { updateGutter(); markModified(); });
els.editorTextarea.addEventListener('keyup', updateCursor);
els.editorTextarea.addEventListener('click', updateCursor);
els.editorTextarea.addEventListener('scroll', () => {
  els.editorGutter.scrollTop = els.editorTextarea.scrollTop;
});

// Activity bar buttons
document.getElementById('act-explorer')?.addEventListener('click', () => activatePanel('explorer'));
document.getElementById('act-search')?.addEventListener('click',   () => activatePanel('search'));
document.getElementById('act-settings')?.addEventListener('click', () => activatePanel('settings'));

// Open folder buttons
['btn-open-folder','btn-open-folder2','btn-open-folder3'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', openFolder);
});
// New file buttons
['btn-new-file','btn-new-file2'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', newUntitledFile);
});

// Save button
document.getElementById('btn-save')?.addEventListener('click', saveCurrentFile);

// Titlebar window controls
document.getElementById('btn-close')?.addEventListener('click',    () => appWindow.close());
document.getElementById('btn-minimize')?.addEventListener('click', () => appWindow.minimize());
document.getElementById('btn-maximize')?.addEventListener('click', () => appWindow.toggleMaximize());

// Settings
els.setFontsize?.addEventListener('input',  e => applyFontSize(+e.target.value));
els.setTabsize?.addEventListener('change',  e => applyTabSize(+e.target.value));
els.setWordwrap?.addEventListener('change', e => applyWordWrap(e.target.checked));
els.setTheme?.addEventListener('change',    e => applyTheme(e.target.value));

// Search
els.searchInput?.addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) { els.searchResults.innerHTML = ''; return; }
  const results = [];
  state.tabs.forEach(tab => {
    const lines = tab.content.split('\n');
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(q)) {
        results.push(`<div style="padding:3px 0;cursor:pointer" data-tab="${tab.id}" data-line="${i+1}">`
          + `<span style="color:var(--blue)">${tab.name}:${i+1}</span><br>`
          + `<span style="color:var(--overlay1);font-size:11px">${line.trim().substring(0, 50)}</span></div>`);
      }
    });
  });
  els.searchResults.innerHTML = results.length
    ? results.slice(0, 20).join('')
    : '<div style="color:var(--overlay0);padding:6px 0">Ничего не найдено</div>';
});

// ===== INIT =====
updateGutter();
renderTabs();
