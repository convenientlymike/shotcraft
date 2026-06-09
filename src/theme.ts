/**
 * The look. One premium dark theme by default (the DMA / premium-dashboard-ui
 * palette: dark slate + violet/cyan/emerald), with ANSI's 16 colors remapped onto
 * the brand ramp — so ANY colored CLI output comes out brand-matched automatically.
 */
export interface Theme {
  name: string;
  pageBg: string; // behind the card (transparent by default → rounded corners)
  card: string; // terminal/card background
  border: string;
  text: string; // default foreground
  titlebar: string;
  titleText: string;
  dots: [string, string, string]; // window-chrome traffic lights
  /** ANSI palette: [0..7] normal, [8..15] bright. Remapped to the brand ramp. */
  ansi: string[];
  /** caption accents for `diff` */
  before: string;
  after: string;
  fontMono: string;
  fontSans: string;
}

export const BRAND: Theme = {
  name: "brand",
  pageBg: "transparent",
  card: "#0d1117",
  border: "#21262d",
  text: "#e6edf3",
  titlebar: "#161b22",
  titleText: "#8b949e",
  dots: ["#ff5f57", "#febc2e", "#28c840"],
  ansi: [
    "#484f58", // 0 black
    "#f87171", // 1 red
    "#34d399", // 2 green
    "#fbbf24", // 3 yellow
    "#22d3ee", // 4 blue   → brand cyan
    "#a78bfa", // 5 magenta→ brand violet
    "#22d3ee", // 6 cyan
    "#c9d1d9", // 7 white
    "#6e7681", // 8 bright black
    "#fca5a5", // 9 bright red
    "#6ee7b7", // 10 bright green
    "#fcd34d", // 11 bright yellow
    "#67e8f9", // 12 bright blue
    "#c4b5fd", // 13 bright magenta → light violet
    "#67e8f9", // 14 bright cyan
    "#f0f6fc", // 15 bright white
  ],
  before: "#f87171",
  after: "#34d399",
  fontMono:
    "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
  fontSans: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

export const THEMES: Record<string, Theme> = { brand: BRAND };

export function getTheme(name?: string): Theme {
  return THEMES[name ?? "brand"] ?? BRAND;
}
