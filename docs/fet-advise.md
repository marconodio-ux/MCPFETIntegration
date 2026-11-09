# Consulente vincoli FET (`fet_advise`) — v0.7

L’**advisor propone** vincoli del catalogo FET che l’utente (o l’LLM) potrebbe non conoscere per nome. **Non genera l’orario**: la generazione resta di **FET** (`fet_generate` / `fet-cl`).

Server MCP **v0.7.0**. Smoke: `npm run smoke:advise`.

## Ruolo prodotto

| Chi | Cosa fa |
|-----|---------|
| ChatGPT / Claude / Gemini / Cursor | Conversano; chiamano i tool MCP |
| `fet_advise` | Analizza `.fet` / documento workspace (+ testo opzionale) → suggerimenti ordinati |
| `fet_advise_apply` | Scrive i suggerimenti accettati nel documento |
| `fet_generate` | Esegue il solver FET sull’orario |

Flusso tipico:

1. `fet_nl_build` / `fet_document_open` / `fet_from_assignments`
2. **`fet_advise`** (opz. con descrizione scuola in italiano)
3. Mostrare all’utente i `titleIt` / `rationaleIt` / `improvesIt`
4. **`fet_advise_apply`** con gli `id` scelti, oppure tutti i `high`
5. `fet_document_save` → **`fet_generate`** → se fallisce `fet_diagnose`

## Tool

### `fet_advise`

| Input | Ruolo |
|-------|--------|
| `documentId` | Documento workspace |
| `inputFile` | Path `.fet` (assoluto o sotto `data/input` / `examples/`) |
| `text` | Testo libero IT (lab, pause, max ore, indisponibilità…) — potenzia le euristiche |
| `limit` | Max suggerimenti (default 25) |
| `minConfidence` | `high` \| `medium` \| `low` |
| `openInWorkspace` | Se solo `inputFile`, apre il file in workspace (default true) per l’apply |

Output principale:

- `adviseId` — sessione per `fet_advise_apply`
- `suggestions[]` — `id`, `type` (solo tipi catalogo reali), `fieldsDraft`, `confidence`, `titleIt`, `rationaleIt`, `improvesIt`, `code`, opz. `createsEntities` / `cautionIt`
- `noticeIt` — ricorda che l’advisor non è il generatore

### `fet_advise_apply`

| Input | Ruolo |
|-------|--------|
| `adviseId` | Da `fet_advise` |
| `documentId` | Opzionale (default: documento della sessione) |
| `suggestionIds` | Id accettati; se omesso → tutti i **high** |
| `allHighConfidence` / `minConfidence` | Quando non passi gli id |
| `savePath` | Salva subito il `.fet` |

Può creare aule mancanti citate nei draft `ConstraintSubjectPreferredRoom`.

## Euristiche (pratica scuola IT)

Basate su usi scolastici italiani comuni (split MinDays, lab paralleli, aule LAB, break, max ore/giorno, …). **Solo tipi del catalogo FET 7.12** (358). I file orario reali restano fuori dal repository (mai in `examples/`, mai su GitHub).

| Codice | Tipo FET | Quando scatta |
|--------|----------|----------------|
| `min_days_missing` | `ConstraintMinDaysBetweenActivities` | Split con ≥2 componenti senza MinDays |
| `same_starting_parallel` | `ConstraintActivitiesSameStartingTime` | Sottogruppi sibling (`P1A-meccanica` / `P1A-elettro`) senza allineamento |
| `lab_preferred_room` | `ConstraintSubjectPreferredRoom` | Materie LAB/laboratorio/… senza preferred room |
| `break_times_missing` | `ConstraintBreakTimes` | Calendario lungo / testo parla di pausa |
| `max_hours_daily` | `ConstraintTeachersMaxHoursDaily` | Docenti carichi / testo «max N ore/giorno» |
| `teacher_not_available` | `ConstraintTeacherNotAvailableTimes` | Testo di indisponibilità + slot riconoscibili |
| `lab_consecutive` | `ConstraintTwoActivitiesConsecutive` | Testo chiede blocco consecutivo su lab |

I draft usano i campi XML attesi da `fet_constraint_add` / phrase live (`Activity_Id`, `MinDays`, `Room`, `Break_Time`, …).

## Smoke

```powershell
npm run smoke:advise
```

1. Parte da `examples/from-nl/antonio-orario-completo.txt`
2. Costruisce un `.fet` **senza** MinDays / SameStartingTime / preferred rooms
3. `fet_advise` deve proporre almeno quei tre tipi
4. Apply high-confidence → `examples/advise/antonio-advised.fet` valido al reload

## Limiti onesti

- L’advisor **non** sostituisce la conoscenza della scuola: i `cautionIt` vanno letti (es. nome aula indovinato).
- Non inventa tipi fuori catalogo.
- Non diagnostica fallimenti di generate (quello è `fet_diagnose`).
- Non produce HTML/CSV orario: serve `fet_generate`.

## Vedi anche

- `docs/private-sample-nl-coverage.md` — tipi nel sample reale
- `docs/fet-nl-timetable.md` — build/patch NL
- `docs/fet-configurable-features.md` — catalogo completo
- `docs/fet-diagnose.md` — bloccanti post-generate
