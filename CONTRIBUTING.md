# Contributing to shotcraft

Thanks for helping make better README images.

## Ground rules
- **Zero runtime dependencies.** Dev deps (TypeScript, tsx) are fine; runtime deps
  are not — the value is "drop-in, no supply chain."
- **Cross-platform.** Must run on macOS, Linux, and Windows. Use `node:path`/`node:os`
  for paths and temp dirs; never hardcode `/tmp`, `~`, or `\`. CI runs the full matrix.
- **Render over CDP, never the `--screenshot` CLI.** That flag is version-fragile
  (see `src/render.ts`); shotcraft drives Chrome over the DevTools Protocol with an
  explicit `Browser.close`, which is version-proof. It must never download a browser.
- **Node ≥22** (built-in `WebSocket` + `fetch`).

## Workflow
```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test          # node:test (render tests skip if no Chrome is installed)
pnpm dev -- term --run "ls -la" --title demo   # run the CLI from source
```

1. Branch from `main`.
2. Keep `pnpm typecheck && pnpm build && pnpm test` green.
3. Conventional-commit message (`feat:`, `fix:`, `docs:`, `chore:`) explaining the *why*.
4. Open a PR; the cross-OS CI matrix must be green.

## Adding a theme
Add a `Theme` to `src/theme.ts` (palette + the ANSI-16 → brand mapping) and register
it in `THEMES`. Cover the ANSI mapping with a test.
