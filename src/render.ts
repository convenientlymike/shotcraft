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
 * Robustness (every line paid for in June 2026): hardened launch flags (mock keychain,
 * no background networking, no /dev/shm), a fresh $TMPDIR profile, file:// navigation,
 * Chrome stderr captured to a log and surfaced on failure, and — critically — the whole
 * flow races a hard timeout and rejects (never hangs) if Chrome/CDP goes unresponsive.
 */
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  openSync,
  closeSync,
} from "node:fs";
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

const CALL_TIMEOUT = 15_000;
const TOTAL_TIMEOUT = 35_000;

/** Minimal CDP client over the browser-level WebSocket — every call settles. */
class Cdp {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
  private closedErr: Error | null = null;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (ev: MessageEvent) => {
      const m = JSON.parse(ev.data as string);
      if (m.id && this.pending.has(m.id)) {
        this.pending.get(m.id)!.resolve(m);
        this.pending.delete(m.id);
      }
    };
    const fail = (e: Error) => {
      this.closedErr = e;
      for (const { reject } of this.pending.values()) reject(e);
      this.pending.clear();
    };
    this.ws.onclose = () => fail(new Error("CDP connection closed"));
    this.ws.onerror = () => fail(new Error("CDP connection error"));
  }
  open(): Promise<void> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("CDP websocket open timed out")), CALL_TIMEOUT);
      this.ws.onopen = () => {
        clearTimeout(t);
        res();
      };
      this.ws.onerror = () => {
        clearTimeout(t);
        rej(new Error("CDP websocket failed to open"));
      };
    });
  }
  send(method: string, params?: object, sessionId?: string): Promise<any> {
    if (this.closedErr) return Promise.reject(this.closedErr);
    const id = ++this.id;
    const msg: Record<string, unknown> = { id, method, params: params ?? {} };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out: ${method}`));
      }, CALL_TIMEOUT);
      this.pending.set(id, {
        resolve: (m) => {
          clearTimeout(t);
          resolve(m.result);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (e) {
        clearTimeout(t);
        reject(e as Error);
      }
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
  const logFd = openSync(logPath, "w");
  const proc = spawn(chrome, [...LAUNCH_FLAGS, `--user-data-dir=${profile}`, "about:blank"], {
    stdio: ["ignore", "ignore", logFd],
  });
  let cdp: Cdp | undefined;
  const killProc = () => {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  };

  const work = (async (): Promise<RenderResult> => {
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
    // file:// (not data:) — diff embeds base64 images that overflow a data-URL; $TMPDIR
    // isn't TCC-protected so file:// there raises no macOS folder prompt.
    const page = join(profile, "page.html");
    writeFileSync(page, html);
    await cdp.send("Page.navigate", { url: pathToFileURL(page).href }, sessionId);
    await delay(350);
    const shot = await cdp.send(
      "Page.captureScreenshot",
      { format: "png", clip: { x: 0, y: 0, width: w, height: h, scale: 1 }, captureBeyondViewport: true },
      sessionId,
    );
    if (!shot?.data) throw new Error("Chrome returned no screenshot data");
    writeFileSync(out, Buffer.from(shot.data, "base64"));
    await cdp.send("Browser.close").catch(() => {});
    return { out, width: w * scale, height: h * scale, chrome };
  })();

  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error(`render timed out after ${TOTAL_TIMEOUT}ms`)), TOTAL_TIMEOUT),
  );

  try {
    return await Promise.race([work, timeout]);
  } catch (err) {
    work.catch(() => {}); // swallow the losing race branch
    let detail = (err as Error).message;
    try {
      const log = readFileSync(logPath, "utf8").trim();
      if (log) detail += "\n  chrome: " + log.split("\n").slice(-4).join("\n  chrome: ");
    } catch {
      /* no log */
    }
    throw new Error(`render failed: ${detail}`);
  } finally {
    cdp?.close();
    killProc();
    try {
      closeSync(logFd);
    } catch {
      /* already closed */
    }
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      /* OS reclaims it */
    }
  }
}
