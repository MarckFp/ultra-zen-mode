# Changelog

All notable changes to **Ultra Zen Mode** are listed here.
New entries and version bumps are written automatically by AI on every commit.
To release: run `npm run release` — it seals `[Unreleased]`, commits, tags, and pushes.

---

## [Unreleased]

## [1.11.0] – 2026-06-01

- Added option to exit zen mode when the active note is closed
- Changed opacity of the workspace drawer backdrop to 0.55
- Changed opacity of the zen mode exit button to 0.8
## [1.10.0] – 2026-06-01

- Added event handler to enforce sidebar state during zen mode, collapsing any opened sidebars if configured to hide them.
- Changed CSS for the workspace tab header container to improve layout handling in frameless mode.
## [1.9.0] – 2026-06-01

- Added touch event suppression for edge swipes on mobile devices to enhance Zen mode functionality.
- Implemented a mechanism to track and block touch gestures that could open hidden sidebars while Zen mode is active.
- Added CSS rules to prevent hidden sidebars from receiving touch events, ensuring swipe gestures cannot initiate.
## [1.8.0] – 2026-05-20

- Added a new CSS class for reverting mode switches to prevent flickering during transitions.
- Changed the layout-change handler to add and remove the reverting class for a smoother user experience when locking notes.
## [1.7.0] – 2026-05-20

- Added support to block edge swipes that open hidden sidebars when Zen mode is active.
- Changed event registration for touch events to use window instead of document for better event handling.
- Added CSS to disable double-tap-to-zoom on the reading view to prevent flicker on mobile.
## [1.6.0] – 2026-05-20

- Changed touch event handling to suppress taps on non-interactive content for mobile devices.
- Removed the lastPreviewClickTime property and related double-tap detection logic.
## [1.5.0] – 2026-05-20

- Added a new setting to lock the note during Zen mode to prevent accidental mode switches on mobile devices.
- Implemented double-tap detection for locking notes in the preview view on mobile.
- Updated CSS to ensure the source editor is invisible when the lock note feature is active.
## [1.4.1] – 2026-05-20

- Changed formatting of code for better readability
- Updated description for 'Header bar padding' setting
## [1.4.0] – 2026-05-20

- Added a setting to lock the note, preventing editing while Zen mode is active.
- Introduced a header padding setting with options for small, medium, and original padding.
- Changed the CSS to adjust the header bar height based on the selected padding option.
## [1.3.0] – 2026-05-20

- Added settings to control visibility of various UI elements in Zen Mode.
- Implemented a toggle for entering and exiting Zen Mode.
- Added a floating button for easy access to exit Zen Mode.
## [1.3.0] – 2026-05-20

- Added a setting to automatically switch to reading mode on activation and restore the previous mode on exit.
- Changed the plugin to switch to reading mode when entering Zen mode if the setting is enabled.
- Changed the exit process to restore the previous mode after exiting Zen mode.

## [1.2.0] – 2026-05-20

- Added support for hiding the mobile navigation bar in Zen mode
- Changed the positioning of the exit button to account for safe areas on mobile devices
- Updated styles for the exit button to improve visibility on touch devices

## [1.1.1] – 2026-05-19

- Changed indentation in esbuild configuration for consistency
- Updated CSS styles for better readability
- Improved formatting of exit button styles in CSS

## [1.1.0] – 2026-05-19

- Changed import of built-in modules to use 'builtinModules' from 'node:module'
- Updated CSS selectors to be more specific for hiding elements in Zen mode

## [1.0.2] – 2026-05-19

- Fixed missing newline at the end of the release script

## [1.0.0] – 2026-05-19

- Initial release
