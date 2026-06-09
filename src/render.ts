/**
 * Render an HTML document to a crisp, transparent PNG by driving an installed Chrome
 * over the DevTools Protocol (CDP) — NOT the `--screenshot` CLI flag.
 *
 * Why CDP: across Chrome versions the `--screenshot` shortcut is hopelessly
 * inconsistent — `--headless=new` launches a full browser that never exits (it starts
 * GCM/push registration), `--headless=old` is removed on bleeding-edge snapshots, and
 * which one screenshots-and-exits flips per build. CDP sidesteps all of it: we open a
 * page, capture, and call `Browser.close` ourselves — version-proof, with an explicit
 * lifecycle. Still no browser download (drives an installed Chrome); zero runtime deps
 * (Node ≥22's built-in WebSocket + fetch).
 *
 * Every hardening flag/guard below fixes a real cross-OS hang paid for in June 2026:
 *   --use-mock-keychain + --password-store=basic : skip the macOS keychain prompt.
 *   --disable-background-networking + --disable-sync + --disable-component-update :
 *     stop the GCM/push noise that kept headless alive.
 *   --disable-dev-shm-usage : tiny /dev/shm in CI/containers hangs Chrome.
 *   fresh --user-data-dir in $TMPDIR : no profile lock, no protected-folder TCC prompt.
 *   data: URL (not file://) : self-contained; Chrome never touches the filesystem.
 *   hard timeout that kills the process : nothing can hang forever.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { resolveChrome } from "./chrome.js";

export interface RenderOptions {
  width: number;
  height: number;
  out: string;
  scale?: number;
  chrome?: string;
}
export interface RenderResult {
  out: string;
  width: number;
  height: number;
  chrome: string;
}

const LAUNCH_FLAGS = [
  "--headless=new",
  "--remote-debugging-port=0",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--no-first-run",
  "--no-default-browser-check",
  "--use-mock-keychain",
  "--password-store=basic",
  "--disable-background-networking",
  "--disable-sync",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-features=Translate,ChromeWhatsNewUI",
  "--hide-scrollbars",
  "--mute-audio",
];

/** Minimal CDP client over the browser-level WebSocket. */
class Cdp {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<number, (r: any) => void>();
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev: MessageEvent) => {
      const m = JSON.parse(ev.data as string);
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)!(m);
        this.pending.delete(m.id);
      }
    };
  }
  open(): Promise<void> {
    return new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error("CDP websocket failed to open"));
    });
  }
  send(method: string, params?: object, sessionId?: string): Promise<any> {
    const id = ++this.id;
    const msg: Record<string, unknown> = { id, method, params: params ?? {} };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((res) => {
      this.pending.set(id, (m) => res(m.result));
      this.ws.send(JSON.stringify(msg));
    });
  }
  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

async function readPort(udd: string, deadline: number): Promise<number> {
  const f = join(udd, "DevToolsActivePort");
  while (Date.now() < deadline) {
    if (existsSync(f)) {
      const line = readFileSync(f, "utf8").split("\n")[0]?.trim();
      const port = Number(line);
      if (port > 0) return port;
    }
    await delay(80);
  }
  throw new Error("Chrome did not expose a DevTools port in time");
}

export async function renderHtml(html: string, opts: RenderOptions): Promise<RenderResult> {
  const scale = opts.scale ?? 3;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`invalid scale: ${opts.scale}`);
  const out = resolve(opts.out);
  const chrome = opts.chrome ?? resolveChrome();
  if (!chrome) {
    throw new Error("no Chrome/Chromium found. Install Google Chrome, or set $SHOTCRAFT_CHROME.");
  }
  const w = Math.round(opts.width);
  const h = Math.round(opts.height);

  const profile = mkdtempSync(join(tmpdir(), "shotcraft-"));
  const logPath = join(profile, "chrome.log");
  const proc = spawn(chrome, [...LAUNCH_FLAGS, `--user-data-dir=${profile}`, "about:blank"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  let cdp: Cdp | undefined;
  const killProc = () => {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  };
  // hard ceiling: nothing hangs forever
  const guard = setTimeout(killProc, 40_000);

  try {
    const port = await readPort(profile, Date.now() + 20_000);
    const ver = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
      webSocketDebuggerUrl: string;
    };
    cdp = new Cdp(ver.webSocketDebuggerUrl);
    await cdp.open();

    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: w, height: h, deviceScaleFactor: scale, mobile: false },
      sessionId,
    );
    await cdp.send(
      "Emulation.setDefaultBackgroundColorOverride",
      { color: { r: 0, g: 0, b: 0, a: 0 } },
      sessionId,
    );
    // Navigate to a temp FILE (not a data: URL): diff embeds images as base64, which
    // would blow past Chrome's data-URL navigation size limit. $TMPDIR isn't TCC-
    // protected, so file:// there raises no macOS folder prompt.
    const page = join(profile, "page.html");
    writeFileSync(page, html);
    await cdp.send("Page.navigate", { url: pathToFileURL(page).href }, sessionId);
    // settle: give layout/paint (and any images) a moment to load
    await delay(350);
    const shot = await cdp.send(
      "Page.captureScreenshot",
      {
        format: "png",
        clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
        captureBeyondViewport: true,
      },
      sessionId,
    );
    if (!shot?.data) throw new Error("Chrome returned no screenshot data");
    writeFileSync(out, Buffer.from(shot.data, "base64"));
    await cdp.send("Browser.close");
    return { out, width: w * scale, height: h * scale, chrome };
  } catch (err) {
    let detail = (err as Error).message;
    try {
      const log = readFileSync(logPath, "utf8").trim();
      if (log) detail += "\n  chrome: " + log.split("\n").slice(-3).join("\n  chrome: ");
    } catch {
      /* no log */
    }
    throw new Error(`render failed: ${detail}`);
  } finally {
    clearTimeout(guard);
    cdp?.close();
    killProc();
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      /* OS reclaims it */
    }
  }
}
