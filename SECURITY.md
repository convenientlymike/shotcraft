# Security Policy

## Reporting a vulnerability

Report privately via GitHub's **"Report a vulnerability"** (Security → Advisories)
on this repository, or open a minimal issue asking for a private channel (omit
exploit details).

## Scope & threat model

shotcraft is a local CLI with **zero runtime dependencies**. It:

- reads command output / images you point it at and writes a PNG you ask for;
- drives an **already-installed** Chrome/Chromium over the DevTools Protocol to
  rasterize HTML it generates — it never downloads or bundles a browser;
- makes **no network calls** of its own and collects **no telemetry**.

Notes:

- `term --run "<cmd>"` executes the command you give it (to capture its output),
  in your shell, with your environment. Only pass commands you trust — same as
  typing them yourself.
- Rendering runs Chrome headless with a fresh, throwaway profile in your temp dir
  and a mock keychain (`--use-mock-keychain`), so it touches no real profile or
  OS keychain.
- Pin the browser with `$SHOTCRAFT_CHROME` if you want to control exactly which
  binary is used.
