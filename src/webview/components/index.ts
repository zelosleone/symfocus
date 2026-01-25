/**
 * Symfocus Component Factory Functions
 *
 * Pure functions that return HTML strings for composable UI components.
 */

interface BadgeProps {
  text: string;
  state?: "idle" | "working" | "ready" | "error";
}

interface IconButtonProps {
  id?: string;
  label: string;
  iconSvg: string;
  text: string;
  className?: string;
  hidden?: boolean;
}

function cls(...classes: (string | undefined | false)[]): string {
  return classes.filter(Boolean).join(" ");
}

const Icons = {
  externalLink: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>`,

  copy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>`,

  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <polyline points="20 6 9 17 4 12"/>
  </svg>`,
};

function Badge({ text, state = "idle" }: BadgeProps): string {
  return `<span class="badge ${state}" id="status-badge" role="status">${text}</span>`;
}

function IconButton({
  id,
  label,
  iconSvg,
  text,
  className = "ghost-button",
  hidden = false,
}: IconButtonProps): string {
  const idAttr = id ? `id="${id}"` : "";
  const hiddenClass = hidden ? "hidden" : "";

  return `
    <button ${idAttr} class="${cls(className, hiddenClass)}" aria-label="${label}">
      ${iconSvg}
      ${text}
    </button>
  `;
}

export function LoadingState(): string {
  return `
    <div id="loading" class="loading hidden">
      <div class="loading-row">
        <span class="spinner" aria-hidden="true"></span>
        <span>Analyzing symbol…</span>
      </div>
      <div class="skeleton-stack">
        <div class="skeleton-line"></div>
        <div class="skeleton-line skeleton-short"></div>
      </div>
    </div>
  `;
}

function Kbd(key: string): string {
  return `<kbd>${key}</kbd>`;
}

export interface HeroProps {
  title?: string;
  subtitle?: string;
  badgeText?: string;
  badgeState?: "idle" | "working" | "ready" | "error";
  statusText?: string;
}

export function HeroSection({
  title = "Symbol Explanation",
  subtitle,
  badgeText = "Ready",
  badgeState = "idle",
  statusText = "Waiting for symbol selection",
}: HeroProps = {}): string {
  const defaultSubtitle = `Select a symbol and press ${Kbd("Ctrl")}+${Kbd("Alt")}+${Kbd("E")}
    <span class="mac-hint">(macOS: ${Kbd("⌘")}+${Kbd("Alt")}+${Kbd("E")})</span>`;

  return `
    <header class="hero" role="banner">
      <div>
        <h1 id="hero-title">${title}</h1>
        <p class="subtitle" id="hero-subtitle">${subtitle ?? defaultSubtitle}</p>
      </div>
      <div class="hero-status">
        ${Badge({ text: badgeText, state: badgeState })}
        <div class="status-text" id="status-text">${statusText}</div>
        <div class="status-detail hidden" id="status-detail"></div>
      </div>
    </header>
  `;
}

export function SymbolInfoCard(): string {
  return `
    <div id="symbol-info" class="symbol-bar hidden">
      <span class="kind-pill" id="info-symbol-kind">—</span>
      <span id="info-symbol-location" class="symbol-bar-path">—</span>
      <span class="symbol-bar-sep">·</span>
      <span class="info-muted" id="info-symbol-linecol">—</span>
    </div>
  `;
}

export function Placeholder(): string {
  return `
    <div id="placeholder" class="placeholder">
      <p>Select a symbol, press ${Kbd("Ctrl")}+${Kbd("Alt")}+${Kbd("E")} to explain.</p>
    </div>
  `;
}

export function CopyRow(): string {
  return `
    <div id="copy-row" class="copy-row hidden">
      ${IconButton({
        id: "copy-btn",
        label: "Copy full explanation to clipboard",
        iconSvg: Icons.copy,
        text: "Copy Explanation",
        className: "",
      })}
    </div>
  `;
}
