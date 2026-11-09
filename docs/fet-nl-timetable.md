# Linguaggio naturale → orario FET (MFI-8 / MFI-9)

Tool MCP: **`fet_nl_build`**, **`fet_nl_patch`**, **`fet_nl_parse`**, più MFI-9 **`fet_nl_extract`**, **`fet_describe_constraints`**, **`fet_nl_phrase_catalog`**.  
Server **v0.6.0**. Coverage sample reale: `docs/private-sample-nl-coverage.md`.

Progetto: `C:\path\to\MCPFETIntegration`  
Copia Agent Store: `docs/fet-nl-timetable.md`.

## Ruolo (importante)

L’MCP **non è** ChatGPT/Claude/Gemini. Il client LLM resta il layer conversazionale; l’MCP espone tool che:

1. accettano prosa italiana (incarichi + vincoli + modifiche);
2. mappano su entità/vincoli FET;
3. restituiscono **`gaps`** strutturati (`ask`) quando manca informazione — niente assunzioni silenziose sbagliate;
4. applicano patch conversazionali sul documento workspace;
5. lasciano un `.fet` pronto per `fet_generate` / `fet_diagnose`.

Per fogli incarichi **riga-per-riga** resta anche `fet_from_assignments` (v0.3).

## Esempio Antonio

Input grezzo: `examples/from-nl/antonio-orario.txt`

> Ciao ChatGPT/Gemini/Claude, mi generi l’orario di quest’anno? Rossi insegna laboratorio meccanico in prima per 8 ore/sett; Marraffa in P1A sempre laboratorio 7 ore; P1A è divisa in 2 gruppi — Marraffa solo metà meccanica, l’altra metà elettro ha Bianchi. Poi comunicargli modifiche…

Versione chiarita (smoke): `examples/from-nl/antonio-orario-completo.txt` → `antonio-from-nl.fet`.

## Mapping FET

| Concetto NL | FET |
|-------------|-----|
| Classe `P1A` | Year **`P1`** → Group **`P1A`** |
| Metà `meccanica` / `elettro` | Subgroup **`P1A-meccanica`** / **`P1A-elettro`** (nomi univoci istituto) |
| Docente | `Teacher` (`Target_Number_of_Hours` = somma ore) |
| Materia | `Subject` (title-case leggero) |
| Ore/settimana | `Total_Duration` + split componenti `Activity` |
| Split ore assente | Pattern default (7→2+2+2+1, 8→2+2+2+2, …) |
| Split ≥2 pezzi | `ConstraintMinDaysBetweenActivities` (default weight 95%) |
| Classi spezzate in parallelo | `ConstraintActivitiesSameStartingTime` sulle componenti allineabili delle metà |
| Attività su classe intera spezzata | `Students` = nome **Group** (valido; gap di conferma) |
| Attività su una metà | `Students` = nome **Subgroup** |
| Mode | Official (override `calendar.mode`) |
| Aule | Non generate se non dichiarate |

Gerarchia allineata al catalogo (`docs/fet-configurable-features.md` §2.5): Year → Group → Subgroup.

## Gaps tipici (`gaps[].code`)

| Codice | Quando | Cosa chiedere |
|--------|--------|----------------|
| `year_without_section` | “in prima/seconda” senza A/B | Quali sezioni? |
| `split_halves_unclear` | “divisa in N gruppi” senza nomi | Nomi sottogruppi |
| `split_teacher_incomplete` | Docente citato nello split senza materia/ore | Materia + ore (es. Bianchi) |
| `assignment_on_split_group` | Docente sulla Group già spezzata | Intera classe o una metà? (default: intera) |
| `parallel_missing_activity` | Split parallelo ma una metà senza attività | Completare incarico |
| `parallel_hours_mismatch` | Ore diverse tra metà parallele | Pareggiare o accettare allineamento parziale |
| `patch_unparsed` / `no_patch_ops` | Modifica non riconosciuta | Formulare aggiungi/cambia/rimuovi o `patches[]` |
| `empty_input` / `no_nl_content` | Testo vuoto/inutile | Fornire incarichi |

Con `strictGaps: true`, `fet_nl_build` non scrive attività se ci sono gaps.

## Tool

### `fet_nl_parse`

Solo analisi → `intent` + `gaps` + `notes`.

### `fet_nl_build`

| Input | Ruolo |
|-------|--------|
| `text` | Prosa italiana (saluti chat rimossi) |
| `intent` | JSON strutturato dall’LLM (`assignments`, `classSplits`, …) |
| `calendar` | Giorni/ore/istituto |
| `savePath` | Scrive `.fet` |
| `parallelSameStartingTime` | default `true` |

Output: `documentId`, `mapping` (years/groups/subgroups, `parallelPairs`, `assumptions`), `gaps`.

### `fet_nl_patch`

Su `documentId` esistente:

- testo: «aggiungi…», «cambia X a N ore», «rimuovi attività di Y», nuovi split;
- oppure `patches[]` / `intent` strutturati (`add_assignment`, `change_assignment`, `remove_assignment`, `add_class_split`, `add_constraint`, `remove_constraint`).

## Flusso consigliato (client LLM)

1. Utente parla in italiano → `fet_nl_parse` o diretto `fet_nl_build`
2. Se `gaps.length > 0` → porre `gaps[].ask` all’utente
3. Rifinire con `intent` completato o `fet_nl_patch`
4. `fet_document_summary` → `fet_document_save` (se serve) → `fet_generate`
5. Se fallisce → `fet_diagnose`

## Smoke

```powershell
cd "C:\path\to\MCPFETIntegration"
npm run build
npm run smoke:nl
```

Verifica: sottogruppi `P1A-meccanica`/`P1A-elettro`, ≥3 docenti, `ConstraintActivitiesSameStartingTime` + `ConstraintMinDaysBetweenActivities`, e gaps sul testo grezzo Antonio.

## Known gaps / limiti (v0.6)

- Parser **euristico** (non un LLM interno): prosa molto libera può richiedere `intent` strutturato dal client.
- Tutti i **358** tipi catalogo sono phrase **live** (schema-driven IT↔campi). **16 tipi** scuola comuni hanno overlay hand-tuned. Vedi `docs/fet-nl-full-catalog-coverage.md`. File orario reali: solo fuori dal repository (mai pubblicati), non in ChatGPT.
- Famiglie assenti dal sample (MaxGaps, ordered, home rooms, modes MA/Terms, …) restano via `fet_constraint_*` / intent strutturato.
- Più di 2 sottogruppi: SameStartingTime accoppia le metà a due a due quando entrambe hanno attività.
- Patch chirurgiche non ricalcolano sempre i `Target_Number_of_Hours` docenti in modo perfetto dopo remove; in casi complessi preferire `fet_nl_build` rebuild.
- “Prima” senza contesto P1/1 resta ambigua (`year_without_section`).
- `fet_from_assignments` non gestisce Subgroup: per classi spezzate usare **`fet_nl_*`**.
