import { App, MarkdownView, Plugin, PluginSettingTab, Setting } from "obsidian";

// ─── Settings ──────────────────────────────────────────────────────────────

type HeaderPadding = "small" | "medium" | "original";

interface UltraZenModeSettings {
  hideSidebars: boolean;
  hideProperties: boolean;
  hideNoteTitle: boolean;
  hideStatusBar: boolean;
  hideTabBar: boolean;
  switchToReadingMode: boolean;
  lockNote: boolean;
  exitOnNoteClose: boolean;
  headerPadding: HeaderPadding;
}

const DEFAULT_SETTINGS: UltraZenModeSettings = {
  hideSidebars: true,
  hideProperties: true,
  hideNoteTitle: false,
  hideStatusBar: true,
  hideTabBar: true,
  switchToReadingMode: true,
  lockNote: true,
  exitOnNoteClose: true,
  headerPadding: "medium",
};

type BooleanSettingKey = {
  [K in keyof UltraZenModeSettings]: UltraZenModeSettings[K] extends boolean
    ? K
    : never;
}[keyof UltraZenModeSettings];

// ─── CSS class names applied to <body> ────────────────────────────────────

const CLS = {
  active: "uzm-active",
  hideSidebars: "uzm-hide-sidebars",
  hideProperties: "uzm-hide-properties",
  hideNoteTitle: "uzm-hide-note-title",
  hideStatusBar: "uzm-hide-status-bar",
  hideTabBar: "uzm-hide-tab-bar",
  lockNote: "uzm-lock-note",
  reverting: "uzm-reverting",
  headerSmall: "uzm-header-small",
  headerMedium: "uzm-header-medium",
} as const;

// ─── Plugin ───────────────────────────────────────────────────────────────

export default class UltraZenModePlugin extends Plugin {
  settings!: UltraZenModeSettings;

  private isZenActive = false;
  private floatingBtn: HTMLElement | null = null;
  private previousMode: "source" | "preview" | null = null;
  /** Saved value of Obsidian's swipeToOpenDrawers config, restored on exit. */
  private savedSwipeDrawers: boolean | null = null;
  /** MutationObservers watching drawer elements so they can be collapsed the moment Obsidian opens them. */
  private drawerObservers: MutationObserver[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();

    // Ribbon button
    this.addRibbonIcon("glasses", "Toggle Ultra Zen Mode", () => {
      this.toggleZenMode();
    });

    // Command palette entry
    this.addCommand({
      id: "toggle-zen-mode",
      name: "Toggle Zen Mode",
      callback: () => this.toggleZenMode(),
    });

    // Settings tab
    this.addSettingTab(new UltraZenModeSettingTab(this.app, this));

    // ── Lock note: intercept dblclick before Obsidian handles it ──────────
    this.registerDomEvent(
      document,
      "dblclick",
      (e: MouseEvent) => {
        if (!this.isZenActive || !this.settings.lockNote) return;
        const target = e.target as Element | null;
        if (target?.closest(".markdown-preview-view")) {
          e.stopPropagation();
        }
      },
      { capture: true },
    );

    // ── Lock note: suppress taps on non-interactive content (mobile) ──────
    // Registered on *window* (capture) so it fires before Obsidian's own
    // document-level capture handlers, which were registered earlier.
    // touchend is the right intercept point: it's where the browser decides
    // whether to synthesise a click/dblclick, and it is not passive by default.
    // Interactive targets (links, checkboxes, iframes/PDFs, …) are excluded.
    this.registerDomEvent(
      window,
      "touchend",
      (e: TouchEvent) => {
        if (!this.isZenActive || !this.settings.lockNote) return;
        const target = e.target as Element | null;
        if (!target?.closest(".markdown-preview-view")) return;
        if (
          target.closest(
            "a, button, input, label, .task-list-item-checkbox, iframe, embed",
          )
        )
          return;
        // Prevent synthetic click/dblclick and stop Obsidian's touchend handler
        e.preventDefault();
        e.stopPropagation();
      },
      { capture: true },
    );

    // ── Enforce sidebar state during zen mode ─────────────────────────────
    // Fallback: if a gesture bypasses the JS blocker, re-collapse the sidebar.
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        if (!this.isZenActive || !this.settings.hideSidebars) return;
        if (!this.app.workspace.leftSplit.collapsed)
          this.app.workspace.leftSplit.collapse();
        if (!this.app.workspace.rightSplit.collapsed)
          this.app.workspace.rightSplit.collapse();
      }),
    );

    // ── Exit zen mode when the active note is closed ───────────────────────
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (!this.isZenActive || !this.settings.exitOnNoteClose) return;
        // Exit if no markdown note is active (tab closed / navigated away)
        if (!this.app.workspace.getActiveViewOfType(MarkdownView)) {
          void this.exitZenMode();
        }
      }),
    );

    // ── Lock note: revert any mode switch that slips through ──────────────
    // If a mode switch reaches Obsidian despite the event interceptors, we
    // immediately blank the view (uzm-reverting) so the user sees nothing,
    // revert to preview, then reveal after two rAF cycles (one for DOM update,
    // one for paint) to guarantee the reading view is rendered first.
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        if (!this.isZenActive || !this.settings.lockNote) return;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view && view.getMode() !== "preview") {
          document.body.classList.add(CLS.reverting);
          const state = view.getState();
          void view
            .setState({ ...state, mode: "preview" }, { history: false })
            .then(() => {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  document.body.classList.remove(CLS.reverting);
                });
              });
            });
        }
      }),
    );
  }

  onunload(): void {
    // Always clean up when the plugin is disabled
    if (this.isZenActive) {
      void this.exitZenMode();
    }
  }

  // ─── Public toggle ──────────────────────────────────────────────────────

  toggleZenMode(): void {
    void (this.isZenActive ? this.exitZenMode() : this.enterZenMode());
  }

  // ─── Enter / Exit ───────────────────────────────────────────────────────

  private async enterZenMode(): Promise<void> {
    if (this.settings.hideSidebars) {
      // Disable swipe-to-open drawers and block all swipe gestures via data-ignore-swipe.
      const vault = this.app.vault as unknown as Record<
        string,
        (k: string, v?: unknown) => unknown
      >;
      this.savedSwipeDrawers =
        (vault["getConfig"]?.("swipeToOpenDrawers") as boolean | undefined) ??
        null;
      vault["setConfig"]?.("swipeToOpenDrawers", false);
      document.body.setAttribute("data-ignore-swipe", "true");
    }

    this.isZenActive = true;
    if (this.settings.hideSidebars) {
      this.app.workspace.leftSplit.collapse();
      this.app.workspace.rightSplit.collapse();
    }
    this.applyBodyClasses();
    this.mountFloatingButton();
    this.startWatchingDrawers();
    if (this.settings.switchToReadingMode) {
      await this.switchToReadingMode();
    }
  }

  private async exitZenMode(): Promise<void> {
    if (this.savedSwipeDrawers !== null) {
      const vault = this.app.vault as unknown as Record<
        string,
        (k: string, v?: unknown) => unknown
      >;
      vault["setConfig"]?.("swipeToOpenDrawers", this.savedSwipeDrawers);
      this.savedSwipeDrawers = null;
    }
    document.body.removeAttribute("data-ignore-swipe");
    this.stopWatchingDrawers();
    if (this.settings.hideSidebars) {
      this.app.workspace.leftSplit.collapse();
      this.app.workspace.rightSplit.collapse();
    }
    this.isZenActive = false;
    this.removeBodyClasses();
    this.unmountFloatingButton();
    await this.restorePreviousMode();
  }

  // ─── Drawer watcher ────────────────────────────────────────────────────

  private startWatchingDrawers(): void {
    if (!this.settings.hideSidebars) return;
    const watch = (
      sel: string,
      getSplit: () => { collapsed: boolean; collapse(): void },
    ) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const obs = new MutationObserver(() => {
        if (this.isZenActive && !getSplit().collapsed) getSplit().collapse();
      });
      obs.observe(el, { attributes: true, childList: false, subtree: false });
      this.drawerObservers.push(obs);
    };
    watch(".workspace-drawer.mod-left", () => this.app.workspace.leftSplit);
    watch(".workspace-drawer.mod-right", () => this.app.workspace.rightSplit);
  }

  private stopWatchingDrawers(): void {
    for (const obs of this.drawerObservers) obs.disconnect();
    this.drawerObservers = [];
  }

  // ─── Reading mode helpers ───────────────────────────────────────────────

  private async switchToReadingMode(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.getMode() === "preview") return;
    this.previousMode = view.getMode();
    const state = view.getState();
    await view.setState({ ...state, mode: "preview" }, { history: false });
  }

  private async restorePreviousMode(): Promise<void> {
    if (!this.previousMode) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view) {
      const state = view.getState();
      await view.setState(
        { ...state, mode: this.previousMode },
        { history: false },
      );
    }
    this.previousMode = null;
  }

  // ─── Body class helpers ─────────────────────────────────────────────────

  private applyBodyClasses(): void {
    const { classList } = document.body;
    classList.add(CLS.active);
    if (this.settings.hideSidebars) classList.add(CLS.hideSidebars);
    if (this.settings.hideProperties) classList.add(CLS.hideProperties);
    if (this.settings.hideNoteTitle) classList.add(CLS.hideNoteTitle);
    if (this.settings.hideStatusBar) classList.add(CLS.hideStatusBar);
    if (this.settings.hideTabBar) classList.add(CLS.hideTabBar);
    if (this.settings.lockNote) classList.add(CLS.lockNote);
    if (this.settings.headerPadding === "small") classList.add(CLS.headerSmall);
    else if (this.settings.headerPadding === "medium")
      classList.add(CLS.headerMedium);
    // "original" → no class; Obsidian's default padding is preserved
  }

  private removeBodyClasses(): void {
    document.body.classList.remove(...Object.values(CLS));
  }

  // ─── Floating exit button ───────────────────────────────────────────────

  private mountFloatingButton(): void {
    if (this.floatingBtn) return;

    const btn = document.createElement("button");
    btn.className = "uzm-exit-btn";
    btn.setAttribute("aria-label", "Exit Zen Mode");
    btn.setAttribute("title", "Exit Zen Mode");

    // Inline SVG: eye-off (Lucide)
    btn.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
				fill="none" stroke="currentColor"
				stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
				width="18" height="18" aria-hidden="true">
				<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20
					C5 20 1 12 1 12
					a18.45 18.45 0 0 1 5.06-5.94"/>
				<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4
					C19 4 23 12 23 12
					a18.5 18.5 0 0 1-2.16 3.19"/>
				<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
				<line x1="1" y1="1" x2="23" y2="23"/>
			</svg>`.trim();

    // Use registerDomEvent so the listener is automatically cleaned up
    this.registerDomEvent(btn, "click", () => this.exitZenMode());

    document.body.appendChild(btn);
    this.floatingBtn = btn;
  }

  private unmountFloatingButton(): void {
    this.floatingBtn?.remove();
    this.floatingBtn = null;
  }

  // ─── Data persistence ───────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<UltraZenModeSettings>,
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

// ─── Settings Tab ─────────────────────────────────────────────────────────

class UltraZenModeSettingTab extends PluginSettingTab {
  readonly plugin: UltraZenModePlugin;

  constructor(app: App, plugin: UltraZenModePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const save = async (key: BooleanSettingKey, value: boolean) => {
      this.plugin.settings[key] = value;
      await this.plugin.saveSettings();
    };

    this.addToggle(
      containerEl,
      "Hide sidebars and command palette",
      "Hides both sidebars, the ribbon, and blocks swipe gestures that open them or the command palette.",
      "hideSidebars",
      save,
    );

    this.addToggle(
      containerEl,
      "Hide note properties",
      "Hides the YAML frontmatter / properties block.",
      "hideProperties",
      save,
    );

    this.addToggle(
      containerEl,
      "Hide note title",
      "Hides the inline note title at the top of the editor.",
      "hideNoteTitle",
      save,
    );

    this.addToggle(
      containerEl,
      "Hide status bar",
      "Hides the bottom status bar.",
      "hideStatusBar",
      save,
    );

    this.addToggle(
      containerEl,
      "Hide tab bar",
      "Hides the editor tab bar.",
      "hideTabBar",
      save,
    );

    this.addToggle(
      containerEl,
      "Switch to reading mode",
      "Automatically enters reading view on activation and restores the previous mode on exit.",
      "switchToReadingMode",
      save,
    );

    this.addToggle(
      containerEl,
      "Lock note (prevent editing)",
      "Blocks double-click and other gestures that would switch the note into edit mode while zen mode is active.",
      "lockNote",
      save,
    );

    this.addToggle(
      containerEl,
      "Exit zen mode on note close",
      "Automatically exits zen mode when the active note is closed or navigated away from.",
      "exitOnNoteClose",
      save,
    );

    new Setting(containerEl)
      .setName("Header bar padding")
      .setDesc(
        "Height of the top bar left behind after action buttons are hidden.",
      )
      .addDropdown((dd) =>
        dd
          .addOption("small", "Small")
          .addOption("medium", "Medium")
          .addOption("original", "Original")
          .setValue(this.plugin.settings.headerPadding)
          .onChange(async (value) => {
            this.plugin.settings.headerPadding = value as HeaderPadding;
            await this.plugin.saveSettings();
          }),
      );
  }

  private addToggle(
    el: HTMLElement,
    name: string,
    desc: string,
    key: BooleanSettingKey,
    save: (key: BooleanSettingKey, value: boolean) => Promise<void>,
  ): void {
    new Setting(el)
      .setName(name)
      .setDesc(desc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings[key])
          .onChange((value) => save(key, value)),
      );
  }
}
