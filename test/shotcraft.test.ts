import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripAnsi, parseAnsi, segsToHtml } from "../src/ansi.js";
import { BRAND } from "../src/theme.js";
import { buildTerm } from "../src/term.js";
import { buildDiff } from "../src/diff.js";
import { renderHtml } from "../src/render.js";
import { resolveChrome } from "../src/chrome.js";

test("stripAnsi removes SGR codes", () => {
  assert.equal(stripAnsi("\x1b[31mred\x1b[0m text"), "red text");
});

test("parseAnsi maps basic colors to the theme ramp", () => {
  const segs = parseAnsi("\x1b[31mERR\x1b[0m ok", BRAND);
  const red = segs.find((s) => s.text === "ERR");
  assert.equal(red?.color, BRAND.ansi[1]); // brand red
  assert.ok(segs.some((s) => s.text.includes("ok") && !s.color));
});

test("parseAnsi handles xterm-256 + bold", () => {
  const segs = parseAnsi("\x1b[1;38;5;201mX\x1b[0m", BRAND);
  assert.equal(segs[0].bold, true);
  assert.match(segs[0].color ?? "", /^#[0-9a-f]{6}$/);
});

test("segsToHtml escapes + colors", () => {
  const html = segsToHtml(parseAnsi("\x1b[32m<a>\x1b[0m", BRAND));
  assert.match(html, /&lt;a&gt;/);
  assert.match(html, new RegExp(`color:${BRAND.ansi[2]}`));
});

test("buildTerm computes positive dims + embeds the (escaped) output + title", () => {
  const b = buildTerm("$ hello\nworld <x>", { title: "demo" });
  assert.ok(b.width > 0 && b.height > 0);
  assert.match(b.html, /demo/);
  assert.match(b.html, /world &lt;x&gt;/);
  // width should scale with the longest line
  const wide = buildTerm("x".repeat(120));
  assert.ok(wide.width > b.width);
});

test("buildDiff embeds both images as data URIs + labels", () => {
  const dir = mkdtempSync(join(tmpdir(), "shotcraft-test-"));
  try {
    const a = join(dir, "a.svg");
    const c = join(dir, "b.svg");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60"/></svg>`;
    writeFileSync(a, svg);
    writeFileSync(c, svg);
    const b = buildDiff({ image: a, label: "Old" }, { image: c, label: "New" }, { frame: "phone" });
    assert.match(b.html, /data:image\/svg\+xml;base64,/);
    assert.match(b.html, /Old/);
    assert.match(b.html, /New/);
    assert.ok(b.width > 0 && b.height > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The CDP renderer (explicit Browser.close, no --screenshot CLI) is version-proof,
// so it runs on every OS where a Chrome exists — including macOS CI.
const renderSkip = resolveChrome() ? false : "no Chrome/Chromium found";

test("renderHtml produces a transparent PNG", { skip: renderSkip }, async () => {
  const built = buildTerm("$ echo hi\nhi", { title: "render test" });
  const dir = mkdtempSync(join(tmpdir(), "shotcraft-out-"));
  try {
    const out = join(dir, "out.png");
    const r = await renderHtml(built.html, { width: built.width, height: built.height, out, scale: 2 });
    assert.equal(r.width, built.width * 2);
    assert.equal(r.height, built.height * 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
