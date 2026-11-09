# Generare `.fet` da incarichi insegnanti (MFI-4)

Tool MCP: **`fet_from_assignments`** (helper: **`fet_parse_assignments`**).  
Server **v0.3.0**. Usa le API documento/entità/vincoli già presenti in v0.2.

## Scopo

Da un foglio di **incarichi in italiano / testo libero** (o JSON strutturato) produrre un file FET Official valido con:

- Teachers, Subjects, Students (Year → Group)
- Activities con **split** settimanale
- `ConstraintMinDaysBetweenActivities` sugli split
- Calendario giorni/ore (default scuola IT)

## Input testo (esempio)

Vedi `examples/from-assignments/sample-incarichi.txt`:

```text
Istituto: Scuola Media Esempio
Giorni: Lunedì, Martedì, Mercoledì, Giovedì, Venerdì
Ore: 08:00, 09:00, 10:00, 11:00, 12:00, 13:00

Rossi Mario: Matematica — 1A — 5 ore (2+2+1)
Bianchi Anna: Italiano — 2A — 6 ore
```

Formati riga accettati:

| Forma | Esempio |
|-------|---------|
| Docente: Materia — Classe — N ore (split) | `Rossi Mario: Matematica — 1A — 5 ore (2+2+1)` |
| Separatori `-` / `,` / `\|` | `Bianchi Anna - Italiano - 1A - 6h` |
| Split etichettato | `… 6h split 2+2+2` |
| JSON | `{ "assignments": [{ "teacher", "subject", "students", "hoursPerWeek", "split"? }] }` |

Intestazioni opzionali: `Istituto:`, `Giorni:`, `Ore:` (alias `days`/`hours`/`institution`).

## Regole di mapping

| Campo testo | Entità / vincolo FET |
|-------------|----------------------|
| Nome docente | `Teacher` (+ `Target_Number_of_Hours` = somma ore incarichi) |
| Materia | `Subject` |
| Classe `1A` | Year `1` + Group `1A` (niente Subgroup esplicito: FET ne crea uno automatico se serve) |
| Classe libera (`Lab Chimica`) | Year con lo stesso nome (senza Group) se non matcha `\d+X`… in pratica yearKey = nome intero |
| Ore/settimana | `Total_Duration` dell’attività (somma split) |
| Split esplicito `2+2+1` | Componenti `Activity` con stesso `Activity_Group_Id` |
| Split assente | Pattern default: 1→\[1\], 2→\[1,1\], 3→\[1,1,1\], 4→\[2,1,1\], 5→\[2,2,1\], 6→\[2,2,2\], … |
| Split ≥ 2 pezzi | `ConstraintMinDaysBetweenActivities` (default MinDays=1, weight=95%, Consecutive_If_Same_Day=true) |
| Mode | Official (override via `calendar.mode`) |
| Aule | Non generate (assenza di info negli incarichi) |

## Assunzioni (dichiarate in output `mapping.assumptions`)

1. Settimana Lun–Ven, 6 fasce 08:00–13:00 se non specificato.
2. `Number_of_Students` default = 20 per gruppo.
3. Più classi sulla stessa riga (`1A e 1B`) → **stesso monte ore per ciascuna** (segnalato come ambiguità).
4. Se split e ore non coincidono → si allineano le ore alla somma dello split (ambiguità).
5. Solo vincoli base + MinDays sugli split; niente NotAvailable / MaxGaps / aule finché non chiesti.

## Quando chiedere chiarimenti (`ambiguities`)

Il tool **non blocca** di default (`strictAmbiguities: false`): genera in best-effort e restituisce domande.

| Codice | Chiedere |
|--------|----------|
| `unparsed_line` | Riscrivere la riga in forma Docente / Materia / Classe / Ore |
| `missing_hours` | Monte ore settimanale |
| `missing_class` | Classe/sezione |
| `multi_class_hours` | Ore per ciascuna classe o ripartite? |
| `split_sum_mismatch` | Correggere split o ore |
| `empty_input` / `no_assignments` | Fornire incarichi |

Con `strictAmbiguities: true` non scrive attività se ci sono ambiguità.

## Uso MCP

1. (Opzionale) `fet_parse_assignments` → rivedere rows + ambiguities  
2. `fet_from_assignments` con `text` e/o `assignments`, opzionale `calendar`, opzionale `savePath`  
3. `fet_document_summary` / `fet_document_save`  
4. `fet_diagnose` se `fet_generate` fallisce — vedi `docs/fet-diagnose.md` (MFI-5 / v0.4)

## Smoke locale

```powershell
cd "C:\path\to\MCPFETIntegration"
npm run build
npm run smoke:assignments
```

Produce / aggiorna `examples/from-assignments/sample-from-assignments.fet` e verifica open/summary.
