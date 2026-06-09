/**
 * Build a before/after HTML comparison: two framed images side by side with colored
 * labels and captions. Images are embedded as data URIs, so Chrome never touches the
 * filesystem (no macOS TCC folder prompt, works from any cwd). Frame styles: card
 * (default), phone (bezel), browser (chrome bar).
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { getTheme } from "./theme.js";
import { escapeHtml } from "./ansi.js";
import type { BuiltHtml } from "./term.js";

export interface DiffSide {
  image: string; // path
  label?: string;
  caption?: string;
}
export interface DiffOptions {
  theme?: string;
  frame?: "card" | "phone" | "browser";
}

interface ImgInfo {
  dataUri: string;
  w: number;
  h: number;
}

function attrNum(tag: string, name: string): number {
  const m = new RegExp(`\\b${name}="([\\d.]+)`).exec(tag);
  return m ? Number(m[1]) : 0;
}

function imageInfo(path: string): ImgInfo {
  const buf = readFileSync(path);
  const ext = extname(path).toLowerCase();
  if (ext === ".svg") {
    const s = buf.toString("utf8");
    const tag = /<svg[^>]*>/.exec(s)?.[0] ?? "";
    let w = attrNum(tag, "width");
    let h = attrNum(tag, "height");
    if (!w || !h) {
      const vb = /viewBox="([^"]+)"/.exec(tag);
      if (vb) {
        const p = vb[1].trim().split(/[\s,]+/).map(Number);
        w = w || p[2];
        h = h || p[3];
      }
    }
    return { dataUri: `data:image/svg+xml;base64,${buf.toString("base64")}`, w: w || 320, h: h || 200 };
  }
  let w = 0;
  let h = 0;
  let mime = "image/png";
  if (ext === ".png") {
    w = buf.readUInt32BE(16);
    h = buf.readUInt32BE(20);
  } else if (ext === ".jpg" || ext === ".jpeg") {
    mime = "image/jpeg";
    [w, h] = jpegSize(buf);
  } else if (ext === ".webp") {
    mime = "image/webp";
  }
  return { dataUri: `data:${mime};base64,${buf.toString("base64")}`, w: w || 320, h: h || 200 };
}

function jpegSize(buf: Buffer): [number, number] {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return [320, 200];
}

const MAXW = 360;
const CAPMAX = 300; // cap frame height

export function buildDiff(before: DiffSide, after: DiffSide, opts: DiffOptions = {}): BuiltHtml {
  const theme = getTheme(opts.theme);
  const frame = opts.frame ?? "card";
  const margin = 30;
  const gap = 34;

  const bi = imageInfo(before.image);
  const ai = imageInfo(after.image);
  // shared frame box: width MAXW, height by the taller aspect (capped)
  const aspect = Math.max(bi.h / bi.w, ai.h / ai.w);
  const frameW = MAXW;
  const frameH = Math.min(CAPMAX, Math.round(MAXW * aspect));
  const chromeBar = frame === "browser" ? 30 : 0;
  const bezel = frame === "phone" ? 12 : frame === "card" ? 0 : 0;

  const labelH = 26;
  const capH = (before.caption || after.caption) ? 26 : 0;
  const colW = frameW + 2 * bezel;
  const colH = labelH + chromeBar + frameH + 2 * bezel + capH;
  const width = 2 * colW + gap + 2 * margin;
  const height = colH + 2 * margin;

  const frameCss =
    frame === "phone"
      ? `border:${bezel}px solid #30363d;border-radius:26px;`
      : frame === "browser"
        ? `border:1px solid ${theme.border};border-radius:10px;`
        : `border:1px solid ${theme.border};border-radius:14px;`;

  const col = (side: DiffSide, info: ImgInfo, accent: string, fallbackLabel: string): string => {
    const label = escapeHtml(side.label ?? fallbackLabel);
    const cap = side.caption ? `<div class="cap" style="color:${accent}">${escapeHtml(side.caption)}</div>` : capH ? `<div class="cap"></div>` : "";
    const bar =
      frame === "browser"
        ? `<div class="bar"><span class="d" style="background:${theme.dots[0]}"></span><span class="d" style="background:${theme.dots[1]}"></span><span class="d" style="background:${theme.dots[2]}"></span></div>`
        : "";
    return `<div class="col">
      <div class="label" style="color:${accent}">${label}</div>
      <div class="frame" style="${frameCss}">${bar}
        <div class="scr"><img src="${info.dataUri}" alt=""></div>
      </div>
      ${cap}
    </div>`;
  };

  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;background:${theme.pageBg};}
  .wrap{box-sizing:border-box;width:${width}px;height:${height}px;padding:${margin}px;
    display:flex;gap:${gap}px;justify-content:center;align-items:flex-start;
    font-family:${theme.fontSans};}
  .col{width:${colW}px;text-align:center;}
  .label{height:${labelH}px;font-weight:700;font-size:15px;letter-spacing:.2px;}
  .frame{position:relative;width:${frameW}px;height:${frameH + chromeBar}px;overflow:hidden;
    background:${theme.card};box-shadow:0 24px 60px -22px rgba(0,0,0,.5);}
  .bar{height:${chromeBar}px;display:flex;align-items:center;gap:7px;padding:0 12px;
    border-bottom:1px solid ${theme.border};background:${theme.titlebar};}
  .d{width:11px;height:11px;border-radius:50%;}
  .scr{position:absolute;left:0;right:0;bottom:0;top:${chromeBar}px;display:flex;
    align-items:center;justify-content:center;}
  .scr img{max-width:100%;max-height:100%;width:auto;height:auto;display:block;}
  .cap{height:${capH}px;margin-top:10px;font:600 13px/1.4 ${theme.fontMono};}
</style></head>
<body><div class="wrap">
  ${col(before, bi, theme.before, "Before")}
  ${col(after, ai, theme.after, "After")}
</div></body></html>`;

  return { html, width, height };
}
