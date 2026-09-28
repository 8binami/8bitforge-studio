/**
 * Themes.
 *
 * A theme is a stylesheet and, sometimes, a scanline overlay: applied on top
 * of the studio's own styles rather than replacing them, so a theme is a few
 * kilobytes of CSS instead of a second design system to maintain.
 *
 * Applying one injects a style element, removing one takes it back out, and
 * `default` means neither. The choice is a per-viewer preference, kept in
 * local storage: nothing here belongs to a project.
 */

import { bus as sharedBus } from '../core/event-bus.js';

export const THEME_EVENTS = Object.freeze({
    changed: 'theme:changed'
});

export const DEFAULT_THEME = 'default';

const STORAGE_KEY = '8bitforge-theme';

export class ThemeEngine {
    /**
     * @param {object} [options]
     * @param {import('../core/event-bus.js').EventBus} [options.bus]
     */
    constructor({ bus = sharedBus } = {}) {
        this._bus = bus;
        this._active = DEFAULT_THEME;
        this._styleEl = null;
        this._overlayEl = null;
    }

    /** Current active theme id */
    get current() {
        return this._active;
    }

    /**
     * Apply a theme by id. 'default' removes any active theme.
     * @param {string} themeId
     */
    apply(themeId) {
        // A theme never stacks on the one before it.
        this._cleanup();

        if (themeId === DEFAULT_THEME || !ThemeEngine.THEMES[themeId]) {
            this._active = DEFAULT_THEME;
            this._store(this._active);
            this._bus.emit(THEME_EVENTS.changed, this._active);
            return this._active;
        }

        const theme = ThemeEngine.THEMES[themeId];
        this._active = themeId;
        document.documentElement.dataset.forgeTheme = themeId;

        // Inject CSS
        if (theme.css) {
            this._styleEl = document.createElement('style');
            this._styleEl.id = 'forge-theme-style';
            this._styleEl.textContent = theme.css;
            document.head.appendChild(this._styleEl);
        }

        // Inject overlay
        if (theme.overlay) {
            this._overlayEl = document.createElement('div');
            this._overlayEl.id = 'forge-theme-overlay';
            this._overlayEl.style.cssText = theme.overlay;
            document.body.appendChild(this._overlayEl);
        }

        // DOM patches (logo swaps, etc.)
        if (theme.domPatch) theme.domPatch();

        this._store(themeId);
        this._bus.emit(THEME_EVENTS.changed, themeId);
        return themeId;
    }

    /** Apply the theme chosen last time, if there was one. */
    init() {
        return this.apply(this._restore() ?? DEFAULT_THEME);
    }

    /**
     * The choice is a per-viewer preference: a blocked storage costs the
     * preference, not the theme.
     */
    _store(themeId) {
        try {
            globalThis.localStorage?.setItem(STORAGE_KEY, themeId);
        } catch {
            // private window, blocked site data
        }
    }

    _restore() {
        try {
            return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
        } catch {
            return null;
        }
    }

    /** Remove current theme */
    _cleanup() {
        if (this._styleEl) {
            this._styleEl.remove();
            this._styleEl = null;
        }
        if (this._overlayEl) {
            this._overlayEl.remove();
            this._overlayEl = null;
        }
        // Restore patched DOM elements
        document.querySelectorAll('[data-theme-original-src]').forEach((el) => {
            el.src = el.dataset.themeOriginalSrc;
            delete el.dataset.themeOriginalSrc;
        });
        // Reset any inline filter/theme marker on html
        document.documentElement.style.filter = '';
        document.documentElement.style.backgroundColor = '';
        delete document.documentElement.dataset.forgeTheme;
    }

    /** Get list of available themes for UI */
    static getThemeList() {
        return Object.entries(ThemeEngine.THEMES).map(([id, t]) => ({
            id,
            name: t.name,
            description: t.description || ''
        }));
    }
}

// =========================================================
// Theme definitions
// =========================================================

ThemeEngine.THEMES = {
    // ─────────────────────────────────────────────────────
    // INVERSE: Full dark mode via CSS invert
    // ─────────────────────────────────────────────────────
    inverse: {
        name: 'Inverse',
        description: 'Full dark mode: colour inversion with hue correction',
        css: `
            html {
                filter: invert(1) hue-rotate(180deg) !important;
                background-color: #fff !important;
            }
            /* Re-invert media so they look normal */
            img, video, iframe, canvas {
                filter: invert(1) hue-rotate(180deg) !important;
            }
            body {
                text-rendering: optimizeLegibility;
                -webkit-font-smoothing: antialiased;
            }
            /* Suppress box-shadows, dark rgba() shadows invert to bright
               white halos. Override CSS variable defaults and hardcoded values. */
            :root {
                --ps-shadow-sm: none;
                --ps-shadow-md: none;
                --ps-shadow-lg: none;
            }

            .sidenav-menu > .logo { border-bottom: 1px solid #59a28c00 !important; }
            #audioVisualizer { border: 1px solid #131519 !important; }
            .card, .accordion-item, .accordion-button,
            .modal-content, .modal-dialog,
            .asidebar, .asidebar-header, .asidebar-body,
            .sidenav-menu,
            .app-topbar, .topbar-menu,
            .dropdown-menu,
            .sortable-card,
            .preset-browser-table-wrapper,
            .piano-roll-container,
            .btn, button {
                box-shadow: none !important;
            }
            :focus-visible {
                box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.25) !important;
            }
            .piano-key-white, .keyboard-key.white {
                box-shadow: none !important;
            }

            /* ── XY pads + automation lanes, keep dark surfaces in inverse mode ──
               The html-level filter turns their dark backgrounds white.
               We re-invert each container so it stays dark.
               Canvases inside are already re-inverted by the rule above,
               so we cancel that rule specifically inside these containers. */
            .synth-xy-pad,
            .mfx-xy-pad,
            .xy-pad,
            .adv-xy-pad,
            .fxa-lane-canvas-wrap {
                filter: invert(1) hue-rotate(180deg) !important;
            }
            .synth-xy-pad canvas,
            .mfx-xy-pad canvas,
            .xy-pad canvas,
            .adv-xy-pad canvas,
            .fxa-lane-canvas-wrap canvas {
                filter: none !important;
            }
        `,
        overlay: null
    },

    // ─────────────────────────────────────────────────────
    // WARM TAPE: Aged analog tape, vintage console
    // ─────────────────────────────────────────────────────
    warmtape: {
        name: 'Warm Tape',
        description: 'Aged analog tape: dark parchment, burnt sienna, vintage hardware feel',
        css: `
            html {
                filter: sepia(0.30) contrast(0.94) brightness(0.88) !important;
                background-color: #c9aa7c !important;
            }
            body { background-color: #c9aa7c !important; color: #0e0804 !important; }

            :root {
                --ps-canvas:        #c9aa7c;
                --ps-surface:       #c0a070;
                --ps-raised:        #b49060;
                --ps-overlay:       #a88050;
                --ps-border-subtle: rgba(70,35,5,0.12);
                --ps-border:        rgba(70,35,5,0.24);
                --ps-border-strong: rgba(70,35,5,0.45);
                --ps-text-900:      #0e0804;
                --ps-text-700:      #241408;
                --ps-text-500:      #5e3818;
                --ps-text-300:      #9a6e3e;
                --ps-accent:        #8a3a0e;
                --ps-accent-soft:   rgba(138,58,14,0.14);
                --ps-accent-strong: #6e2c08;
                --ps-shadow-sm: 0 1px 3px rgba(50,20,5,0.20), 0 2px 6px rgba(50,20,5,0.16);
                --ps-shadow-md: 0 2px 8px rgba(50,20,5,0.24), 0 6px 20px rgba(50,20,5,0.18);
                --ps-shadow-lg: 0 4px 16px rgba(50,20,5,0.28), 0 16px 48px rgba(50,20,5,0.22);
                --bs-body-bg:        #c9aa7c;
                --bs-body-color:     #0e0804;
                --bs-border-color:   rgba(70,35,5,0.24);
                --bs-secondary-bg:   #b49060;
                --bs-tertiary-bg:    #c0a070;
            }

            .app-topbar, .topbar-menu {
                background: #b49060 !important;
                border-bottom-color: rgba(70,35,5,0.30) !important;
            }
            .topbar-btn { color: #241408 !important; }
            .topbar-btn:hover { background: rgba(70,35,5,0.14) !important; }
            .sidenav-menu { background: #bda06a !important; border-right-color: rgba(70,35,5,0.24) !important; }
            .nav-link { color: #5e3818 !important; }
            .nav-link:hover, .nav-link.active { color: #0e0804 !important; }

            .card {
                background: #c0a070 !important;
                border-color: rgba(70,35,5,0.22) !important;
            }
            .card-header {
                background: #b49060 !important;
                border-bottom-color: rgba(70,35,5,0.18) !important;
                color: #0e0804 !important;
            }
            .card-title, h4.card-title { color: #0e0804 !important; }

            .asidebar, .asidebar-header, .asidebar-body {
                background: #bda06a !important;
                border-color: rgba(70,35,5,0.22) !important;
            }
            .asidebar .accordion-item { background: #c0a070 !important; border-color: rgba(70,35,5,0.18) !important; }
            .asidebar .accordion-button {
                background: #b49060 !important;
                color: #241408 !important;
                border-color: rgba(70,35,5,0.18) !important;
            }
            .asidebar .accordion-button:hover { background: #a88050 !important; color: #0e0804 !important; }
            .asidebar .accordion-button:not(.collapsed) { background: #a88050 !important; color: #8a3a0e !important; }

            .form-control, .form-select, select,
            input[type="text"], input[type="number"], input[type="search"], textarea {
                background: #b49060 !important;
                border-color: rgba(70,35,5,0.30) !important;
                color: #0e0804 !important;
            }
            .form-control::placeholder, input::placeholder { color: #9a6e3e !important; }

            .btn-outline-secondary {
                border-color: rgba(70,35,5,0.36) !important;
                color: #241408 !important;
            }
            .btn-outline-secondary:hover {
                background: rgba(70,35,5,0.14) !important;
                color: #0e0804 !important;
            }
            .btn-outline-secondary.active {
                background: #8a3a0e !important;
                border-color: #8a3a0e !important;
                color: #f5e8d0 !important;
            }
            .btn-light {
                background: #b49060 !important;
                border-color: rgba(70,35,5,0.30) !important;
                color: #241408 !important;
            }

            .modal-content {
                background: #c0a070 !important;
                border-color: rgba(70,35,5,0.28) !important;
                box-shadow: 0 4px 16px rgba(40,15,2,0.30), 0 12px 40px rgba(40,15,2,0.28), 0 32px 80px rgba(40,15,2,0.22) !important;
            }
            .modal-header {
                background: #b49060 !important;
                border-bottom-color: rgba(70,35,5,0.20) !important;
                color: #0e0804 !important;
            }
            .modal-body  { background: #c0a070 !important; color: #241408 !important; }
            .modal-footer { background: #b49060 !important; border-top-color: rgba(70,35,5,0.20) !important; }
            .modal-title { color: #0e0804 !important; }
            .btn-close { filter: sepia(1) saturate(0.4) opacity(0.55) !important; }

            .dropdown-menu {
                background: #c0a070 !important;
                border-color: rgba(70,35,5,0.26) !important;
                box-shadow: 0 6px 20px rgba(40,15,2,0.22) !important;
            }
            .dropdown-item { color: #241408 !important; }
            .dropdown-item:hover { background: rgba(70,35,5,0.12) !important; color: #0e0804 !important; }
            .dropdown-divider { border-color: rgba(70,35,5,0.18) !important; }

            .step-cell, .seq-cell {
                background: #b49060 !important;
                border-color: rgba(70,35,5,0.22) !important;
            }
            .step-cell.active, .seq-cell.has-note {
                background: #8a3a0e !important;
                box-shadow: 0 0 8px rgba(138,58,14,0.60) !important;
                color: #f5e8d0 !important;
            }

            .mixer-cell { background: #b49060 !important; border-color: rgba(70,35,5,0.18) !important; }
            .mixer-cell:hover { background: rgba(138,58,14,0.14) !important; }
            .mixer-row-label { background: #c0a070 !important; color: #241408 !important; border-color: rgba(70,35,5,0.18) !important; }

            .preset-browser-table-wrapper { background: #c0a070 !important; border-color: rgba(70,35,5,0.18) !important; }
            .preset-browser-table thead tr { background: #b49060 !important; }
            .preset-browser-table thead th { color: #5e3818 !important; border-bottom-color: rgba(70,35,5,0.18) !important; }
            .preset-browser-table tbody td { color: #241408 !important; border-bottom-color: rgba(70,35,5,0.10) !important; }
            .preset-browser-table tbody tr:hover td { background: rgba(70,35,5,0.08) !important; }
            .preset-browser-table tbody tr.selected td { background: rgba(138,58,14,0.18) !important; color: #0e0804 !important; }
            .col-name { color: #0e0804 !important; font-weight: 600 !important; }

            .piano-key-white, .keyboard-key.white {
                background: #d8bc90 !important;
                border-color: rgba(70,35,5,0.30) !important;
                color: #5e3818 !important;
            }
            .piano-key-black, .keyboard-key.black { background: #0e0804 !important; }

            .nav-tabs { border-bottom-color: rgba(70,35,5,0.22) !important; }
            .nav-tabs .nav-link { color: #5e3818 !important; border-color: transparent !important; }
            .nav-tabs .nav-link.active {
                background: #c0a070 !important;
                border-color: rgba(70,35,5,0.22) rgba(70,35,5,0.22) transparent !important;
                color: #0e0804 !important;
            }

            a, .text-primary { color: #8a3a0e !important; }
            .text-muted, .text-secondary { color: #5e3818 !important; }
            h1,h2,h3,h4,h5,h6 { color: #0e0804 !important; }
            .badge.bg-secondary { background: #b49060 !important; color: #241408 !important; }

            ::-webkit-scrollbar-track { background: #c9aa7c !important; }
            ::-webkit-scrollbar-thumb { background: rgba(70,35,5,0.30) !important; border-radius: 4px !important; }
            ::-webkit-scrollbar-thumb:hover { background: rgba(70,35,5,0.50) !important; }

            #studioModal .modal-content { background: #c0a070 !important; }
            #studioModal .modal-header { background: #b49060 !important; }
            #studioModal .modal-body   { background: #c9aa7c !important; color: #241408 !important; }
            #studioModal #studioSynthPane { background: #c9aa7c !important; }
        `,
        overlay:
            "position:fixed;inset:0;pointer-events:none;z-index:999999;box-shadow:inset 0 0 28vw 10vw rgba(40,15,2,0.35);background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.80' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.07'/%3E%3C/svg%3E\");opacity:1;"
    },

    // ─────────────────────────────────────────────────────
    // PHOSPHOR: Green phosphor CRT, vintage hardware sequencer
    // ─────────────────────────────────────────────────────
    phosphor: {
        name: 'Phosphor',
        description: 'Green phosphor CRT: vintage oscilloscope & hardware sequencer aesthetic',
        css: `
            html { background-color: #080c08 !important; }
            body {
                background-color: #080c08 !important;
                color: #a0d8a0 !important;
                font-family: 'Courier New', Courier, monospace !important;
            }

            :root {
                --ps-canvas:        #080c08;
                --ps-surface:       #0d140d;
                --ps-raised:        #152115;
                --ps-overlay:       #1a2e1a;
                --ps-border-subtle: rgba(0, 200, 80, 0.10);
                --ps-border:        rgba(0, 200, 80, 0.22);
                --ps-border-strong: rgba(0, 200, 80, 0.50);
                --ps-text-900:      #c8f0c8;
                --ps-text-700:      #a0d8a0;
                --ps-text-500:      #5a9a5a;
                --ps-text-300:      #2a5a2a;
                --ps-accent:        #00e676;
                --ps-accent-soft:   rgba(0, 230, 118, 0.14);
                --ps-accent-strong: #00b050;
                --ps-shadow-sm: 0 0 8px rgba(0, 230, 118, 0.15);
                --ps-shadow-md: 0 0 16px rgba(0, 230, 118, 0.20);
                --ps-shadow-lg: 0 0 32px rgba(0, 230, 118, 0.25);
                --bs-body-bg:        #080c08;
                --bs-body-color:     #a0d8a0;
                --bs-border-color:   rgba(0, 200, 80, 0.22);
                --bs-secondary-bg:   #152115;
                --bs-tertiary-bg:    #0d140d;
            }

            .app-topbar, .topbar-menu {
                background: #0a100a !important;
                border-bottom: 1px solid rgba(0, 200, 80, 0.28) !important;
                box-shadow: 0 0 14px rgba(0, 230, 118, 0.08) !important;
            }
            .topbar-btn { color: #5a9a5a !important; }
            .topbar-btn:hover { background: rgba(0, 230, 118, 0.08) !important; color: #00e676 !important; }

            .sidenav-menu {
                background: #060a06 !important;
                border-right: 1px solid rgba(0, 200, 80, 0.18) !important;
            }
            .nav-link { color: #5a9a5a !important; }
            .nav-link:hover { color: #00e676 !important; background: rgba(0, 230, 118, 0.06) !important; }
            .nav-link.active {
                color: #00e676 !important;
                background: rgba(0, 230, 118, 0.10) !important;
                border-left: 2px solid #00e676 !important;
            }

            .card {
                background: #0d140d !important;
                border: 1px solid rgba(0, 200, 80, 0.18) !important;
            }
            .card-header {
                background: #0a100a !important;
                border-bottom: 1px solid rgba(0, 200, 80, 0.16) !important;
                color: #00e676 !important;
                font-family: 'Courier New', monospace !important;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                font-size: 0.70rem;
            }
            .card-title { color: #00e676 !important; text-shadow: 0 0 8px rgba(0, 230, 118, 0.40) !important; }

            .asidebar, .asidebar-header, .asidebar-body {
                background: #060a06 !important;
                border-color: rgba(0, 200, 80, 0.16) !important;
            }
            .asidebar .accordion-item { background: #0d140d !important; border-color: rgba(0, 200, 80, 0.12) !important; }
            .asidebar .accordion-button { background: #0a100a !important; color: #5a9a5a !important; }
            .asidebar .accordion-button:hover { color: #00e676 !important; }
            .asidebar .accordion-button:not(.collapsed) { color: #00e676 !important; }

            .form-control, .form-select, select,
            input[type="text"], input[type="number"], input[type="search"], textarea {
                background: #060a06 !important;
                border: 1px solid rgba(0, 200, 80, 0.25) !important;
                color: #a0d8a0 !important;
                font-family: 'Courier New', monospace !important;
            }
            .form-control::placeholder, input::placeholder { color: #2a5a2a !important; }
            .form-control:focus, .form-select:focus {
                border-color: #00e676 !important;
                box-shadow: 0 0 0 2px rgba(0, 230, 118, 0.18) !important;
            }

            .btn-outline-secondary {
                border-color: rgba(0, 200, 80, 0.32) !important;
                color: #5a9a5a !important;
            }
            .btn-outline-secondary:hover {
                background: rgba(0, 230, 118, 0.08) !important;
                border-color: #00e676 !important;
                color: #00e676 !important;
            }
            .btn-outline-secondary.active {
                background: rgba(0, 230, 118, 0.16) !important;
                border-color: #00e676 !important;
                color: #00e676 !important;
                box-shadow: 0 0 8px rgba(0, 230, 118, 0.28) !important;
            }
            .btn-light {
                background: #0d140d !important;
                border-color: rgba(0, 200, 80, 0.25) !important;
                color: #a0d8a0 !important;
            }

            .modal-content {
                background: #0d140d !important;
                border: 1px solid rgba(0, 200, 80, 0.28) !important;
                box-shadow: 0 0 40px rgba(0, 230, 118, 0.10), 0 24px 80px rgba(0,0,0,0.85) !important;
            }
            .modal-header {
                background: #0a100a !important;
                border-bottom: 1px solid rgba(0, 200, 80, 0.18) !important;
                color: #00e676 !important;
            }
            .modal-body  { background: #0d140d !important; color: #a0d8a0 !important; }
            .modal-footer { background: #0a100a !important; border-top: 1px solid rgba(0, 200, 80, 0.16) !important; }
            .modal-title { color: #00e676 !important; text-shadow: 0 0 10px rgba(0, 230, 118, 0.35) !important; }
            .btn-close { filter: invert(1) sepia(1) saturate(5) hue-rotate(90deg) opacity(0.55) !important; }

            .dropdown-menu {
                background: #0d140d !important;
                border: 1px solid rgba(0, 200, 80, 0.25) !important;
                box-shadow: 0 8px 24px rgba(0,0,0,0.70) !important;
            }
            .dropdown-item { color: #a0d8a0 !important; }
            .dropdown-item:hover { background: rgba(0, 230, 118, 0.08) !important; color: #00e676 !important; }
            .dropdown-divider { border-color: rgba(0, 200, 80, 0.16) !important; }

            .step-cell, .seq-cell {
                background: #0d140d !important;
                border: 1px solid rgba(0, 200, 80, 0.14) !important;
            }
            .step-cell.active, .seq-cell.has-note {
                background: #004d20 !important;
                box-shadow: 0 0 10px rgba(0, 230, 118, 0.65), inset 0 0 4px rgba(0, 230, 118, 0.28) !important;
                color: #00e676 !important;
            }
            .step-cell:hover { border-color: rgba(0, 230, 118, 0.38) !important; }

            .mixer-cell { background: #0d140d !important; border-color: rgba(0, 200, 80, 0.11) !important; }
            .mixer-cell:hover { background: rgba(0, 230, 118, 0.05) !important; }
            .mixer-row-label { background: #0a100a !important; color: #5a9a5a !important; border-color: rgba(0, 200, 80, 0.14) !important; }

            .preset-browser-table-wrapper { background: #0d140d !important; border-color: rgba(0, 200, 80, 0.16) !important; }
            .preset-browser-table thead tr { background: #0a100a !important; }
            .preset-browser-table thead th { color: #5a9a5a !important; border-bottom-color: rgba(0, 200, 80, 0.18) !important; font-family: 'Courier New', monospace !important; text-transform: uppercase; font-size: 10px; }
            .preset-browser-table tbody td { color: #a0d8a0 !important; border-bottom-color: rgba(0, 200, 80, 0.08) !important; }
            .preset-browser-table tbody tr:hover td { background: rgba(0, 230, 118, 0.06) !important; }
            .preset-browser-table tbody tr.selected td { background: rgba(0, 230, 118, 0.14) !important; color: #00e676 !important; }
            .col-name { color: #c8f0c8 !important; font-weight: 600 !important; }

            .piano-key-white, .keyboard-key.white {
                background: #152115 !important;
                border-color: rgba(0, 200, 80, 0.28) !important;
                color: #2a5a2a !important;
            }
            .piano-key-black, .keyboard-key.black { background: #060a06 !important; }

            .nav-tabs { border-bottom-color: rgba(0, 200, 80, 0.18) !important; }
            .nav-tabs .nav-link { color: #5a9a5a !important; }
            .nav-tabs .nav-link.active {
                background: #0d140d !important;
                border-color: rgba(0, 200, 80, 0.24) rgba(0, 200, 80, 0.24) transparent !important;
                color: #00e676 !important;
            }
            .nav-tabs .nav-link:hover { color: #00e676 !important; }

            a, .text-primary { color: #00e676 !important; }
            .text-muted, .text-secondary { color: #5a9a5a !important; }
            h1,h2,h3,h4,h5,h6 { color: #c8f0c8 !important; }
            .badge.bg-secondary { background: #152115 !important; color: #a0d8a0 !important; }

            ::-webkit-scrollbar-track { background: #080c08 !important; }
            ::-webkit-scrollbar-thumb { background: rgba(0, 200, 80, 0.24) !important; border-radius: 4px !important; }
            ::-webkit-scrollbar-thumb:hover { background: rgba(0, 230, 118, 0.44) !important; }

            #studioModal .modal-content { background: #0d140d !important; }
            #studioModal .modal-header { background: #0a100a !important; }
            #studioModal .modal-body   { background: #080c08 !important; color: #a0d8a0 !important; }
            #studioModal #studioSynthPane { background: #080c08 !important; }
        `,
        overlay:
            'position:fixed;inset:0;pointer-events:none;z-index:999999;background:repeating-linear-gradient(0deg,rgba(0,0,0,0.13) 0px,rgba(0,0,0,0.13) 1px,transparent 1px,transparent 3px);opacity:0.65;'
    },

    // ─────────────────────────────────────────────────────
    // MIDNIGHT NOIR: Professional dark DAW, navy + electric blue
    // ─────────────────────────────────────────────────────
    midnoir: {
        name: 'Midnight Noir',
        description: 'Professional dark studio: deep navy, electric blue, precision DAW aesthetic',
        css: `
            html { background-color: #0a0c12 !important; }
            body {
                background-color: #0a0c12 !important;
                color: #c0c8d8 !important;
            }

            :root {
                --ps-canvas:        #0a0c12;
                --ps-surface:       #12161f;
                --ps-raised:        #1a2030;
                --ps-overlay:       #222a3c;
                --ps-border-subtle: rgba(70, 130, 255, 0.08);
                --ps-border:        rgba(70, 130, 255, 0.16);
                --ps-border-strong: rgba(70, 130, 255, 0.38);
                --ps-text-900:      #e8edf8;
                --ps-text-700:      #c0c8d8;
                --ps-text-500:      #6878a0;
                --ps-text-300:      #30404a;
                --ps-accent:        #4d94ff;
                --ps-accent-soft:   rgba(77, 148, 255, 0.12);
                --ps-accent-strong: #2266ee;
                --ps-shadow-sm: 0 2px 6px rgba(0,0,0,0.40);
                --ps-shadow-md: 0 4px 16px rgba(0,0,0,0.52);
                --ps-shadow-lg: 0 12px 40px rgba(0,0,0,0.68);
                --bs-body-bg:        #0a0c12;
                --bs-body-color:     #c0c8d8;
                --bs-border-color:   rgba(70, 130, 255, 0.16);
                --bs-secondary-bg:   #1a2030;
                --bs-tertiary-bg:    #12161f;
            }

            .app-topbar, .topbar-menu {
                background: linear-gradient(180deg, #131928 0%, #0e1220 100%) !important;
                border-bottom: 1px solid rgba(70, 130, 255, 0.20) !important;
            }
            .topbar-btn { color: #6878a0 !important; }
            .topbar-btn:hover { background: rgba(77, 148, 255, 0.08) !important; color: #c0c8d8 !important; }

            .sidenav-menu {
                background: #07090f !important;
                border-right: 1px solid rgba(70, 130, 255, 0.12) !important;
            }
            .nav-link { color: #6878a0 !important; }
            .nav-link:hover { color: #c0c8d8 !important; background: rgba(77, 148, 255, 0.06) !important; }
            .nav-link.active {
                color: #4d94ff !important;
                background: rgba(77, 148, 255, 0.12) !important;
                border-left: 2px solid #4d94ff !important;
            }

            .card {
                background: #12161f !important;
                border: 1px solid rgba(70, 130, 255, 0.12) !important;
                box-shadow: 0 2px 10px rgba(0,0,0,0.38) !important;
            }
            .card-header {
                background: #0e1219 !important;
                border-bottom: 1px solid rgba(70, 130, 255, 0.12) !important;
                color: #c0c8d8 !important;
                font-size: 0.70rem;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.06em;
            }
            .card-title { color: #e8edf8 !important; }

            .asidebar, .asidebar-header, .asidebar-body {
                background: #07090f !important;
                border-color: rgba(70, 130, 255, 0.11) !important;
            }
            .asidebar .accordion-item { background: #12161f !important; border-color: rgba(70, 130, 255, 0.09) !important; }
            .asidebar .accordion-button { background: #0e1219 !important; color: #6878a0 !important; }
            .asidebar .accordion-button:hover { color: #c0c8d8 !important; }
            .asidebar .accordion-button:not(.collapsed) { color: #4d94ff !important; }

            .form-control, .form-select, select,
            input[type="text"], input[type="number"], input[type="search"], textarea {
                background: #07090f !important;
                border: 1px solid rgba(70, 130, 255, 0.18) !important;
                color: #c0c8d8 !important;
            }
            .form-control::placeholder, input::placeholder { color: #30404a !important; }
            .form-control:focus, .form-select:focus {
                border-color: #4d94ff !important;
                box-shadow: 0 0 0 2px rgba(77, 148, 255, 0.18) !important;
            }

            .btn-outline-secondary {
                border-color: rgba(70, 130, 255, 0.24) !important;
                color: #6878a0 !important;
            }
            .btn-outline-secondary:hover {
                background: rgba(77, 148, 255, 0.08) !important;
                border-color: rgba(70, 130, 255, 0.45) !important;
                color: #c0c8d8 !important;
            }
            .btn-outline-secondary.active {
                background: rgba(77, 148, 255, 0.16) !important;
                border-color: #4d94ff !important;
                color: #4d94ff !important;
                box-shadow: 0 0 8px rgba(77, 148, 255, 0.22) !important;
            }
            .btn-light {
                background: #1a2030 !important;
                border-color: rgba(70, 130, 255, 0.20) !important;
                color: #c0c8d8 !important;
            }

            .modal-content {
                background: #12161f !important;
                border: 1px solid rgba(70, 130, 255, 0.22) !important;
                box-shadow: 0 24px 80px rgba(0,0,0,0.82) !important;
            }
            .modal-header { background: #0e1219 !important; border-bottom: 1px solid rgba(70, 130, 255, 0.14) !important; color: #e8edf8 !important; }
            .modal-body   { background: #12161f !important; color: #c0c8d8 !important; }
            .modal-footer { background: #0e1219 !important; border-top: 1px solid rgba(70, 130, 255, 0.12) !important; }
            .modal-title  { color: #e8edf8 !important; }
            .btn-close { filter: invert(1) opacity(0.48) !important; }

            .dropdown-menu {
                background: #12161f !important;
                border: 1px solid rgba(70, 130, 255, 0.20) !important;
                box-shadow: 0 8px 28px rgba(0,0,0,0.65) !important;
            }
            .dropdown-item { color: #c0c8d8 !important; }
            .dropdown-item:hover { background: rgba(77, 148, 255, 0.08) !important; color: #e8edf8 !important; }
            .dropdown-divider { border-color: rgba(70, 130, 255, 0.12) !important; }

            .step-cell, .seq-cell {
                background: #1a2030 !important;
                border: 1px solid rgba(70, 130, 255, 0.10) !important;
            }
            .step-cell.active, .seq-cell.has-note {
                background: #1a3a80 !important;
                box-shadow: 0 0 10px rgba(77, 148, 255, 0.55) !important;
                color: #7ab4ff !important;
            }
            .step-cell:hover { border-color: rgba(70, 130, 255, 0.35) !important; }

            .mixer-cell { background: #12161f !important; border-color: rgba(70, 130, 255, 0.09) !important; }
            .mixer-cell:hover { background: rgba(77, 148, 255, 0.05) !important; }
            .mixer-row-label { background: #0e1219 !important; color: #6878a0 !important; border-color: rgba(70, 130, 255, 0.11) !important; }

            .preset-browser-table-wrapper { background: #12161f !important; border-color: rgba(70, 130, 255, 0.12) !important; }
            .preset-browser-table thead tr { background: #0e1219 !important; }
            .preset-browser-table thead th { color: #6878a0 !important; border-bottom-color: rgba(70, 130, 255, 0.14) !important; text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; }
            .preset-browser-table tbody td { color: #c0c8d8 !important; border-bottom-color: rgba(70, 130, 255, 0.07) !important; }
            .preset-browser-table tbody tr:hover td { background: rgba(77, 148, 255, 0.05) !important; }
            .preset-browser-table tbody tr.selected td { background: rgba(77, 148, 255, 0.14) !important; color: #4d94ff !important; }
            .col-name { color: #e8edf8 !important; font-weight: 600 !important; }

            .piano-key-white, .keyboard-key.white {
                background: #1a2030 !important;
                border-color: rgba(70, 130, 255, 0.20) !important;
                color: #30404a !important;
            }
            .piano-key-black, .keyboard-key.black { background: #07090f !important; }

            .nav-tabs { border-bottom-color: rgba(70, 130, 255, 0.16) !important; }
            .nav-tabs .nav-link { color: #6878a0 !important; }
            .nav-tabs .nav-link.active {
                background: #12161f !important;
                border-color: rgba(70, 130, 255, 0.20) rgba(70, 130, 255, 0.20) transparent !important;
                color: #4d94ff !important;
            }
            .nav-tabs .nav-link:hover { color: #c0c8d8 !important; }

            a, .text-primary { color: #4d94ff !important; }
            .text-muted, .text-secondary { color: #6878a0 !important; }
            h1,h2,h3,h4,h5,h6 { color: #e8edf8 !important; }
            .badge.bg-secondary { background: #1a2030 !important; color: #6878a0 !important; }

            ::-webkit-scrollbar-track { background: #0a0c12 !important; }
            ::-webkit-scrollbar-thumb { background: rgba(70, 130, 255, 0.20) !important; border-radius: 4px !important; }
            ::-webkit-scrollbar-thumb:hover { background: rgba(77, 148, 255, 0.40) !important; }

            #studioModal .modal-content { background: #12161f !important; }
            #studioModal .modal-header { background: #0e1219 !important; }
            #studioModal .modal-body   { background: #0a0c12 !important; color: #c0c8d8 !important; }
            #studioModal #studioSynthPane { background: #0a0c12 !important; }
        `,
        overlay: null
    },

    // ─────────────────────────────────────────────────────
    // SYNTHWAVE: 80s retrowave, deep violet + hot pink + teal
    // ─────────────────────────────────────────────────────
    synthwave: {
        name: 'Synthwave',
        description: '80s retrowave: deep violet night, hot pink neon, electric teal highlights',
        css: `
            html { background-color: #0d0817 !important; }
            body {
                background-color: #0d0817 !important;
                color: #d0c0e8 !important;
            }

            :root {
                --ps-canvas:        #0d0817;
                --ps-surface:       #160f2a;
                --ps-raised:        #1e1440;
                --ps-overlay:       #281a55;
                --ps-border-subtle: rgba(170, 70, 255, 0.10);
                --ps-border:        rgba(170, 70, 255, 0.22);
                --ps-border-strong: rgba(170, 70, 255, 0.50);
                --ps-text-900:      #f0e4ff;
                --ps-text-700:      #d0c0e8;
                --ps-text-500:      #7850b0;
                --ps-text-300:      #361870;
                --ps-accent:        #ff3aaa;
                --ps-accent-soft:   rgba(255, 58, 170, 0.14);
                --ps-accent-strong: #cc1480;
                --ps-shadow-sm: 0 0 12px rgba(170, 70, 255, 0.14);
                --ps-shadow-md: 0 0 24px rgba(170, 70, 255, 0.20);
                --ps-shadow-lg: 0 0 48px rgba(170, 70, 255, 0.26);
                --bs-body-bg:        #0d0817;
                --bs-body-color:     #d0c0e8;
                --bs-border-color:   rgba(170, 70, 255, 0.22);
                --bs-secondary-bg:   #1e1440;
                --bs-tertiary-bg:    #160f2a;
            }

            .app-topbar, .topbar-menu {
                background: linear-gradient(180deg, #160f2a 0%, #0d0817 100%) !important;
                border-bottom: 1px solid rgba(255, 58, 170, 0.28) !important;
                box-shadow: 0 1px 18px rgba(255, 58, 170, 0.08) !important;
            }
            .topbar-btn { color: #7850b0 !important; }
            .topbar-btn:hover { background: rgba(255, 58, 170, 0.08) !important; color: #ff3aaa !important; }

            .sidenav-menu {
                background: #090512 !important;
                border-right: 1px solid rgba(170, 70, 255, 0.18) !important;
            }
            .nav-link { color: #7850b0 !important; }
            .nav-link:hover { color: #ff3aaa !important; background: rgba(255, 58, 170, 0.06) !important; }
            .nav-link.active {
                color: #ff3aaa !important;
                background: rgba(255, 58, 170, 0.10) !important;
                border-left: 2px solid #ff3aaa !important;
            }

            .card {
                background: #160f2a !important;
                border: 1px solid rgba(170, 70, 255, 0.18) !important;
                box-shadow: 0 2px 14px rgba(0,0,0,0.55) !important;
            }
            .card-header {
                background: #100c20 !important;
                border-bottom: 1px solid rgba(170, 70, 255, 0.16) !important;
                color: #d0c0e8 !important;
                font-size: 0.70rem;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.08em;
            }
            .card-title { color: #ff3aaa !important; text-shadow: 0 0 8px rgba(255, 58, 170, 0.35) !important; }

            .asidebar, .asidebar-header, .asidebar-body {
                background: #090512 !important;
                border-color: rgba(170, 70, 255, 0.16) !important;
            }
            .asidebar .accordion-item { background: #160f2a !important; border-color: rgba(170, 70, 255, 0.12) !important; }
            .asidebar .accordion-button { background: #100c20 !important; color: #7850b0 !important; }
            .asidebar .accordion-button:hover { color: #d0c0e8 !important; }
            .asidebar .accordion-button:not(.collapsed) { color: #ff3aaa !important; }

            .form-control, .form-select, select,
            input[type="text"], input[type="number"], input[type="search"], textarea {
                background: #090512 !important;
                border: 1px solid rgba(170, 70, 255, 0.25) !important;
                color: #d0c0e8 !important;
            }
            .form-control::placeholder, input::placeholder { color: #361870 !important; }
            .form-control:focus, .form-select:focus {
                border-color: #ff3aaa !important;
                box-shadow: 0 0 0 2px rgba(255, 58, 170, 0.20) !important;
            }

            .btn-outline-secondary {
                border-color: rgba(170, 70, 255, 0.28) !important;
                color: #7850b0 !important;
            }
            .btn-outline-secondary:hover {
                background: rgba(255, 58, 170, 0.08) !important;
                border-color: rgba(255, 58, 170, 0.50) !important;
                color: #ff3aaa !important;
            }
            .btn-outline-secondary.active {
                background: rgba(255, 58, 170, 0.16) !important;
                border-color: #ff3aaa !important;
                color: #ff3aaa !important;
                box-shadow: 0 0 10px rgba(255, 58, 170, 0.30) !important;
            }
            .btn-light {
                background: #1e1440 !important;
                border-color: rgba(170, 70, 255, 0.24) !important;
                color: #d0c0e8 !important;
            }

            .modal-content {
                background: #160f2a !important;
                border: 1px solid rgba(255, 58, 170, 0.28) !important;
                box-shadow: 0 0 50px rgba(170, 70, 255, 0.14), 0 28px 80px rgba(0,0,0,0.85) !important;
            }
            .modal-header { background: #100c20 !important; border-bottom: 1px solid rgba(170, 70, 255, 0.18) !important; color: #f0e4ff !important; }
            .modal-body   { background: #160f2a !important; color: #d0c0e8 !important; }
            .modal-footer { background: #100c20 !important; border-top: 1px solid rgba(170, 70, 255, 0.16) !important; }
            .modal-title  { color: #ff3aaa !important; text-shadow: 0 0 10px rgba(255, 58, 170, 0.38) !important; }
            .btn-close { filter: invert(1) sepia(1) saturate(4) hue-rotate(280deg) opacity(0.58) !important; }

            .dropdown-menu {
                background: #160f2a !important;
                border: 1px solid rgba(170, 70, 255, 0.24) !important;
                box-shadow: 0 8px 32px rgba(0,0,0,0.75) !important;
            }
            .dropdown-item { color: #d0c0e8 !important; }
            .dropdown-item:hover { background: rgba(255, 58, 170, 0.08) !important; color: #ff3aaa !important; }
            .dropdown-divider { border-color: rgba(170, 70, 255, 0.14) !important; }

            .step-cell, .seq-cell {
                background: #1e1440 !important;
                border: 1px solid rgba(170, 70, 255, 0.12) !important;
            }
            .step-cell.active, .seq-cell.has-note {
                background: #56083c !important;
                box-shadow: 0 0 12px rgba(255, 58, 170, 0.68), inset 0 0 4px rgba(255, 58, 170, 0.24) !important;
                color: #ff3aaa !important;
            }
            .step-cell:hover { border-color: rgba(255, 58, 170, 0.35) !important; }

            .mixer-cell { background: #160f2a !important; border-color: rgba(170, 70, 255, 0.10) !important; }
            .mixer-cell:hover { background: rgba(255, 58, 170, 0.06) !important; }
            .mixer-row-label { background: #100c20 !important; color: #7850b0 !important; border-color: rgba(170, 70, 255, 0.14) !important; }

            .preset-browser-table-wrapper { background: #160f2a !important; border-color: rgba(170, 70, 255, 0.16) !important; }
            .preset-browser-table thead tr { background: #100c20 !important; }
            .preset-browser-table thead th { color: #7850b0 !important; border-bottom-color: rgba(170, 70, 255, 0.18) !important; text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; }
            .preset-browser-table tbody td { color: #d0c0e8 !important; border-bottom-color: rgba(170, 70, 255, 0.07) !important; }
            .preset-browser-table tbody tr:hover td { background: rgba(255, 58, 170, 0.06) !important; }
            .preset-browser-table tbody tr.selected td { background: rgba(255, 58, 170, 0.14) !important; color: #ff3aaa !important; }
            .col-name { color: #f0e4ff !important; font-weight: 600 !important; }

            .piano-key-white, .keyboard-key.white {
                background: #1e1440 !important;
                border-color: rgba(170, 70, 255, 0.24) !important;
                color: #361870 !important;
            }
            .piano-key-black, .keyboard-key.black { background: #090512 !important; }

            .nav-tabs { border-bottom-color: rgba(170, 70, 255, 0.20) !important; }
            .nav-tabs .nav-link { color: #7850b0 !important; }
            .nav-tabs .nav-link.active {
                background: #160f2a !important;
                border-color: rgba(170, 70, 255, 0.24) rgba(170, 70, 255, 0.24) transparent !important;
                color: #ff3aaa !important;
            }
            .nav-tabs .nav-link:hover { color: #d0c0e8 !important; }

            a, .text-primary { color: #ff3aaa !important; }
            .text-muted, .text-secondary { color: #7850b0 !important; }
            h1,h2,h3,h4,h5,h6 { color: #f0e4ff !important; }
            .badge.bg-secondary { background: #1e1440 !important; color: #7850b0 !important; }

            ::-webkit-scrollbar-track { background: #0d0817 !important; }
            ::-webkit-scrollbar-thumb { background: rgba(170, 70, 255, 0.24) !important; border-radius: 4px !important; }
            ::-webkit-scrollbar-thumb:hover { background: rgba(255, 58, 170, 0.44) !important; }

            #studioModal .modal-content { background: #160f2a !important; }
            #studioModal .modal-header { background: #100c20 !important; }
            #studioModal .modal-body   { background: #0d0817 !important; color: #d0c0e8 !important; }
            #studioModal #studioSynthPane { background: #0d0817 !important; }
        `,
        overlay:
            'position:fixed;inset:0;pointer-events:none;z-index:999999;background:linear-gradient(transparent 50%,rgba(255,40,170,0.012) 50%);background-size:100% 4px;opacity:0.6;'
    }
};
