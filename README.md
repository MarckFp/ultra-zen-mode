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

Open _Settings → Ultra Zen Mode_ to set up zen mode. Changes apply immediately, even while zen mode is on, except **Full screen on activation**, which applies the next time you enter zen mode.

### Appearance

- **Zen theme** — switches to another installed theme in zen mode and back to your own theme on exit.
- **Limit line length** — keeps lines at a readable width. When off, text uses the full width of the window.
- **Line width** — maximum line length in characters. `0` uses your theme's width.
- **Font size** — text size in zen mode only. `0` keeps your normal size.
- **Header bar padding** — height of the top bar left behind after the action buttons are hidden: _Small_, _Medium_ (default) or _Original_.

### Focus

- **Fade other lines** — while you type, dims every line except the one with the cursor. Works in Live Preview and Source mode. **Faded line opacity** sets how visible the dimmed lines stay.
- **Darken screen edges** — darkens the left and right edges of the window to frame the text, which helps on wide screens. **Edge width** and **Edge darkness** set how far in the edges reach and how dark they are.

### Hide

- **Hide sidebars and command palette** — hides both sidebars and the ribbon, and blocks the swipe gestures that open them.
- **Hide note properties** — hides the properties (YAML frontmatter) block.
- **Hide note title** — hides the large inline title above the note.
- **Hide status bar** — hides the bar at the bottom of the window.
- **Hide tab bar** — hides the row of tabs above the editor.
- **Hide other open documents** — hides every other pane and split, so only the note you are in is visible.
- **Hide Bases toolbar**, **Hide header bar**, **Hide PDF toolbar** — hide those toolbars.

### Behaviour

- **Switch to reading mode** — opens the note in reading view and returns to the previous mode on exit. Turn this off to write in zen mode.
- **Lock note (prevent editing)** — blocks double-click and other gestures that would switch the note into edit mode. Only works together with **Switch to reading mode**. _On by default._
- **Exit zen mode on note close** — leaves zen mode when you close the note or move to another one.
- **Full screen on activation** — enters full screen with zen mode and leaves it on exit.

### Writing setup

For a distraction-free writing setup, turn off **Switch to reading mode**, then turn on **Hide other open documents**, **Fade other lines** and **Darken screen edges**, and pick a **Zen theme**.

If Obsidian closes while zen mode is on, your own theme, line length and sidebar layout are restored the next time it starts.

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

1. **Activate** — adds CSS classes (e.g. `uzm-hide-sidebars`) and a few CSS variables (line width, font size, fade and vignette values) to `document.body`, and adds the floating button and the vignette overlay.
2. **Style** — `styles.css` contains scoped rules that apply only while those classes are present. Nothing leaks outside of Zen Mode.
3. **Deactivate** — removes the classes, variables and overlays, and puts back the app settings zen mode changed.

Most of the work is CSS class toggling. A few things need app settings instead: the zen theme, readable line length and the sidebar swipe gestures. Before changing them, the plugin saves the original values in the vault's local storage on this device. If Obsidian quits while zen mode is on, those values are restored on the next start.

Obsidian has no public API for themes or app config, so `src/main.ts` reaches those internals through one small wrapper, `ObsidianInternals`.
