# FET vendor dependency

This project integrates **FET** (Free Educational Timetabling) by **Liviu Lalescu**.

| Item | Value |
|------|--------|
| Homepage | https://lalescu.ro/liviu/fet/ |
| Official GitHub (release archives) | https://github.com/lalesculiviu/fet |
| Pinned release | **FET-7.12.0** |
| Pinned commit | `c4f67a7b9a430033133cab602d60d85e90ccbd86` (message: `FET-7.12.0`, 2026-10-14) |
| License | GNU Affero General Public License v3 (AGPL-3.0) |

## Important

Liviu does not maintain FET as an incremental Git source tree. The GitHub repo stores **official `tar.xz` / `tar.bz2` archives** of each release. The authoritative distribution is also on the homepage above.

We therefore **do not** vendor the entire GitHub history (hundreds of archives, ~2+ GB). Instead:

1. Run `npm run fetch-fet` (or `scripts/fetch-fet.ps1` / `scripts/fetch-fet.sh`).
2. That downloads `fet-7.12.0.tar.xz` into `vendor/archives/` and extracts sources to `vendor/fet-src/fet-7.12.0/` (pin recorded in `vendor/FET_PIN.json`).
3. **Windows (recommended):** `npm run fetch-fet-windows` downloads the official `fet-7.12.0.exe` (SHA256 in `vendor/FET_WINDOWS.json`), extracts with 7-Zip to `vendor/bin/fet-7.12.0/`, and yields `fet-cl.exe`.
4. Or build from sources with CMake + Qt to obtain `fet-cl`.
5. Point the MCP server at the binary with `FET_CL_PATH` if auto-discovery misses it (Cursor config: `config/mcp.cursor.json`).

`vendor/archives/`, `vendor/fet-src/`, and `vendor/bin/` are gitignored so this repository stays publishable.

## Optional full clone (local only)

```powershell
git clone https://github.com/lalesculiviu/fet.git vendor/fet-upstream
```

Expect a multi-gigabyte working tree of historical archives.
