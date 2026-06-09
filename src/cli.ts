#!/usr/bin/env node
/**
 * shotcraft — turn real terminal output or a before/after into a brand-matched PNG.
 *
 *   shotcraft term  [--run "<cmd>" | <stdin>] [--title T] [-o out.png]
 *   shotcraft diff  --before <img> --after <img> [--frame card|phone|browser] [-o out.png]
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { buildTerm } from "./term.js";
import { buildDiff } from "./diff.js";
import { renderHtml } from "./render.js";

const VERSION = "0.1.0";
const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", c: "\x1b[36m", g: "\x1b[32m" };
const tty = process.stdout.isTTY && process.env.NO_COLOR == null;
const p = (s: string, code: string) => (tty ? code + s + C.r : s);

function usage(): void {
  process.stdout.write(`${p("shotcraft", C.b + C.c)} — real output / before-after → a brand-matched PNG

${p("USAGE", C.b)}
  shotcraft term [out.png] [options]      style command output as a terminal PNG
  shotcraft diff [out.png] --before A --after B [options]   before/after comparison

${p("term OPTIONS", C.b)}
  --run "<cmd>"     run a command and capture its output (else reads stdin)
  --title "<text>"  window title text
  --cols <n>        wrap long lines at N columns (default: no wrap)
  --font-size <n>   monospace size in px (default 15)

${p("diff OPTIONS", C.b)}
  --before <img>    "before" image (svg/png/jpg)        --before-label / --before-caption
  --after  <img>    "after" image                       --after-label  / --after-caption
  --frame <kind>    card (default) · phone · browser

${p("COMMON", C.b)}
  -o, --out <file>  output PNG (default: shot.png / before-after.png)
  -s, --scale <n>   device-scale-factor (default 3 — crisp on Retina)
  --theme <name>    color theme (default: brand)
  --chrome <path>   explicit Chrome/Chromium binary
  -h, --help        ·  -v, --version

Drives an already-installed Chrome (never downloads one); set \$SHOTCRAFT_CHROME to pin it.
${p("https://github.com/convenientlymike/shotcraft", C.d)}
`);
}

interface Args {
  _: string[];
  [key: string]: string | boolean | string[] | undefined;
}
function parse(argv: string[]): Args {
  const a: Args = { _: [] };
  const flags = new Set([
    "run", "title", "font-size", "cols", "out", "o", "scale", "s", "theme", "chrome",
    "before", "after", "before-label", "after-label", "before-caption", "after-caption", "frame",
  ]);
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "-h" || t === "--help") a.help = true;
    else if (t === "-v" || t === "--version") a.version = true;
    else if (t.startsWith("--") && flags.has(t.slice(2))) a[t.slice(2)] = argv[++i];
    else if (t === "-o") a.out = argv[++i];
    else if (t === "-s") a.scale = argv[++i];
    else if (t.startsWith("-")) throw new Error(`unknown option: ${t}`);
    else a._.push(t);
  }
  return a;
}

function commonOpts(a: Args) {
  return {
    out: (a.out as string) || (a.o as string),
    scale: a.scale ? Number(a.scale) : undefined,
    chrome: a.chrome as string | undefined,
    theme: a.theme as string | undefined,
  };
}

async function cmdTerm(a: Args): Promise<number> {
  let output: string;
  if (a.run) {
    const res = spawnSync(a.run as string, {
      shell: true,
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "1", CLICOLOR_FORCE: "1" },
      maxBuffer: 16 * 1024 * 1024,
    });
    output = (res.stdout || "") + (res.stderr || "");
    if (!output.trim()) throw new Error(`--run produced no output: ${a.run}`);
  } else {
    output = readFileSync(0, "utf8"); // stdin
    if (!output.trim()) throw new Error("no input on stdin (use --run \"<cmd>\" or pipe output in)");
  }
  const built = buildTerm(output, {
    title: a.title as string | undefined,
    theme: a.theme as string | undefined,
    fontSize: a["font-size"] ? Number(a["font-size"]) : undefined,
    cols: a.cols ? Number(a.cols) : undefined,
  });
  const co = commonOpts(a);
  const r = await renderHtml(built.html, { width: built.width, height: built.height, out: co.out || (a._[0] as string) || "shot.png", scale: co.scale, chrome: co.chrome });
  process.stdout.write(`${p("✓", C.g)} ${p(r.out, C.b)}  ${r.width}×${r.height}\n`);
  return 0;
}

async function cmdDiff(a: Args): Promise<number> {
  if (!a.before || !a.after) throw new Error("diff needs --before <img> and --after <img>");
  const built = buildDiff(
    { image: a.before as string, label: a["before-label"] as string, caption: a["before-caption"] as string },
    { image: a.after as string, label: a["after-label"] as string, caption: a["after-caption"] as string },
    { theme: a.theme as string | undefined, frame: (a.frame as "card" | "phone" | "browser") || undefined },
  );
  const co = commonOpts(a);
  const r = await renderHtml(built.html, { width: built.width, height: built.height, out: co.out || (a._[0] as string) || "before-after.png", scale: co.scale, chrome: co.chrome });
  process.stdout.write(`${p("✓", C.g)} ${p(r.out, C.b)}  ${r.width}×${r.height}\n`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd == null || cmd === "help" || cmd === "-h" || cmd === "--help") {
    usage();
    return 0;
  }
  if (cmd === "-v" || cmd === "--version") {
    process.stdout.write(VERSION + "\n");
    return 0;
  }
  const a = parse(rest);
  if (a.help) {
    usage();
    return 0;
  }
  if (cmd === "term") return cmdTerm(a);
  if (cmd === "diff") return cmdDiff(a);
  process.stderr.write(p(`unknown command: ${cmd}\n\n`, "\x1b[31m"));
  usage();
  return 2;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`\x1b[31merror:\x1b[0m ${(err as Error).message}\n`);
    process.exit(1);
  });
