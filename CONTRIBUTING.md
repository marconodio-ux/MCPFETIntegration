# Contributing to MCP FET Integration

Thanks for helping make FET usable from ChatGPT, Claude, Gemini, and other MCP clients.

## Ground rules

1. **Respect FET’s license.** FET and this wrapper are **AGPL-3.0**. Do not add proprietary-only dependencies that block AGPL compliance.
2. **Keep FET upstream separate.** Do not commit `vendor/archives/` or `vendor/fet-src/` blobs. Use `npm run fetch-fet` and document pin bumps in `src/config.ts`, `vendor/README.md`, and `scripts/fetch-fet.*`.
3. **Prefer small, reviewable PRs.** One tool/feature or one fix per PR when possible.
4. **Never log to stdout** in the MCP server process — stdout is the JSON-RPC channel. Use `console.error`.
5. **Path safety.** Tools that accept file paths must stay under `data/` (or explicitly documented absolute paths).

## Development setup

```powershell
cd MCPFETIntegration
npm install
npm run fetch-fet          # downloads pinned FET-7.12.0 sources
npm run typecheck
npm run build
npm run dev                # stdio MCP server (for clients / Inspector)
```

Build `fet-cl` from the extracted FET sources (CMake + Qt), then:

```powershell
$env:FET_CL_PATH = "C:\path\to\fet-cl.exe"
npm run dev
```

## Project layout

| Path | Role |
|------|------|
| `src/index.ts` | MCP stdio entrypoint |
| `src/tools/register.ts` | MCP tool registration |
| `src/fet/` | FET CLI runner, job store, `.fet` summary |
| `scripts/fetch-fet.*` | Download/extract pinned FET archive |
| `config/*.example.json` | Sample MCP client configs |
| `examples/` | Small sample `.fet` for smoke tests |

## Adding a tool

1. Implement logic under `src/fet/` if it talks to FET or files.
2. Register with `server.registerTool(...)` in `src/tools/register.ts`.
3. Document the tool in `README.md`.
4. Run `npm run typecheck` and `npm run build`.

## Bumping FET

1. Check https://lalescu.ro/liviu/fet/ and https://github.com/lalesculiviu/fet for the newest archive.
2. Update version + commit SHA in `src/config.ts`, `scripts/fetch-fet.ps1`, `scripts/fetch-fet.sh`, `vendor/README.md`, `THIRD_PARTY.md`, and `NOTICE` if needed.
3. Run `npm run fetch-fet` and smoke-test `fet_status` / `fet_generate` against a sample.

## Commit messages

Use clear, imperative subjects, for example:

- `Add fet_export tool for HTML/CSV artifacts`
- `Pin FET to 7.12.0 archive commit c4f67a7`

## Publishing / GitHub

This repo is prepared locally. To publish:

1. Create an empty GitHub repository (do **not** initialize with README if you already have commits).
2. `git remote add origin https://github.com/<you>/MCPFETIntegration.git`
3. `git push -u origin main` (or your working branch)

See README → “Publishing to GitHub”.
