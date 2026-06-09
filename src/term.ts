/**
 * Build a styled "terminal window" HTML card from real command output. The text is
 * yours (run a command, pipe it in); shotcraft only themes the presentation:
 * window chrome, a monospace body with ANSI remapped to the brand ramp, and a card
 * with the premium dark/violet/cyan look. Dimensions are computed precisely from the
 * monospace metrics, so the screenshot is tight (no cropping needed).
 */
import { parseAnsi, segsToHtml, stripAnsi, escapeHtml } from "./ansi.js";
import { getTheme } from "./theme.js";

export interface TermOptions {
  title?: string;
  theme?: string;
  fontSize?: number; // px (default 15)
  cols?: number; // wrap long lines at this many columns (default: no wrap)
}

export interface BuiltHtml {
  html: string;
  width: number;
  height: number;
}

const MONO_ADVANCE = 0.6; // JetBrains Mono / most monospace fonts: 0.6em per glyph

export function buildTerm(output: string, opts: TermOptions = {}): BuiltHtml {
  const theme = getTheme(opts.theme);
  const fs = opts.fontSize ?? 15;
  const lh = Math.round(fs * 1.55);
  const pad = 22; // inner padding around the body
  const titlebar = 44;
  const margin = 30; // breathing room around the card (also holds the drop shadow)

  // normalize: tabs → 2 spaces, drop a single trailing newline, cap blank tail
  const text = output.replace(/\t/g, "  ").replace(/\r\n/g, "\n").replace(/\n$/, "");
  const visibleLines = stripAnsi(text).split("\n");
  const actualMax = Math.max(8, ...visibleLines.map((l) => [...l].length));
  // If --cols is set, cap the width there and wrap; height counts wrapped rows.
  const wrap = opts.cols != null && opts.cols > 0 && actualMax > opts.cols;
  const cols = wrap ? opts.cols! : actualMax;
  const rows = wrap
    ? visibleLines.reduce((n, l) => n + Math.max(1, Math.ceil([...l].length / cols)), 0)
    : visibleLines.length;

  const bodyW = Math.ceil(cols * fs * MONO_ADVANCE) + 2; // +2px hairline fudge
  const cardW = bodyW + 2 * pad;
  const cardH = titlebar + rows * lh + 2 * pad;
  const width = cardW + 2 * margin;
  const height = cardH + 2 * margin;

  const body = segsToHtml(parseAnsi(text, theme));
  const title = escapeHtml(opts.title ?? "");

  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;background:${theme.pageBg};}
  .wrap{box-sizing:border-box;width:${width}px;height:${height}px;padding:${margin}px;}
  .card{position:relative;width:${cardW}px;height:${cardH}px;border:1px solid ${theme.border};
    border-radius:12px;overflow:hidden;
    background:
      radial-gradient(120% 120% at 0% 0%,rgba(167,139,250,.14),transparent 55%),
      radial-gradient(120% 120% at 100% 100%,rgba(34,211,238,.12),transparent 55%),
      ${theme.card};
    box-shadow:0 24px 60px -20px rgba(0,0,0,.55);}
  .bar{height:${titlebar}px;display:flex;align-items:center;gap:8px;padding:0 16px;
    border-bottom:1px solid ${theme.border};}
  .dot{width:12px;height:12px;border-radius:50%;}
  .title{flex:1;text-align:center;color:${theme.titleText};font:600 13px/1 ${theme.fontSans};
    margin-right:46px;letter-spacing:.2px;}
  pre{margin:0;padding:${pad}px;color:${theme.text};
    white-space:${wrap ? "pre-wrap" : "pre"};${wrap ? "word-break:break-all;" : ""}
    font:${fs}px/${lh}px ${theme.fontMono};font-variant-ligatures:none;}
</style></head>
<body><div class="wrap"><div class="card">
  <div class="bar">
    <span class="dot" style="background:${theme.dots[0]}"></span>
    <span class="dot" style="background:${theme.dots[1]}"></span>
    <span class="dot" style="background:${theme.dots[2]}"></span>
    <span class="title">${title}</span>
  </div>
  <pre>${body}</pre>
</div></div></body></html>`;

  return { html, width, height };
}
