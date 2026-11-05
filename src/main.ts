import {
  App,
  MarkdownView,
  Plugin,
  PluginSettingTab,
  Setting,
  setIcon,
  type SettingDefinition,
  type SettingDefinitionItem,
} from "obsidian";

// ─── Settings ──────────────────────────────────────────────────────────────

type HeaderPadding = "small" | "medium" | "original";

interface UltraZenModeSettings {
  // Appearance
  zenTheme: string;
  limitLineLength: boolean;
  /** Maximum line length in characters. 0 = the theme's width. */
  lineWidth: number;
  /** Text size in px. 0 = unchanged. */
  fontSize: number;
  headerPadding: HeaderPadding;
  // Focus
  fadeInactiveLines: boolean;
  /** Opacity of faded lines, in percent. */
  fadedLineOpacity: number;
  vignette: boolean;
  /** How far the dark edges reach in from each side, in % of window width. */
  vignetteWidth: number;
  /** Darkness of the edges, in percent. */
  vignetteOpacity: number;
  // Hide
  hideSidebars: boolean;
  hideProperties: boolean;
  hideNoteTitle: boolean;
  hideStatusBar: boolean;
  hideTabBar: boolean;
  hideOpenDocuments: boolean;
  hideBaseToolbar: boolean;
  hideViewHeader: boolean;
  hidePdfToolbar: boolean;
  // Behaviour
  switchToReadingMode: boolean;
  lockNote: boolean;
  exitOnNoteClose: boolean;
  fullScreenOnActivate: boolean;
}

const DEFAULT_SETTINGS: UltraZenModeSettings = {
  zenTheme: "",
  limitLineLength: true,
  lineWidth: 0,
  fontSize: 0,
  headerPadding: "medium",
  fadeInactiveLines: false,
  fadedLineOpacity: 30,
  vignette: false,
  vignetteWidth: 20,
  vignetteOpacity: 85,
  hideSidebars: true,
  hideProperties: true,
  hideNoteTitle: false,
  hideStatusBar: true,
  hideTabBar: true,
  hideOpenDocuments: false,
  hideBaseToolbar: true,
  hideViewHeader: true,
  hidePdfToolbar: true,
  switchToReadingMode: true,
  lockNote: true,
  exitOnNoteClose: true,
  fullScreenOnActivate: false,
};

type KeysOfType<T, V> = {
  [K in keyof T]: T[K] extends V ? K : never;
}[keyof T];
type BooleanSettingKey = KeysOfType<UltraZenModeSettings, boolean>;
type NumberSettingKey = KeysOfType<UltraZenModeSettings, number>;

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
  customLineWidth: "uzm-custom-line-width",
  customFontSize: "uzm-custom-font-size",
  fadeLines: "uzm-fade-lines",
  vignette: "uzm-show-vignette",
} as const;

/** CSS variables set on <body> while zen mode is active. */
const CSS_VARS = [
  "--uzm-line-width",
  "--uzm-font-size",
  "--uzm-faded-line-opacity",
  "--uzm-vignette-width",
  "--uzm-vignette-opacity",
] as const;

// ─── Undocumented Obsidian APIs ───────────────────────────────────────────
// Obsidian has no public API for app config or themes. All access to those
// internals goes through this wrapper, so a change in Obsidian only needs a
// fix here. Every call is optional-chained: if an internal disappears, the
// feature silently does nothing instead of throwing.

interface AppInternals {
  customCss?: {
    theme?: string;
    themes?: Record<string, unknown>;
    setTheme?: (name: string) => void | Promise<void>;
  };
  vault: {
    getConfig?: (key: string) => unknown;
    setConfig?: (key: string, value: unknown) => void;
  };
  // Public since 1.8.7; optional so older versions fall back to localStorage.
  loadLocalStorage?: (key: string) => unknown;
  saveLocalStorage?: (key: string, data: unknown) => void;
}

class ObsidianInternals {
  constructor(private readonly app: App) {}

  private get raw(): AppInternals {
    return this.app as unknown as AppInternals;
  }

  getConfig<T>(key: string): T | undefined {
    return this.raw.vault.getConfig?.(key) as T | undefined;
  }

  setConfig(key: string, value: unknown): void {
    this.raw.vault.setConfig?.(key, value);
  }

  get theme(): string | undefined {
    return this.raw.customCss?.theme;
  }

  get installedThemes(): string[] {
    return Object.keys(this.raw.customCss?.themes ?? {});
  }

  async setTheme(name: string): Promise<void> {
    try {
      await this.raw.customCss?.setTheme?.(name);
    } catch {
      // Theme missing or failed to load: keep the current one.
    }
  }

  /** Vault-specific, device-local storage (never synced). */
  loadLocal<T>(key: string): T | null {
    if (this.raw.loadLocalStorage)
      return (this.raw.loadLocalStorage(key) as T | null) ?? null;
    const value = window.localStorage.getItem(this.localKey(key));
    return value === null ? null : (JSON.parse(value) as T);
  }

  saveLocal(key: string, data: unknown): void {
    if (this.raw.saveLocalStorage) {
      this.raw.saveLocalStorage(key, data);
      return;
    }
    if (data === null) window.localStorage.removeItem(this.localKey(key));
    else window.localStorage.setItem(this.localKey(key), JSON.stringify(data));
  }

  private localKey(key: string): string {
    return `${this.app.vault.getName()}-${key}`;
  }
}

// ─── Restore state ────────────────────────────────────────────────────────

/**
 * The user's own values of the app settings that zen mode changes. They are
 * saved before anything is changed and removed when zen mode exits. If
 * Obsidian quits while zen mode is on, they are put back on the next start.
 *
 * Kept in device-local storage, not data.json: Obsidian Sync must not carry
 * one device's pending restore to another device.
 */
interface RestoreState {
  theme?: string;
  readableLineLength?: boolean;
  swipeToOpenDrawers?: boolean;
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
}

const RESTORE_KEY = "ultra-zen-mode-restore";

// ─── Plugin ───────────────────────────────────────────────────────────────

export default class UltraZenModePlugin extends Plugin {
  settings!: UltraZenModeSettings;
  internals!: ObsidianInternals;

  private isZenActive = false;
  private restore: RestoreState = {};
  private floatingBtn: HTMLElement | null = null;
  private vignetteEl: HTMLElement | null = null;
  private previousMode: "source" | "preview" | null = null;
  /** MutationObservers watching drawer elements so they can be collapsed the moment Obsidian opens them. */
  private drawerObservers: MutationObserver[] = [];
  /** True when we requested full screen on activation, so we only exit the full screen we ourselves entered. */
  private enteredFullScreen = false;

  /**
   * Lock note only makes sense on top of reading mode. Without it the note
   * stays in the editor, and the lock's CSS (which hides the source view)
   * would render the text invisible.
   */
  private get lockActive(): boolean {
    return this.settings.lockNote && this.settings.switchToReadingMode;
  }

  async onload(): Promise<void> {
    this.internals = new ObsidianInternals(this.app);
    await this.loadSettings();
    this.restore = this.internals.loadLocal<RestoreState>(RESTORE_KEY) ?? {};

    // Obsidian quit while zen mode was on: put the user's own settings back.
    this.app.workspace.onLayoutReady(() => {
      if (!this.isZenActive && Object.keys(this.restore).length > 0)
        void this.restoreAppState();
    });

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
      activeDocument,
      "dblclick",
      (e: MouseEvent) => {
        if (!this.isZenActive || !this.lockActive) return;
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
        if (!this.isZenActive || !this.lockActive) return;
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
        this.collapseSidebars();
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
        if (!this.isZenActive || !this.lockActive) return;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view && view.getMode() !== "preview") {
          activeDocument.body.classList.add(CLS.reverting);
          const state = view.getState();
          void view
            .setState({ ...state, mode: "preview" }, { history: false })
            .then(() => {
              window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                  activeDocument.body.classList.remove(CLS.reverting);
                });
              });
            });
        }
      }),
    );
  }

  onunload(): void {
    // Always clean up when the plugin is disabled. If this does not finish
    // (app quitting), the restore state brings everything back next start.
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
    if (this.isZenActive) return;
    // Request full screen first, while still inside the user gesture that
    // triggered the toggle. Any await before this can make Chromium refuse it.
    if (this.settings.fullScreenOnActivate) this.enterFullScreen();
    this.isZenActive = true;
    this.mountOverlays();
    await this.applyLiveSettings();
    if (this.settings.switchToReadingMode) {
      await this.switchToReadingMode();
    }
  }

  private async exitZenMode(): Promise<void> {
    if (!this.isZenActive) return;
    // Cleared first so the layout-change handlers don't fight the restore.
    this.isZenActive = false;
    this.exitFullScreen();
    this.removeBodyClasses();
    this.clearCssVariables();
    this.unmountOverlays();
    await this.restoreAppState();
    await this.restorePreviousMode();
  }

  // ─── Applying settings ──────────────────────────────────────────────────
  // Everything here is idempotent: it runs on entry and again whenever a
  // setting changes while zen mode is active, so changes show immediately.

  private async applyLiveSettings(): Promise<void> {
    if (!this.isZenActive) return;
    this.rememberOriginals();
    this.applySidebars();
    await this.applyTheme();
    this.setReadableLineLength(this.settings.limitLineLength);
    this.applyBodyClasses();
    this.applyCssVariables();
  }

  /** Save the user's own values before zen mode changes them. */
  private rememberOriginals(): void {
    const before = JSON.stringify(this.restore);
    const r = this.restore;
    const { leftSplit, rightSplit } = this.app.workspace;
    if (this.settings.hideSidebars) {
      r.swipeToOpenDrawers ??=
        this.internals.getConfig<boolean>("swipeToOpenDrawers");
      r.leftCollapsed ??= leftSplit.collapsed;
      r.rightCollapsed ??= rightSplit.collapsed;
    }
    if (this.settings.zenTheme !== "") r.theme ??= this.internals.theme;
    r.readableLineLength ??=
      this.internals.getConfig<boolean>("readableLineLength");
    // Drop keys whose original value could not be read.
    for (const key of Object.keys(r) as (keyof RestoreState)[])
      if (r[key] === undefined) delete r[key];
    if (JSON.stringify(r) !== before) this.saveRestoreState();
  }

  private applySidebars(): void {
    if (this.settings.hideSidebars) {
      this.internals.setConfig("swipeToOpenDrawers", false);
      activeDocument.body.setAttribute("data-ignore-swipe", "true");
      this.collapseSidebars();
      this.startWatchingDrawers();
    } else {
      // Turned off while zen mode is active: give the sidebars back now.
      this.releaseSidebars();
    }
  }

  private collapseSidebars(): void {
    const { leftSplit, rightSplit } = this.app.workspace;
    if (!leftSplit.collapsed) leftSplit.collapse();
    if (!rightSplit.collapsed) rightSplit.collapse();
  }

  /** Undo applySidebars(): swipe gestures, drawer watchers, sidebar state. */
  private releaseSidebars(): void {
    this.stopWatchingDrawers();
    activeDocument.body.removeAttribute("data-ignore-swipe");
    const r = this.restore;
    const { leftSplit, rightSplit } = this.app.workspace;
    if (r.swipeToOpenDrawers !== undefined)
      this.internals.setConfig("swipeToOpenDrawers", r.swipeToOpenDrawers);
    if (r.leftCollapsed === false) leftSplit.expand();
    if (r.rightCollapsed === false) rightSplit.expand();
    delete r.swipeToOpenDrawers;
    delete r.leftCollapsed;
    delete r.rightCollapsed;
  }

  private async applyTheme(): Promise<void> {
    const { zenTheme } = this.settings;
    if (zenTheme !== "") {
      if (this.internals.theme !== zenTheme)
        await this.internals.setTheme(zenTheme);
    } else if (this.restore.theme !== undefined) {
      // Zen theme cleared while zen mode is active: back to the user's theme.
      await this.internals.setTheme(this.restore.theme);
      delete this.restore.theme;
    }
  }

  private setReadableLineLength(on: boolean): void {
    this.internals.setConfig("readableLineLength", on);
    activeDocument.body.toggleClass("is-readable-line-width", on);
    this.app.workspace.updateOptions();
  }

  /** Put back everything recorded in the restore state, then clear it. */
  private async restoreAppState(): Promise<void> {
    this.releaseSidebars();
    const { theme, readableLineLength } = this.restore;
    if (theme !== undefined) await this.internals.setTheme(theme);
    if (readableLineLength !== undefined)
      this.setReadableLineLength(readableLineLength);
    this.restore = {};
    this.saveRestoreState();
  }

  private saveRestoreState(): void {
    const empty = Object.keys(this.restore).length === 0;
    this.internals.saveLocal(RESTORE_KEY, empty ? null : this.restore);
  }

  // ─── Drawer watcher ────────────────────────────────────────────────────

  private startWatchingDrawers(): void {
    if (this.drawerObservers.length > 0) return;
    const watch = (
      sel: string,
      getSplit: () => { collapsed: boolean; collapse(): void },
    ) => {
      const el = activeDocument.querySelector(sel);
      if (!el) return;
      const obs = new MutationObserver(() => {
        if (
          this.isZenActive &&
          this.settings.hideSidebars &&
          !getSplit().collapsed
        )
          getSplit().collapse();
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
    const el = activeDocument.documentElement;
    if (activeDocument.fullscreenElement || !el.requestFullscreen) return;
    this.enteredFullScreen = true;
    el.requestFullscreen().catch(() => {
      this.enteredFullScreen = false;
    });
  }

  private exitFullScreen(): void {
    if (this.enteredFullScreen && activeDocument.fullscreenElement) {
      void activeDocument.exitFullscreen().catch(() => {});
    }
    this.enteredFullScreen = false;
  }

  // ─── Reading mode helpers ───────────────────────────────────────────────

  private async switchToReadingMode(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.getMode() === "preview") return;
    this.previousMode ??= view.getMode();
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

  // ─── Body class and CSS variable helpers ────────────────────────────────

  private applyBodyClasses(): void {
    const s = this.settings;
    const { classList } = activeDocument.body;
    // Reset first so options turned off while zen mode is active go away.
    classList.remove(...Object.values(CLS));
    classList.add(CLS.active);
    if (s.hideSidebars) classList.add(CLS.hideSidebars);
    if (s.hideProperties) classList.add(CLS.hideProperties);
    if (s.hideNoteTitle) classList.add(CLS.hideNoteTitle);
    if (s.hideStatusBar) classList.add(CLS.hideStatusBar);
    if (s.hideTabBar) classList.add(CLS.hideTabBar);
    if (s.hideBaseToolbar) classList.add(CLS.hideBaseToolbar);
    if (s.hideViewHeader) classList.add(CLS.hideViewHeader);
    if (s.hidePdfToolbar) classList.add(CLS.hidePdfToolbar);
    if (this.lockActive) classList.add(CLS.lockNote);
    if (s.hideOpenDocuments) classList.add(CLS.hideOpenDocuments);
    if (s.limitLineLength && s.lineWidth > 0)
      classList.add(CLS.customLineWidth);
    if (s.fontSize > 0) classList.add(CLS.customFontSize);
    if (s.fadeInactiveLines) classList.add(CLS.fadeLines);
    if (s.vignette) classList.add(CLS.vignette);
    if (s.headerPadding === "small") classList.add(CLS.headerSmall);
    else if (s.headerPadding === "medium") classList.add(CLS.headerMedium);
    // "original" → no class; Obsidian's default padding is preserved
  }

  private removeBodyClasses(): void {
    activeDocument.body.classList.remove(...Object.values(CLS));
  }

  private applyCssVariables(): void {
    const s = this.settings;
    activeDocument.body.setCssProps({
      "--uzm-line-width": `${s.lineWidth}ch`,
      "--uzm-font-size": `${s.fontSize}px`,
      "--uzm-faded-line-opacity": `${s.fadedLineOpacity / 100}`,
      "--uzm-vignette-width": `${s.vignetteWidth}vw`,
      "--uzm-vignette-opacity": `${s.vignetteOpacity / 100}`,
    });
  }

  private clearCssVariables(): void {
    for (const name of CSS_VARS) activeDocument.body.style.removeProperty(name);
  }

  // ─── Overlays: screen-edge vignette and floating exit button ───────────

  private mountOverlays(): void {
    const { body } = activeDocument;
    // Shown only while the vignette class is on <body>, see styles.css.
    this.vignetteEl ??= body.createDiv({ cls: "uzm-vignette" });

    if (this.floatingBtn) return;
    const btn = body.createEl("button", {
      cls: "uzm-exit-btn",
      attr: { "aria-label": "Exit Zen Mode", title: "Exit Zen Mode" },
    });
    setIcon(btn, "eye-off");
    // Plain listener: it goes away with the button when zen mode exits.
    btn.addEventListener("click", () => void this.exitZenMode());
    this.floatingBtn = btn;
  }

  private unmountOverlays(): void {
    this.vignetteEl?.remove();
    this.vignetteEl = null;
    this.floatingBtn?.remove();
    this.floatingBtn = null;
  }

  // ─── Data persistence ───────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<UltraZenModeSettings> | null,
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    if (!this.isZenActive) return;
    await this.applyLiveSettings();
    // If reading mode was just turned on, the lock's CSS now hides the
    // editor, so move the note into reading mode to keep it visible.
    if (this.lockActive) await this.switchToReadingMode();
  }

  /** data.json changed on disk, e.g. synced from another device. */
  async onExternalSettingsChange(): Promise<void> {
    await this.loadSettings();
    await this.applyLiveSettings();
  }
}

// ─── Settings Tab ─────────────────────────────────────────────────────────

/**
 * One description of every setting. Rendered declaratively on Obsidian
 * 1.13.0+ (getSettingDefinitions) and imperatively on older versions
 * (display), so both stay in sync.
 */
interface SpecBase {
  name: string;
  desc: string;
  visible?: () => boolean;
}
type SettingSpec = SpecBase &
  (
    | { type: "toggle"; key: BooleanSettingKey; disabled?: () => boolean }
    | {
        type: "slider";
        key: NumberSettingKey;
        min: number;
        max: number;
        step: number;
        format: (value: number) => string;
      }
    | {
        type: "dropdown";
        key: "headerPadding";
        options: Record<HeaderPadding, string>;
      }
    | { type: "theme" }
  );

interface SettingSection {
  heading: string;
  items: SettingSpec[];
}

class UltraZenModeSettingTab extends PluginSettingTab {
  readonly plugin: UltraZenModePlugin;

  constructor(app: App, plugin: UltraZenModePlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.icon = "glasses";
  }

  private sections(): SettingSection[] {
    const s = () => this.plugin.settings;
    return [
      {
        heading: "Appearance",
        items: [
          {
            type: "theme",
            name: "Zen theme",
            desc: "Theme to switch to when entering zen mode. “Default (current theme)” keeps whatever is currently active.",
          },
          {
            type: "toggle",
            key: "limitLineLength",
            name: "Limit line length",
            desc: "Keeps lines at a readable width in zen mode. When off, text stretches to the full width of the window.",
          },
          {
            type: "slider",
            key: "lineWidth",
            name: "Line width",
            desc: "Maximum line length in characters. Set to 0 to use your theme's width.",
            min: 0,
            max: 160,
            step: 5,
            format: (v) => (v === 0 ? "Theme default" : `${v} characters`),
            visible: () => s().limitLineLength,
          },
          {
            type: "slider",
            key: "fontSize",
            name: "Font size",
            desc: "Text size in zen mode only. Set to 0 to keep your normal size.",
            min: 0,
            max: 40,
            step: 1,
            format: (v) => (v === 0 ? "Unchanged" : `${v} px`),
          },
          {
            type: "dropdown",
            key: "headerPadding",
            name: "Header bar padding",
            desc: "Height of the top bar left behind after action buttons are hidden.",
            options: { small: "Small", medium: "Medium", original: "Original" },
          },
        ],
      },
      {
        heading: "Focus",
        items: [
          {
            type: "toggle",
            key: "fadeInactiveLines",
            name: "Fade other lines",
            desc: "While you type, dims every line except the one with the cursor. Works in Live Preview and Source mode.",
          },
          {
            type: "slider",
            key: "fadedLineOpacity",
            name: "Faded line opacity",
            desc: "How visible the dimmed lines stay.",
            min: 5,
            max: 90,
            step: 5,
            format: (v) => `${v}%`,
            visible: () => s().fadeInactiveLines,
          },
          {
            type: "toggle",
            key: "vignette",
            name: "Darken screen edges",
            desc: "Darkens the left and right edges of the window to frame the text. Useful on wide screens.",
          },
          {
            type: "slider",
            key: "vignetteWidth",
            name: "Edge width",
            desc: "How far the dark edges reach in from each side, as a share of the window width.",
            min: 5,
            max: 45,
            step: 1,
            format: (v) => `${v}%`,
            visible: () => s().vignette,
          },
          {
            type: "slider",
            key: "vignetteOpacity",
            name: "Edge darkness",
            desc: "100% is solid black.",
            min: 10,
            max: 100,
            step: 5,
            format: (v) => `${v}%`,
            visible: () => s().vignette,
          },
        ],
      },
      {
        heading: "Hide",
        items: [
          {
            type: "toggle",
            key: "hideSidebars",
            name: "Hide sidebars and command palette",
            desc: "Hides both sidebars, the ribbon, and blocks swipe gestures that open them or the command palette.",
          },
          {
            type: "toggle",
            key: "hideProperties",
            name: "Hide note properties",
            desc: "Hides the YAML frontmatter / properties block.",
          },
          {
            type: "toggle",
            key: "hideNoteTitle",
            name: "Hide note title",
            desc: "Hides the inline note title at the top of the editor.",
          },
          {
            type: "toggle",
            key: "hideStatusBar",
            name: "Hide status bar",
            desc: "Hides the bottom status bar.",
          },
          {
            type: "toggle",
            key: "hideTabBar",
            name: "Hide tab bar",
            desc: "Hides the editor tab bar.",
          },
          {
            type: "toggle",
            key: "hideOpenDocuments",
            name: "Hide other open documents",
            desc: "Hides all other panes and splits so only the focused document is visible in zen mode.",
          },
          {
            type: "toggle",
            key: "hideBaseToolbar",
            name: "Hide Bases toolbar",
            desc: "Hides the toolbar at the top of a .base file view (view name, sorting, filters, etc.).",
          },
          {
            type: "toggle",
            key: "hideViewHeader",
            name: "Hide header bar",
            desc: "Hides the view header bar — the note title and the back/forward navigation buttons shown on desktop.",
          },
          {
            type: "toggle",
            key: "hidePdfToolbar",
            name: "Hide PDF toolbar",
            desc: "Hides the top toolbar (zoom, page navigation, etc.) shown when reading a PDF.",
          },
        ],
      },
      {
        heading: "Behaviour",
        items: [
          {
            type: "toggle",
            key: "switchToReadingMode",
            name: "Switch to reading mode",
            desc: "Automatically enters reading view on activation and restores the previous mode on exit.",
          },
          {
            type: "toggle",
            key: "lockNote",
            name: "Lock note (prevent editing)",
            desc: "Blocks double-click and other gestures that would switch the note into edit mode while zen mode is active. Only applies when “Switch to reading mode” is on.",
            disabled: () => !s().switchToReadingMode,
          },
          {
            type: "toggle",
            key: "exitOnNoteClose",
            name: "Exit zen mode on note close",
            desc: "Automatically exits zen mode when the active note is closed or navigated away from.",
          },
          {
            type: "toggle",
            key: "fullScreenOnActivate",
            name: "Full screen on activation",
            desc: "Automatically enters full screen when zen mode is activated, and leaves it on exit.",
          },
        ],
      },
    ];
  }

  // ─── Obsidian 1.13.0+: declarative settings API ──────────────────────
  // On 1.13.0+, Obsidian calls this method and skips display(). Controls
  // are read from plugin.settings and written through setControlValue().

  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.sections().map((section) => ({
      type: "group",
      heading: section.heading,
      items: section.items.map((spec) => this.toDefinition(spec)),
    }));
  }

  private toDefinition(spec: SettingSpec): SettingDefinition {
    const base = { name: spec.name, desc: spec.desc, visible: spec.visible };
    switch (spec.type) {
      case "toggle":
        return {
          ...base,
          control: { type: "toggle", key: spec.key, disabled: spec.disabled },
        };
      case "slider":
        return {
          ...base,
          control: {
            type: "slider",
            key: spec.key,
            min: spec.min,
            max: spec.max,
            step: spec.step,
            displayFormat: spec.format,
          },
        };
      case "dropdown":
        return {
          ...base,
          control: { type: "dropdown", key: spec.key, options: spec.options },
        };
      case "theme":
        // Rendered by hand: the options are the themes installed right now.
        return { ...base, render: (setting) => this.addThemeDropdown(setting) };
    }
  }

  /**
   * The default implementation saves plugin.settings itself. Go through the
   * plugin instead, so changes apply live while zen mode is active.
   */
  async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings();
    // Re-evaluate visible/disabled predicates that depend on this value.
    this.refreshDomState();
  }

  private addThemeDropdown(setting: Setting): void {
    setting.addDropdown((dd) => {
      dd.addOption("", "Default (current theme)");
      for (const name of this.plugin.internals.installedThemes)
        dd.addOption(name, name);
      dd.setValue(this.plugin.settings.zenTheme).onChange(async (value) => {
        this.plugin.settings.zenTheme = value;
        await this.plugin.saveSettings();
      });
    });
  }

  // ─── Obsidian < 1.13.0: imperative fallback ───────────────────────────
  // Rendered from the same sections(). When the user base on older Obsidian
  // versions is small enough, delete this method and bump minAppVersion to
  // "1.13.0".

  display(): void {
    const { containerEl } = this;
    const settings = this.plugin.settings;
    containerEl.empty();

    for (const section of this.sections()) {
      new Setting(containerEl).setName(section.heading).setHeading();
      for (const spec of section.items) {
        if (spec.visible && !spec.visible()) continue;
        const setting = new Setting(containerEl)
          .setName(spec.name)
          .setDesc(spec.desc);
        switch (spec.type) {
          case "toggle":
            setting.addToggle((toggle) =>
              toggle
                .setValue(settings[spec.key])
                .setDisabled(spec.disabled?.() ?? false)
                .onChange(async (value) => {
                  settings[spec.key] = value;
                  await this.plugin.saveSettings();
                  // Toggles control the visibility of other settings.
                  this.display();
                }),
            );
            break;
          case "slider": {
            const valueEl = setting.controlEl.createSpan({
              text: spec.format(settings[spec.key]),
            });
            setting.addSlider((slider) =>
              slider
                .setLimits(spec.min, spec.max, spec.step)
                .setValue(settings[spec.key])
                .onChange(async (value) => {
                  settings[spec.key] = value;
                  valueEl.setText(spec.format(value));
                  await this.plugin.saveSettings();
                }),
            );
            break;
          }
          case "dropdown":
            setting.addDropdown((dd) =>
              dd
                .addOptions(spec.options)
                .setValue(settings[spec.key])
                .onChange(async (value) => {
                  settings[spec.key] = value as HeaderPadding;
                  await this.plugin.saveSettings();
                }),
            );
            break;
          case "theme":
            this.addThemeDropdown(setting);
            break;
        }
      }
    }
  }
}
