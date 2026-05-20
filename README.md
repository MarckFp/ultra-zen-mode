# Ultra Zen Mode

A lightweight [Obsidian](https://obsidian.md) plugin that clears the screen so you can read and write without distractions. One tap hides everything you don't need; a floating button brings it all back the moment you want it.

Works on **desktop, tablet, and mobile**.

---

## What it does

When you activate Zen Mode, Ultra Zen Mode hides the parts of the Obsidian interface that aren't your content:

| Element                       | Hidden by default |
| ----------------------------- | ----------------- |
| Left sidebar (ribbon + panel) | ✅                |
| Right sidebar                 | ✅                |
| Note properties / frontmatter | ✅                |
| Tab bar                       | ✅                |
| Status bar                    | ✅                |
| Inline note title             | ❌ (optional)     |

A small **floating exit button** appears in the bottom-right corner of the screen. It stays out of your way (very transparent) until you hover or tap it, then it comes forward so you can exit Zen Mode with one click.

---

## How to activate

**Three ways — use whichever feels natural:**

1. **Ribbon button** — click the glasses icon (🕶) in the left icon bar.
2. **Command palette** — open it with `Ctrl/Cmd + P`, search for `Toggle Zen Mode`.
3. **Hotkey** — assign a keyboard shortcut in _Settings → Hotkeys → Ultra Zen Mode: Toggle Zen Mode_.

To exit, click the floating button that appears in the bottom-right corner, or use any of the three methods above again.

---

## Settings

Open _Settings → Ultra Zen Mode_ to choose exactly what gets hidden:

- **Hide left sidebar** — hides the icon ribbon and the sidebar panel on the left.
- **Hide right sidebar** — hides the sidebar panel on the right.
- **Hide note properties** — hides the YAML frontmatter / properties block at the top of a note.
- **Hide note title** — hides the large inline title above the note body.
- **Hide status bar** — hides the small bar at the very bottom of the window.
- **Hide tab bar** — hides the row of open-note tabs above the editor.
- **Switch to reading mode** — automatically enters reading view when zen mode activates and restores the previous mode on exit.
- **Lock note (prevent editing)** — blocks double-click and any other gesture that would accidentally switch the note into edit mode while zen mode is active. The floating exit button is the only way to leave zen mode when this is on. _On by default._
- **Header bar padding** — controls the height of the top bar left behind after the action buttons are hidden. Three options:
  - _Small_ — nearly flush, minimal gap.
  - _Medium_ — a comfortable reduced gap _(default)_.
  - _Original_ — keeps Obsidian's default header height unchanged.

All settings take effect the next time you enter Zen Mode, so you can experiment freely.

---

## Installation

### From the Community Plugin store _(once published)_

1. Open _Settings → Community plugins_ and disable Safe Mode if asked.
2. Click **Browse**, search for **Ultra Zen Mode**, and install it.
3. Enable the plugin with the toggle.

### Manual installation

1. Download `main.js`, `styles.css`, and `manifest.json` from the [latest release](../../releases/latest).
2. Create the folder `.obsidian/plugins/ultra-zen-mode/` inside your vault.
3. Copy the three files into that folder.
4. Restart Obsidian (or reload plugins via _Settings → Community plugins → Reload plugins_).
5. Enable **Ultra Zen Mode** in _Settings → Community plugins_.

---

## Development

Requirements: **Node.js ≥ 18** and **npm**.

```bash
# Clone and install dependencies
git clone https://github.com/MarckFp/ultra-zen-mode
cd ultra-zen-mode
npm install

# Watch mode — rebuilds on every file save
npm run dev

# Production build (minified, no sourcemap)
npm run build
```

The plugin is written **100% in TypeScript** — no JavaScript source files. The build pipeline is:

```
src/main.ts  →  esbuild (via esbuild.config.ts + tsx)  →  main.js
```

Copy `main.js`, `styles.css`, and `manifest.json` into your vault's plugin folder to test locally.

---

## How it works (technical overview)

Ultra Zen Mode is intentionally simple and fast. The entire logic lives in a single file, `src/main.ts`, and works in three steps:

1. **Activate** — adds a set of CSS classes (e.g. `uzm-hide-left-sidebar`) to `document.body`.
2. **Style** — `styles.css` contains scoped rules that hide the target elements only while those classes are present. Nothing leaks outside of Zen Mode.
3. **Deactivate** — removes all classes and the floating button. The UI is instantly restored; no DOM manipulation required.

Because the approach is pure CSS class toggling, it is extremely fast and does not rely on timers, MutationObservers, or any polling.

---

## License

[MIT](LICENSE)
