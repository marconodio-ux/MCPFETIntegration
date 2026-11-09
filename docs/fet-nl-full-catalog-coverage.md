# FET NL full catalog coverage (MFI-11)

Progetto: `C:\path\to\MCPFETIntegration`  
Server MCP **v0.6.0**. Smoke catalogo: `npm run smoke:catalog-nl`. Smoke sample: `npm run smoke:private-sample`.

## Proof: 358 / 358 live

| | Count |
|--|------:|
| Tipi in `constraint-catalog.json` | **358** |
| Phrase templates `status=live` | **358** |
| Stub rimanenti | **0** |
| Hand-tuned school-type overlay | 16 / 16 live |

Smoke batch (`scripts/smoke-catalog-nl-live.mjs`):

1. Carica tutti i 358 tipi dal catalogo.
2. Per ciascuno: `examplesIt[0]` → `parseIt` → `describe` → `fromStructured`.
3. Round-trip globale con prefisso `ConstraintX: …` via `parseConstraintPhrase`.
4. Verifica overlay priority: esempi naturali ancora parsati.

Output: `examples/real/catalog-nl-live.summary.json` (`ok: true`, `live: 358`, `stub: 0`).

## Architettura NL

| Layer | Ruolo |
|-------|--------|
| `schemaLive.ts` | Genera live IT↔campi↔describe da schema XML (`getXmlDescription` / catalog fields + containers) per **ogni** `Constraint*` + `GroupActivitiesInInitialOrder`. |
| `sampleLive.ts` | Overlay italiano specializzato per 16 tipi scuola comuni (sample locale privato, non in `examples/`). |
| `catalogPhrases.ts` | Unisce schema-live + overlay; `parseConstraintPhrase` preferisce overlay sample. |

Forma canonica schema-live (affidabile per round-trip):

```text
Vincolo «{descriptionIt}» [ConstraintType]: Field=valore; …; peso 100%.
```

Alias accettati: `ConstraintType: Field=…`, KV dopo `:`/`=`, liste attività/tag/aule, slot giorno/ora.

## Mode caveats (field-faithful comunque)

Tipi con `mode` ≠ `tutti` restano **live** con NL fedele ai campi FET. La validazione runtime completa può richiedere modalità FET rare:

| Mode | Tipi (ordine di grandezza) | Nota |
|------|---------------------------:|------|
| `MA` (mornings/afternoons) | ~130 | Serve orario mattina/pomeriggio abilitato in FET. |
| `Terms` / `MA/Terms?` | ~8 | Serve modalità trimestri/periodi. |
| `tutti` | ~220 | Nessuna caveat di modo. |

Gli esempi schema-live annotano la caveat in `examplesIt` / `parseIt.notes` quando `mode` non è `tutti`. **Nessuno resta stub.**

## Famiglie coperte (oltre il priority overlay)

Oltre ai 16 tipi sample: Max/Min gaps, ordered / consecutive / overlapping activities, interval max days, home rooms / buildings, room & building changes, occupy max time slots / sets, mornings-afternoons, terms, activity-tag constraints, generation option `GroupActivitiesInInitialOrder`, ecc.

## Tool MCP

| Tool | Ruolo |
|------|--------|
| `fet_nl_phrase_catalog` | 358 template **live** + `parseText` |
| `fet_nl_parse` / `build` / `patch` | Prosa → campi (tutti i tipi) |
| `fet_nl_extract` | `.fet` → strutturato + italiano + coverage |
| `fet_describe_constraints` | Campi → italiano live |

## Relazione con sample locale privato

Vedi `docs/private-sample-nl-coverage.md`: coverage del sample privato resta verde con `MCPFET_PRIVATE_DIR`; catalogo globale non è più 16 live + 342 stub. ChatGPT non deve aprire file reali dell’istituto.
