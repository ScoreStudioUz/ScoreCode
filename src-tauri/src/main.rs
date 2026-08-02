// ScoreCode 0.3.0 — Tauri Rust backend
// Barcha "og'ir" operatsiyalar shu yerda: fayl I/O, qidiruv, file watcher
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, Window};
use notify::{RecommendedWatcher, RecursiveMode, Watcher, Event, EventKind};
use walkdir::WalkDir;

// ─── Shared state ────────────────────────────────────────────────────────────

struct WatcherState(Mutex<Option<RecommendedWatcher>>);

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
    pub size: Option<u64>,
    pub extension: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SearchResult {
    pub file_path: String,
    pub file_name: String,
    pub line_number: usize,
    pub line_content: String,
    pub match_start: usize,
    pub match_end: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileWatchEvent {
    pub kind: String,   // "create" | "modify" | "delete" | "rename"
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppSettings {
    pub font_size: u32,
    pub tab_size: u32,
    pub word_wrap: bool,
    pub theme: String,
    pub sidebar_width: u32,
    pub last_folder: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            font_size: 14,
            tab_size: 4,
            word_wrap: false,
            theme: "dark".to_string(),
            sidebar_width: 220,
            last_folder: None,
        }
    }
}

// ─── Fayl operatsiyalari ──────────────────────────────────────────────────────

/// Papkadagi fayllarni o'qiydi (bir daraja)
#[tauri::command]
fn read_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Папка не найдена: {}", path));
    }
    if !p.is_dir() {
        return Err(format!("Это не папка: {}", path));
    }

    let mut entries: Vec<FileEntry> = Vec::new();

    let read = fs::read_dir(&path).map_err(|e| e.to_string())?;
    for entry in read {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta  = entry.metadata().map_err(|e| e.to_string())?;
        let name  = entry.file_name().to_string_lossy().to_string();

        // Yashirin fayllarni o'tkazib yubor
        if name.starts_with('.') { continue; }

        let file_path = entry.path().to_string_lossy().to_string();
        let is_dir    = meta.is_dir();
        let size      = if is_dir { None } else { Some(meta.len()) };
        let extension = if is_dir {
            None
        } else {
            Path::new(&name)
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
        };

        entries.push(FileEntry {
            name,
            path: file_path,
            is_dir,
            children: if is_dir { Some(vec![]) } else { None },
            size,
            extension,
        });
    }

    // Papkalar avval, keyin fayllar — har biri alifbo tartibida
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

/// Fayl matnini o'qiydi — UTF-8, aks holda lossy conversion
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("O'qish xatosi: {}", e))?;
    // UTF-8 bo'lmasa lossy decode
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Fayl yozadi
#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    // Papka mavjud bo'lmasa yaratib oladi
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content.as_bytes()).map_err(|e| format!("Yozish xatosi: {}", e))
}

/// Yangi fayl yaratadi (bo'sh)
#[tauri::command]
fn create_file(path: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, b"").map_err(|e| e.to_string())
}

/// Yangi papka yaratadi
#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Fayl yoki papkani o'chiradi
#[tauri::command]
fn delete_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

/// Fayl yoki papkani o'zgartiradi nomini
#[tauri::command]
fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

/// Fayl mavjudligini tekshiradi
#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

// ─── Qidiruv ─────────────────────────────────────────────────────────────────

/// Papka ichida matn qidiradi (rekursiv, tez)
#[tauri::command]
fn search_in_files(
    root: String,
    query: String,
    case_sensitive: bool,
    max_results: usize,
) -> Result<Vec<SearchResult>, String> {
    if query.is_empty() {
        return Ok(vec![]);
    }

    let q_lower = if case_sensitive {
        query.clone()
    } else {
        query.to_lowercase()
    };

    let mut results: Vec<SearchResult> = Vec::new();
    let max = if max_results == 0 { 200 } else { max_results };

    // Text fayl kengaytmalari
    let text_exts = [
        "rs", "js", "mjs", "ts", "tsx", "jsx",
        "html", "htm", "css", "scss", "sass",
        "json", "toml", "yaml", "yml",
        "md", "txt", "log",
        "py", "java", "kt", "go", "c", "cpp", "h", "hpp",
        "sh", "bat", "ps1",
        "xml", "svg", "vue", "svelte",
        "php", "rb", "swift", "dart", "lua", "cs",
        "sql", "graphql", "proto",
        "env", "gitignore", "dockerfile",
    ];

    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        if results.len() >= max { break; }

        let file_path = entry.path();
        let file_name = file_path.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        // Yashirin fayllarni o'tkazib yubor
        if file_name.starts_with('.') { continue; }

        // Faqat matnli fayllarni qidiramiz
        let ext = file_path.extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        if !text_exts.contains(&ext.as_str()) && !ext.is_empty() { continue; }

        // Katta fayllarni o'tkazib yubor (>2MB)
        if let Ok(meta) = entry.metadata() {
            if meta.len() > 2 * 1024 * 1024 { continue; }
        }

        let bytes = match fs::read(file_path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let content = String::from_utf8_lossy(&bytes);

        for (line_idx, line) in content.lines().enumerate() {
            if results.len() >= max { break; }

            let search_in = if case_sensitive {
                line.to_string()
            } else {
                line.to_lowercase()
            };

            if let Some(match_start) = search_in.find(&q_lower) {
                results.push(SearchResult {
                    file_path: file_path.to_string_lossy().to_string(),
                    file_name: file_name.clone(),
                    line_number: line_idx + 1,
                    line_content: line.chars().take(120).collect(),
                    match_start,
                    match_end: match_start + query.len(),
                });
            }
        }
    }

    Ok(results)
}

// ─── File Watcher ─────────────────────────────────────────────────────────────

/// Papkani kuzatishni boshlaydi — o'zgarishlarni frontendga yuboradi
#[tauri::command]
fn start_watching(
    path: String,
    window: Window,
    watcher_state: State<WatcherState>,
) -> Result<(), String> {
    let mut guard = watcher_state.0.lock().map_err(|e| e.to_string())?;

    // Avvalgi watcherni to'xtatamiz
    *guard = None;

    let window_clone = window.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            let kind_str = match event.kind {
                EventKind::Create(_) => "create",
                EventKind::Modify(_) => "modify",
                EventKind::Remove(_) => "delete",
                _ => return,
            };
            for path in &event.paths {
                let evt = FileWatchEvent {
                    kind: kind_str.to_string(),
                    path: path.to_string_lossy().to_string(),
                };
                let _ = window_clone.emit("file-changed", evt);
            }
        }
    }).map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    *guard = Some(watcher);
    Ok(())
}

/// Kuzatishni to'xtatadi
#[tauri::command]
fn stop_watching(watcher_state: State<WatcherState>) -> Result<(), String> {
    let mut guard = watcher_state.0.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

// ─── Settings ────────────────────────────────────────────────────────────────

fn settings_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("scorecode").join("settings.json"))
}

/// Sozlamalarni diskdan o'qiydi
#[tauri::command]
fn load_settings() -> AppSettings {
    let path = match settings_path() {
        Some(p) => p,
        None    => return AppSettings::default(),
    };
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return AppSettings::default(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}

/// Sozlamalarni diskka saqlaydi
#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<(), String> {
    let path = match settings_path() {
        Some(p) => p,
        None    => return Err("Config dir topilmadi".to_string()),
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// Settings fayl yo'lini qaytaradi (debug uchun)
#[tauri::command]
fn get_settings_path() -> String {
    settings_path()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

// ─── Main ─────────────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .manage(WatcherState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            // Fayl operatsiyalari
            read_directory,
            read_file,
            write_file,
            create_file,
            create_directory,
            delete_path,
            rename_path,
            path_exists,
            // Qidiruv
            search_in_files,
            // File watcher
            start_watching,
            stop_watching,
            // Settings
            load_settings,
            save_settings,
            get_settings_path,
        ])
        .run(tauri::generate_context!())
        .expect("ScoreCode ishga tushmadi");
}
