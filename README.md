# ScoreEdit 🎨

Лёгкий редактор кода на Tauri (Rust + HTML/CSS/JS).  
Тема: Catppuccin Mocha (тёмная) / Latte (светлая).

## Установка на D:

### 1. Переменные среды (ПЕРЕД установкой Rust)
Win+R → `sysdm.cpl` → Дополнительно → Переменные среды:
```
RUSTUP_HOME = D:\Rust\rustup
CARGO_HOME  = D:\Rust\cargo
```

### 2. Установить Rust
Скачай: https://rustup.rs  
При установке выбери "Customize" и укажи D:\Rust

### 3. Установить Node.js
Скачай: https://nodejs.org  
При установке измени путь на D:\NodeJS

### 4. Перенести проект на D:
```cmd
D:
mkdir D:\projects
xcopy /E /I C:\путь\к\scoreedit D:\projects\scoreedit
cd D:\projects\scoreedit
```

### 5. Запуск
```cmd
npm install
npm run dev
```

### 6. Сборка (финальный .exe)
```cmd
npm run build
```
Файл будет в: `src-tauri\target\release\ScoreEdit.exe`

## Возможности
- 📁 Файловый менеджер слева
- 🗂 Вкладки (tabs) с отметкой изменений
- 🌙 Тёмная тема Catppuccin Mocha
- ☀️ Светлая тема Catppuccin Latte
- 🔢 Номера строк
- 🔍 Поиск по открытым файлам
- ⚙️ Настройки (размер шрифта, табуляция, перенос)
- ⌨️ Горячие клавиши: Ctrl+S, Ctrl+W, Ctrl+N, Ctrl+Tab

## Горячие клавиши
| Клавиша    | Действие              |
|------------|-----------------------|
| Ctrl+S     | Сохранить файл        |
| Ctrl+N     | Новый файл            |
| Ctrl+W     | Закрыть вкладку       |
| Ctrl+Tab   | Следующая вкладка     |
| Tab        | Отступ (4 пробела)    |
