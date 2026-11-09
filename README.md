# MCP FET Integration

Model Context Protocol (**MCP**) server that exposes [**FET**](https://lalescu.ro/liviu/fet/) — Liviu Lalescu’s free school/university **timetable generator** — as tools for **ChatGPT**, **Claude**, **Gemini**, Cursor, and other MCP clients.

This repository is the integration layer (TypeScript MCP server + docs). FET itself remains upstream software under **AGPL-3.0**.

## Why TypeScript?

| Option | Fit |
|--------|-----|
| **TypeScript (chosen)** | Official MCP server SDK is mature; easy stdio packaging for desktop clients; natural fit for spawning `fet-cl`, watching job files, and serving HTML/CSV paths. |
| Python | Also fine for CLI wrappers; skipped so we stay on the primary MCP TypeScript SDK used by most client examples. |

FET’s heavy solver stays in **C++/Qt** (`fet-cl`). This MCP server owns the editable `.fet` XML model and orchestrates generation around that binary.

## FET upstream pin

| Field | Value |
|-------|--------|
| Homepage | https://lalescu.ro/liviu/fet/ |
| Official GitHub (release archives) | https://github.com/lalesculiviu/fet |
| Pinned release | **FET-7.12.0** |
| Pinned commit | `c4f67a7b9a430033133cab602d60d85e90ccbd86` (`FET-7.12.0`, 2026-10-14) |
| License | AGPL-3.0 |

> The GitHub repo stores release **archives**, not an incremental source tree. Use `npm run fetch-fet` (see `vendor/README.md`). Do not commit the multi‑GB archive history.

Configurable feature map: `docs/fet-configurable-features.md`. Assignment text → `.fet`: `docs/fet-from-assignments.md`. Natural language → timetable: `docs/fet-nl-timetable.md`. Private-sample NL coverage notes: `docs/private-sample-nl-coverage.md` (real `.fet` only outside the repo, never published). Constraint advisor: `docs/fet-advise.md`. ChatGPT packaging + Streamable HTTP bridge: `docs/chatgpt-mcp-plugin.md`. Failed generate diagnosis: `docs/fet-diagnose.md`.

## MCP tool surface (v0.7 — intelligent constraint advisor)

Design: a **small meta-tool set** over a round-trip XML document model, plus `fet-cl` job tools. All **275 time + 82 space + 1 generation-option** constraint types from FET 7.12 are addressable by name (no 357 hard-coded handlers). **v0.3** adds generation from structured Italian assignment lines. **v0.4** explains blocking constraints when generation fails (`fet_diagnose`). **v0.5** adds **`fet_nl_build` / `fet_nl_patch`**. **v0.6** adds full NL phrase coverage (358 live) + ChatGPT packaging. **v0.7** adds **`fet_advise` / `fet_advise_apply`**: heuristics grounded in IT school practice recommend MinDays, SameStartingTime, PreferredRoom, BreakTimes, MaxHoursDaily, NotAvailable, Consecutive, … even when the user does not know the FET type name. The advisor **proposes**; **FET still generates** the timetable. The MCP is **not** the chat LLM — ChatGPT/Claude/Gemini/Cursor call these tools. Real institute `.fet` stay **outside** this repository (never committed, never advertised to ChatGPT).

### Documents (workspace)

| Tool | Purpose |
|------|---------|
| `fet_document_new` | Create Official/MA/Block/Terms document with basic compulsory constraints |
| `fet_document_open` | Load `.fet` into an editable workspace `documentId` |
| `fet_document_save` | Round-trip save (UTF-8 BOM) |
| `fet_document_list` / `fet_document_close` / `fet_document_summary` | Workspace management |
| `fet_meta_get` / `fet_meta_set` | Mode, institution, comments, Terms counters, version attr |

### Entities (CRUD by kind)

| Tool | Purpose |
|------|---------|
| `fet_entity_kinds` | `days`, `hours`, `real_days`, `real_hours`, `subjects`, `activity_tags`, `teachers`, `students`, `activities`, `buildings`, `rooms` |
| `fet_entity_list` / `fet_entity_get` | Read entities as JSON fields mirroring XML children |
| `fet_entity_upsert` / `fet_entity_remove` | Insert/update/delete |
| `fet_entity_set_list` | Replace days/hours(/real_*) name lists in one call |

`students` uses the FET hierarchy: `Year` → `Group` → `Subgroup` (nested in `fields`).

### Constraints (schema-driven, full catalog)

| Tool | Purpose |
|------|---------|
| `fet_constraint_catalog` | List/filter all 358 catalog types (mode/family/IT description) |
| `fet_constraint_schema` | XML tag hints for one type (from `getXmlDescription`) |
| `fet_constraint_list` / `fet_constraint_get` | Inspect constraints in a document |
| `fet_constraint_add` / `fet_constraint_update` / `fet_constraint_remove` | Mutate any catalog type via `{ type, fields }` |

`fields` mirrors FET XML: leaf tags → strings, repeated tags → arrays, nested blocks → objects/arrays of objects. Common tags: `Weight_Percentage`, `Active`, `Comments`.

### From teacher assignments (v0.3)

| Tool | Purpose |
|------|---------|
| `fet_parse_assignments` | Parse IT/plain-text (or JSON) workloads → structured rows + ambiguities |
| `fet_from_assignments` | Build Official `.fet` in workspace (Teachers/Subjects/Year→Group/Activities/MinDays); optional `savePath` |

Sample: `examples/from-assignments/`. Mapping rules: `docs/fet-from-assignments.md`.

### Natural language timetable (v0.5–v0.6)

| Tool | Purpose |
|------|---------|
| `fet_nl_parse` | Free-form Italian (or structured intent) → assignments, class splits, constraints, `gaps.ask` |
| `fet_nl_build` | Build Official `.fet` with Year→Group→**Subgroup**, weekly MinDays, parallel SameStartingTime |
| `fet_nl_extract` | Real `.fet` → entities + Italian constraint digest + live/stub coverage |
| `fet_describe_constraints` | Constraint instances → Italian descriptions |
| `fet_nl_phrase_catalog` | 358 phrase templates live (hand-tuned overlays on common school types) + parse helper |
| `fet_nl_patch` | Conversational add/change/remove on an existing workspace `documentId` |

Sample: `examples/from-nl/` (Antonio scenario). Mapping + known gaps: `docs/fet-nl-timetable.md`.

### Constraint advisor (v0.7)

| Tool | Purpose |
|------|---------|
| `fet_advise` | Analyze document / `.fet` (+ optional IT intent text) → ranked constraint suggestions with Italian why + `fieldsDraft` + confidence |
| `fet_advise_apply` | Apply accepted suggestion ids, or all high-confidence; may create missing LAB rooms |

Sample: `examples/advise/`. Guide: `docs/fet-advise.md`. Reminder: advisor proposes constraints; `fet_generate` still builds the timetable.

### Diagnose blockers (v0.4)

| Tool | Purpose |
|------|---------|
| `fet_diagnose` | Static heuristics + optional `fet-cl` / `logs/` → Italian blocker + suggested fix + catalog types |
| `fet_generate` `diagnoseOnFail` | On failed wait=true generate, attach the same diagnosis |

Sample conflict: `examples/diagnose/`. Guide: `docs/fet-diagnose.md`.

### Generation / I/O

| Tool | Purpose |
|------|---------|
| `fet_status` | Server + FET pin + catalog counts + `fet-cl` + workspace docs |
| `fet_load_data` | Copy a `.fet` into `data/input` and summarize |
| `fet_validate` | Structured XML summary (no solver) |
| `fet_generate` | Run `fet-cl` (`wait=false` for async; diagnosis on fail by default) |
| `fet_job_status` | Poll / list jobs |
| `fet_export` | List/read HTML, XML, CSV, logs under an output dir |
| `fet_list_examples` | Sample `.fet` paths |

### Typical flows

**A. From linguaggio naturale (classi spezzate, modifiche)**

1. `fet_nl_build` with Italian prose (or `fet_nl_parse` first)
2. If `gaps` → ask the user using `gaps[].ask`, then `fet_nl_patch` / rebuild with filled `intent`
3. Optional: `fet_advise` → review suggestions → `fet_advise_apply`
4. `fet_document_save` → `fet_generate` → `fet_diagnose` if needed

**B. From incarichi riga-per-riga**

1. `fet_from_assignments` with Italian assignment text (ask on `ambiguities` if needed)
2. `fet_document_summary` / refine with `fet_entity_*` / `fet_constraint_*`
3. `fet_document_save` → `fet_generate`
4. If failed: read `diagnosis` or call `fet_diagnose`

**C. Manual edit → generate**

1. `fet_document_new` or `fet_document_open`
2. `fet_entity_upsert` (subjects, teachers, students, activities, rooms, …)
3. `fet_constraint_schema` → `fet_constraint_add` as needed
4. `fet_document_save` → `data/input/….fet`
5. `fet_generate` → `fet_job_status` / `fet_export` / `fet_diagnose`

```powershell
npm run smoke:nl      # examples/from-nl → antonio-from-nl.fet
npm run smoke:advise  # stripped Antonio sample → advise + apply
```

## Quick start (Windows)

```powershell
cd "C:\path\to\MCPFETIntegration"
npm install
npm run fetch-fet   # if vendor/fet-src is missing
npm run generate-catalog   # regenerate constraint catalog from FET headers (already committed)
npm run build
```

### Install `fet-cl` (Windows)

Official Liviu package (no Qt toolchain required):

```powershell
npm run fetch-fet-windows
# → vendor\bin\fet-7.12.0\fet-cl.exe
$env:FET_CL_PATH = "C:\path\to\MCPFETIntegration\vendor\bin\fet-7.12.0\fet-cl.exe"
```

Alternatively build from `vendor/fet-src/fet-7.12.0/` (CMake + Qt 6, C++17) per FET’s `README`.

### Run the MCP server (stdio)

```powershell
npm run start
# or during development:
npm run dev
```

The process waits on stdin for an MCP client. Logs go to **stderr** only.

### Run the Streamable HTTP bridge (ChatGPT / remote MCP)

ChatGPT cloud cannot speak stdio to this PC. Run the local bridge on loopback, then connect ChatGPT via **Secure MCP Tunnel** (`tunnel_id`) or an opt-in HTTPS tunnel — **not** by pasting `http://127.0.0.1…` (ChatGPT rejects it).

```powershell
$env:FET_CL_PATH = "C:\path\to\MCPFETIntegration\vendor\bin\fet-7.12.0\fet-cl.exe"
$env:MCP_HTTP_TOKEN = "long-secret"   # required if MCP_HTTP_ALLOWED_HOSTS is set
npm run mcp:http
# health (local only): http://127.0.0.1:3847/health
# opt-in public HTTPS URL helper: npm run mcp:http:tunnel -- -IUnderstandPublicExposure
```

See `docs/chatgpt-mcp-plugin.md` (rejected-settings error, Tunnel vs URL). Smoke: `npm run smoke:http`.

## Connect clients

Example configs live in `config/`. Replace the absolute path with your machine path.

### Claude Desktop / Claude MCP

```json
{
  "mcpServers": {
    "fet": {
      "command": "node",
      "args": [
        "C:\\path\\to\\MCPFETIntegration\\build\\index.js"
      ],
      "env": {
        "FET_CL_PATH": "C:\\path\\to\\fet-cl.exe"
      }
    }
  }
}
```

See `config/mcp.claude.example.json`, `config/mcp.chatgpt.example.json`, `config/mcp.gemini.example.json`.

### Cursor

Ready snippet: `config/mcp.cursor.json` (merge `fet` into `%USERPROFILE%\.cursor\mcp.json`).

## Repository layout

```
MCPFETIntegration/
  src/                 TypeScript MCP server + FetDocument model
  src/fet/catalog/     Generated constraint catalog (358 types)
  scripts/             fetch-fet, generate-catalog, copy-catalog
  vendor/              FET pin docs (+ local extracted sources, gitignored)
  examples/            Sample .fet + from-assignments + from-nl + advise + diagnose conflict
  data/                Runtime input/output/jobs (gitignored contents)
  docs/                Feature catalog + NL + advise + diagnose guides
  config/              Example MCP client configs
  LICENSE              AGPL-3.0
  NOTICE               Attribution
  CONTRIBUTING.md
```

## License and attribution

- **This project:** AGPL-3.0-only (`LICENSE`)
- **FET:** AGPL-3.0 by Liviu Lalescu — see `NOTICE` and `THIRD_PARTY.md`

If you deploy this as a network service that users interact with, AGPL requires you to offer Corresponding Source.

## GitHub

Public repository: **https://github.com/marconodio-ux/MCPFETIntegration**

Real institute `.fet` are kept outside this repo (and `private/` is gitignored with no tracked exceptions). `node_modules/`, `vendor/bin|archives|fet-src/`, and secrets stay gitignored and are not published. Public `main` has no real institute `.fet` blobs.

## Status

**v0.7.0 — Constraint advisor:** `fet_advise` / `fet_advise_apply` recommend and optionally write catalog constraints (MinDays, SameStartingTime, PreferredRoom, …) from school heuristics. Advisor proposes; FET generates. Built on v0.6 full-catalog NL, v0.5 NL build/patch, v0.4 diagnose, v0.3 from-assignments.
