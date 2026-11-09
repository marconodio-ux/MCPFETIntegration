# Private sample → NL coverage

**Privacy:** any real institute `.fet` stays **outside** this repository and is never advertised to ChatGPT. Point the local smoke at it with `MCPFET_PRIVATE_DIR` (and optional `MCPFET_PRIVATE_FET`).

Server MCP **v0.7**. Smoke: `npm run smoke:private-sample` (skips if no private sample is configured).

## What this proves

A private local `.fet` was used only on the host machine to verify that every constraint **type** present in that file has a live Italian NL handler (hand-tuned overlays in `sampleLive.ts`, plus schema-driven handlers for the rest of the FET 7.12 catalog).

Public docs intentionally omit entity inventories, teacher/class names, and absolute paths from that private file.

### Priority overlay types (must stay 100% live)

These FET constraint type names are public FET vocabulary (not school data). They are the hand-tuned priority set exposed as `prioritySampleTypes` in NL tools:

| Tipo | Kind |
|------|------|
| ConstraintBasicCompulsoryTime | time |
| ConstraintBreakTimes | time |
| ConstraintActivitiesSameStartingTime | time |
| ConstraintStudentsSetNotAvailableTimes | time |
| ConstraintTeacherNotAvailableTimes | time |
| ConstraintMinDaysBetweenActivities | time |
| ConstraintTeachersMaxHoursDaily | time |
| ConstraintTwoActivitiesConsecutive | time |
| ConstraintActivityPreferredStartingTime | time |
| ConstraintActivityPreferredStartingTimes | time |
| ConstraintTeacherMaxHoursDaily | time |
| ConstraintBasicCompulsorySpace | space |
| ConstraintSubjectPreferredRoom | space |
| ConstraintSubjectPreferredRooms | space |
| ConstraintRoomNotAvailableTimes | space |
| ConstraintActivityPreferredRoom | space |

## Tool NL

| Tool | Ruolo |
|------|--------|
| `fet_nl_parse` / `fet_nl_build` / `fet_nl_patch` | Prosa + `intent.constraints[]` → campi FET |
| `fet_nl_extract` | `.fet` → entità + vincoli strutturati + italiano + matrice coverage |
| `fet_describe_constraints` | Vincoli → descrizione italiana live |
| `fet_nl_phrase_catalog` | template live + `parseText` |

## Round-trip smoke (local only)

1. Set `MCPFET_PRIVATE_DIR` to a folder **outside** the git repo (optional `MCPFET_PRIVATE_FET` filename).
2. `extractFromDocument` → every present type described in Italian.
3. Remove constraints → re-apply one instance per type via parse / italian / `fromStructured`.
4. Entities unchanged; re-extract reports all present types live.
5. Write roundtrip outputs back into the private folder (never into the public tree).

### Lock Active=false

`ConstraintActivityPreferredStartingTime` with `Permanently_Locked=true` and `Active=false` are **prior-solution artifacts**. Extract marks them `solutionLockArtifact`; FET ignores them during generation.

## Catalogo globale

See `docs/fet-nl-full-catalog-coverage.md` for the full 358-type live catalog. Priority overlays live in `sampleLive.ts`; other types use `schemaLive.ts`.

## Flusso prodotto

Conversazione italiana → `fet_nl_build` / patch → (opz. `fet_nl_extract`) → `fet_generate` → se fallisce `fet_diagnose`.  
Plugin ChatGPT: `docs/chatgpt-mcp-plugin.md`.
