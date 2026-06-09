# Changelog

All notable changes to shotcraft are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-06

Initial release.

### Added
- **`term`** — render real command output (or piped stdin) as a styled "terminal
  window" PNG: window chrome, monospace body, and ANSI colors remapped onto the brand
  ramp. `--run "<cmd>"` captures a command with color forced on; `--cols` wraps long
  lines; `--title`, `--font-size`. Dimensions are computed from monospace metrics, so
  the screenshot is tight (no cropping).
- **`diff`** — before/after comparison of two images with colored labels + captions and
  a `card` / `phone` / `browser` frame. Images are embedded so Chrome touches no files.
- **Version-proof renderer** — drives an installed Chrome over the DevTools Protocol
  with an explicit `Browser.close` (no fragile `--screenshot` CLI), hardened against the
  macOS keychain prompt, the GCM/background-networking hang, and temp-cleanup races.
- Zero runtime dependencies; cross-platform (macOS · Linux · Windows); `--scale` for
  Retina-crisp output; transparent background.
