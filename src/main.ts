import { App, MarkdownView, Plugin, PluginSettingTab, Setting } from "obsidian";

// ─── Settings ──────────────────────────────────────────────────────────────

type HeaderPadding = "small" | "medium" | "original";

interface UltraZenModeSettings {
  hideSidebars: boolean;
  hideProperties: boolean;
  hideNoteTitle: boolean;
  hideStatusBar: boolean;
  hideTabBar: boolean;
  hideBaseToolbar: boolean;
  hideViewHeader: boolean;
  hidePdfToolbar: boolean;
  switchToReadingMode: boolean;
  lockNote: boolean;
  exitOnNoteClose: boolean;
  fullScreenOnActivate: boolean;
  headerPadding: HeaderPadding;
  zenTheme: string;
  hideOpenDocuments: boolean;
  limitLineLength: boolean;
}

const DEFAULT_SETTINGS: UltraZenModeSettings = {
  hideSidebars: true,
  hideProperties: true,
  hideNoteTitle: false,
  hideStatusBar: true,
  hideTabBar: true,
  hideBaseToolbar: true,
  hideViewHeader: true,
  hidePdfToolbar: true,
  switchToReadingMode: true,
  lockNote: true,
  exitOnNoteClose: true,
  fullScreenOnActivate: false,
  headerPadding: "medium",
  zenTheme: "",
  hideOpenDocuments: false,
  limitLineLength: true,
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
  hideBaseToolbar: "uzm-hide-base-toolbar",
  hideViewHeader: "uzm-hide-view-header",
  hidePdfToolbar: "uzm-hide-pdf-toolbar",
  lockNote: "uzm-lock-note",
  reverting: "uzm-reverting",
  headerSmall: "uzm-header-small",
  headerMedium: "uzm-header-medium",
  hideOpenDocuments: "uzm-hide-open-documents",
} as const;

// ─── Plugin ───────────────────────────────────────────────────────────────

export default class UltraZenModePlugin extends Plugin {
  settings!: UltraZenModeSettings;

  private isZenActive = false;
  private floatingBtn: HTMLElement | null = null;
  private previousMode: "source" | "preview" | null = null;
  /** Saved value of Obsidian's swipeToOpenDrawers config, restored on exit. */
  private savedSwipeDrawers: boolean | null = null;
  /** Sidebar collapsed states before zen mode, restored on exit. */
  private savedLeftCollapsed: boolean | null = null;
  private savedRightCollapsed: boolean | null = null;
  /** MutationObservers watching drawer elements so they can be collapsed the moment Obsidian opens them. */
  private drawerObservers: MutationObserver[] = [];
  /** True when we requested full screen on activation, so we only exit the full screen we ourselves entered. */
  private enteredFullScreen = false;
  /** Theme active before zen mode, restored on exit. */
  private savedTheme: string | null = null;
  /** Obsidian's readableLineLength config value before zen mode, restored on exit. */
  private savedReadableLineLength: boolean | null = null;

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

    // ── Zen theme ─────────────────────────────────────────────────────────
    if (this.settings.zenTheme !== "") {
      const customCss = (
        this.app as unknown as Record<string, Record<string, unknown>>
      )["customCss"];
      this.savedTheme = (customCss?.["theme"] as string) ?? "";
      try {
        await (
          customCss?.["setTheme"] as
            | ((name: string) => Promise<void>)
            | undefined
        )?.(this.settings.zenTheme);
      } catch {
        this.savedTheme = null;
      }
    }

    // ── Readable line length ──────────────────────────────────────────────
    const vaultCfg = this.app.vault as unknown as Record<
      string,
      (k: string, v?: unknown) => unknown
    >;
    this.savedReadableLineLength =
      (vaultCfg["getConfig"]?.("readableLineLength") as boolean | undefined) ??
      null;
    vaultCfg["setConfig"]?.(
      "readableLineLength",
      this.settings.limitLineLength,
    );
    if (this.settings.limitLineLength) {
      document.body.classList.add("is-readable-line-width");
    } else {
      document.body.classList.remove("is-readable-line-width");
    }

    this.isZenActive = true;
    if (this.settings.hideSidebars) {
      this.savedLeftCollapsed = this.app.workspace.leftSplit.collapsed;
      this.savedRightCollapsed = this.app.workspace.rightSplit.collapsed;
      this.app.workspace.leftSplit.collapse();
      this.app.workspace.rightSplit.collapse();
    }
    this.applyBodyClasses();
    this.mountFloatingButton();
    this.startWatchingDrawers();
    // Request full screen while still inside the toggle's user gesture.
    if (this.settings.fullScreenOnActivate) this.enterFullScreen();
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

    // ── Restore zen theme ─────────────────────────────────────────────────
    if (this.savedTheme !== null) {
      const customCss = (
        this.app as unknown as Record<string, Record<string, unknown>>
      )["customCss"];
      try {
        await (
          customCss?.["setTheme"] as
            | ((name: string) => Promise<void>)
            | undefined
        )?.(this.savedTheme);
      } catch {}
      this.savedTheme = null;
    }

    // ── Restore readable line length ──────────────────────────────────────
    if (this.savedReadableLineLength !== null) {
      const vaultCfg = this.app.vault as unknown as Record<
        string,
        (k: string, v?: unknown) => unknown
      >;
      vaultCfg["setConfig"]?.(
        "readableLineLength",
        this.savedReadableLineLength,
      );
      if (this.savedReadableLineLength) {
        document.body.classList.add("is-readable-line-width");
      } else {
        document.body.classList.remove("is-readable-line-width");
      }
      this.savedReadableLineLength = null;
    }

    this.stopWatchingDrawers();
    this.exitFullScreen();
    if (this.settings.hideSidebars) {
      this.app.workspace.leftSplit.collapse();
      this.app.workspace.rightSplit.collapse();
    }
    this.isZenActive = false;
    this.removeBodyClasses();
    this.unmountFloatingButton();
    if (this.savedLeftCollapsed === false)
      this.app.workspace.leftSplit.toggle();
    if (this.savedRightCollapsed === false)
      this.app.workspace.rightSplit.toggle();
    this.savedLeftCollapsed = null;
    this.savedRightCollapsed = null;
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

  // ─── Full screen helpers ────────────────────────────────────────────────

  private enterFullScreen(): void {
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    this.enteredFullScreen = true;
    el.requestFullscreen().catch(() => {
      this.enteredFullScreen = false;
    });
  }

  private exitFullScreen(): void {
    if (this.enteredFullScreen && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    this.enteredFullScreen = false;
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
    if (this.settings.hideBaseToolbar) classList.add(CLS.hideBaseToolbar);
    if (this.settings.hideViewHeader) classList.add(CLS.hideViewHeader);
    if (this.settings.hidePdfToolbar) classList.add(CLS.hidePdfToolbar);
    if (this.settings.lockNote) classList.add(CLS.lockNote);
    if (this.settings.hideOpenDocuments) classList.add(CLS.hideOpenDocuments);
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

  // ─── Obsidian 1.13.0+: declarative settings API ──────────────────────
  // On 1.13.0+, Obsidian calls this method and skips display().
  // Controls with `control` bindings are read, saved, and search-indexed
  // automatically. The zen-theme entry uses a `render` callback because
  // its dropdown options are dynamic (populated from installed themes at
  // render time); Obsidian cannot infer them statically.
  getSettingDefinitions() {
    const customCss = (
      this.app as unknown as Record<string, Record<string, unknown>>
    )["customCss"];
    const installedThemes = Object.keys(
      (customCss?.["themes"] as Record<string, unknown>) ?? {},
    );

    return [
      {
        name: "Zen theme",
        desc: "Theme to switch to when entering zen mode. \u201cDefault (current theme)\u201d keeps whatever is currently active.",
        render: (setting: Setting) => {
          setting.addDropdown((dd) => {
            dd.addOption("", "Default (current theme)");
            for (const name of installedThemes) dd.addOption(name, name);
            dd.setValue(this.plugin.settings.zenTheme).onChange(
              async (value) => {
                this.plugin.settings.zenTheme = value;
                await this.plugin.saveSettings();
              },
            );
          });
        },
      },
      {
        name: "Hide sidebars and command palette",
        desc: "Hides both sidebars, the ribbon, and blocks swipe gestures that open them or the command palette.",
        control: { type: "toggle", key: "hideSidebars" },
      },
      {
        name: "Hide note properties",
        desc: "Hides the YAML frontmatter / properties block.",
        control: { type: "toggle", key: "hideProperties" },
      },
      {
        name: "Hide note title",
        desc: "Hides the inline note title at the top of the editor.",
        control: { type: "toggle", key: "hideNoteTitle" },
      },
      {
        name: "Hide status bar",
        desc: "Hides the bottom status bar.",
        control: { type: "toggle", key: "hideStatusBar" },
      },
      {
        name: "Hide tab bar",
        desc: "Hides the editor tab bar.",
        control: { type: "toggle", key: "hideTabBar" },
      },
      {
        name: "Hide other open documents",
        desc: "Hides all inactive panes/splits so only the focused document is visible in zen mode.",
        control: { type: "toggle", key: "hideOpenDocuments" },
      },
      {
        name: "Hide Bases toolbar",
        desc: "Hides the toolbar at the top of a .base file view (view name, sorting, filters, etc.).",
        control: { type: "toggle", key: "hideBaseToolbar" },
      },
      {
        name: "Hide header bar",
        desc: "Hides the view header bar \u2014 the note title and the back/forward navigation buttons shown on desktop.",
        control: { type: "toggle", key: "hideViewHeader" },
      },
      {
        name: "Hide PDF toolbar",
        desc: "Hides the top toolbar (zoom, page navigation, etc.) shown when reading a PDF.",
        control: { type: "toggle", key: "hidePdfToolbar" },
      },
      {
        name: "Switch to reading mode",
        desc: "Automatically enters reading view on activation and restores the previous mode on exit.",
        control: { type: "toggle", key: "switchToReadingMode" },
      },
      {
        name: "Lock note (prevent editing)",
        desc: "Blocks double-click and other gestures that would switch the note into edit mode while zen mode is active.",
        control: { type: "toggle", key: "lockNote" },
      },
      {
        name: "Exit zen mode on note close",
        desc: "Automatically exits zen mode when the active note is closed or navigated away from.",
        control: { type: "toggle", key: "exitOnNoteClose" },
      },
      {
        name: "Full screen on activation",
        desc: "Automatically enters full screen when zen mode is activated, and leaves it on exit.",
        control: { type: "toggle", key: "fullScreenOnActivate" },
      },
      {
        name: "Limit line length",
        desc: "Enforces readable line length in zen mode when on, or stretches text to full editor width when off.",
        control: { type: "toggle", key: "limitLineLength" },
      },
      {
        name: "Header bar padding",
        desc: "Height of the top bar left behind after action buttons are hidden.",
        control: {
          type: "dropdown",
          key: "headerPadding",
          defaultValue: "medium",
          options: { small: "Small", medium: "Medium", original: "Original" },
        },
      },
    ];
  }

  // ─── Obsidian < 1.13.0: imperative fallback ───────────────────────────
  // Kept in sync with getSettingDefinitions(). When the user base on older
  // Obsidian versions is small enough, delete this method and bump
  // minAppVersion to "1.13.0".
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const save = async (key: BooleanSettingKey, value: boolean) => {
      this.plugin.settings[key] = value;
      await this.plugin.saveSettings();
    };

    // ── Zen theme ──────────────────────────────────────────────────────
    const customCss = (
      this.app as unknown as Record<string, Record<string, unknown>>
    )["customCss"];
    const installedThemes = Object.keys(
      (customCss?.["themes"] as Record<string, unknown>) ?? {},
    );
    new Setting(containerEl)
      .setName("Zen theme")
      .setDesc(
        "Theme to switch to when entering zen mode. \u201cDefault (current theme)\u201d keeps whatever is currently active.",
      )
      .addDropdown((dd) => {
        dd.addOption("", "Default (current theme)");
        for (const name of installedThemes) dd.addOption(name, name);
        dd.setValue(this.plugin.settings.zenTheme).onChange(async (value) => {
          this.plugin.settings.zenTheme = value;
          await this.plugin.saveSettings();
        });
      });

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
      "Hide other open documents",
      "Hides all inactive panes/splits so only the focused document is visible in zen mode.",
      "hideOpenDocuments",
      save,
    );

    this.addToggle(
      containerEl,
      "Hide Bases toolbar",
      "Hides the toolbar at the top of a .base file view (view name, sorting, filters, etc.).",
      "hideBaseToolbar",
      save,
    );

    this.addToggle(
      containerEl,
      "Hide header bar",
      "Hides the view header bar — the note title and the back/forward navigation buttons shown on desktop.",
      "hideViewHeader",
      save,
    );

    this.addToggle(
      containerEl,
      "Hide PDF toolbar",
      "Hides the top toolbar (zoom, page navigation, etc.) shown when reading a PDF.",
      "hidePdfToolbar",
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

    this.addToggle(
      containerEl,
      "Full screen on activation",
      "Automatically enters full screen when zen mode is activated, and leaves it on exit.",
      "fullScreenOnActivate",
      save,
    );

    this.addToggle(
      containerEl,
      "Limit line length",
      "Enforces readable line length in zen mode when on, or stretches text to full editor width when off.",
      "limitLineLength",
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
