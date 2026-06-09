/**
 * A small, dependency-free ANSI parser: turn a string with SGR escape codes into
 * styled segments, then into themed HTML. Supports the 16 basic colors (remapped to
 * the theme's brand ramp), xterm-256, truecolor (38;2;r;g;b), bold, and dim.
 */
import type { Theme } from "./theme.js";

export interface Seg {
  text: string;
  color?: string; // resolved hex, or undefined for default
  bold?: boolean;
  dim?: boolean;
}

const ESC = /\x1b\[([0-9;]*)m/g;

/** Strip all SGR codes (for measuring visible width). */
export function stripAnsi(s: string): string {
  return s.replace(ESC, "");
}

/** xterm-256 index → hex (16-231 = 6×6×6 cube; 232-255 = grayscale). */
function xterm256(n: number): string {
  if (n < 16) return ""; // handled via theme palette by caller
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return rgbHex(v, v, v);
  }
  const i = n - 16;
  const r = Math.floor(i / 36);
  const g = Math.floor((i % 36) / 6);
  const b = i % 6;
  const c = (x: number) => (x === 0 ? 0 : 55 + x * 40);
  return rgbHex(c(r), c(g), c(b));
}

function rgbHex(r: number, g: number, b: number): string {
  const h = (x: number) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Parse a string into styled segments, resolving colors against the theme. */
export function parseAnsi(input: string, theme: Theme): Seg[] {
  const segs: Seg[] = [];
  let color: string | undefined;
  let bold = false;
  let dim = false;
  let last = 0;
  const push = (text: string) => {
    if (text) segs.push({ text, color, bold, dim });
  };

  input.replace(ESC, (m, codes: string, offset: number) => {
    push(input.slice(last, offset));
    last = offset + m.length;
    const parts = codes === "" ? [0] : codes.split(";").map((x: string) => parseInt(x, 10) || 0);
    for (let i = 0; i < parts.length; i++) {
      const code = parts[i];
      if (code === 0) {
        color = undefined;
        bold = false;
        dim = false;
      } else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (code === 22) {
        bold = false;
        dim = false;
      } else if (code === 39) color = undefined;
      else if (code >= 30 && code <= 37) color = theme.ansi[code - 30];
      else if (code >= 90 && code <= 97) color = theme.ansi[code - 90 + 8];
      else if (code === 38) {
        if (parts[i + 1] === 5) {
          const idx = parts[i + 2] ?? 0;
          color = idx < 16 ? theme.ansi[idx] : xterm256(idx);
          i += 2;
        } else if (parts[i + 1] === 2) {
          color = rgbHex(parts[i + 2] ?? 0, parts[i + 3] ?? 0, parts[i + 4] ?? 0);
          i += 4;
        }
      }
    }
    return m;
  });
  push(input.slice(last));
  return segs;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Render parsed segments to HTML spans. */
export function segsToHtml(segs: Seg[]): string {
  return segs
    .map((s) => {
      const style: string[] = [];
      if (s.color) style.push(`color:${s.color}`);
      if (s.bold) style.push("font-weight:700");
      if (s.dim) style.push("opacity:.6");
      const txt = escapeHtml(s.text);
      return style.length ? `<span style="${style.join(";")}">${txt}</span>` : txt;
    })
    .join("");
}
