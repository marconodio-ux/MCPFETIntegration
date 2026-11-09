# Diagnosticare vincoli bloccanti (MFI-5)

Tool MCP: **`fet_diagnose`**.  
`fet_generate` con `diagnoseOnFail` (default **true**, se `wait=true` e job `failed`) allega la stessa diagnosi.  
Server **v0.4.0**.

Progetto: `C:\path\to\MCPFETIntegration`  
Copia anche in Agent Store: `docs/fet-diagnose.md`.

## Scopo

Quando la generazione orario **fallisce**, **è lenta**, o il modello è sospetto **prima** di lanciare `fet-cl`, spiegare in italiano:

1. **Cosa blocca** (attività / docente / classe / aula / tipo vincolo catalogo)
2. **Come sistemarlo** (allentare NotAvailable, Preferred a 100%, MinDays, ecc.)

## Fonti della diagnosi

| Fonte | Quando | Affidabilità |
|-------|--------|--------------|
| **Euristiche statiche** sul `.fet` / documento workspace | Sempre (default `includeStatic=true`) | Alta su overload, NA totali, MinDays vs giorni, preferred clash, riferimenti rotti |
| **Log `fet-cl`** sotto `outputDir/logs/` | Dopo generate, o passando `jobId` / `outputDir` | Alta se `errors.txt` ha messaggi tipo *no allowed slot*; media/bassa se solo «Impossible» |
| **`runFet=true`** | Opzionale: esegue `fet-cl` con time limit breve e poi legge i log | Richiede binario `fet-cl` (`FET_CL_PATH`) |

### File log FET utili

| File | Uso |
|------|-----|
| `logs/errors.txt` | Messaggi precompute (Title/Message), es. *Activity with id=N has no allowed slot* |
| `logs/warnings.txt` | Warning non necessariamente bloccanti |
| `logs/result.txt` | Esito: Simulation successful / Impossible / Cannot precompute / Time exceeded |
| `logs/difficult_activities.txt` | Attività che FET non riesce a collocare |
| `logs/initial_order.txt` + `max_placed_activities.txt` | Se max placed = *n*, l’attività *n+1* nell’ordine iniziale è il sospetto tipico |

## Uso MCP

```text
fet_diagnose
  documentId? | inputFile? | jobId? | outputDir?
  runFet?              # default false
  timeLimitSeconds?    # se runFet, default 5
  includeStatic?       # default true
```

Esempi:

1. **Solo statico** sul conflitto di esempio:
   - `inputFile`: `examples/diagnose/teacher-unavailable-conflict.fet`
2. **Dopo un generate fallito**:
   - `jobId` del job, oppure `outputDir` con `logs/`
3. **Generate con diagnosi automatica**:
   - `fet_generate` → in caso di `failed` la risposta include `diagnosis`

## Codici blocker frequenti

| Codice | Significato | Fix tipico |
|--------|-------------|------------|
| `teacher_fully_unavailable` | Docente NA su tutti gli slot ma ha attività | Ridurre `ConstraintTeacherNotAvailableTimes` |
| `teacher_hours_overflow` | Monte ore > slot utili | Ridurre ore / allentare NA-Break / più fasce |
| `students_hours_overflow` | Stesso per classe | Idem su `ConstraintStudentsSetNotAvailableTimes` |
| `mindays_overflow` | Troppi pezzi split vs giorni con MinDays alto | Ridurre MinDays o pezzi, o più giorni |
| `preferred_start_teacher_clash` | Due PreferredStartingTime 100% stesso slot stesso docente | Cambiare Day/Hour o peso |
| `fet_no_allowed_slot` | Da log FET precompute | Allentare NA / Break / Preferred* a 100% |
| `fet_impossible_generic` | FET ha solo scritto «Impossible» | Usare difficult_activities + statico (vedi limiti) |
| `missing_basic_time` | Manca BasicCompulsoryTime 100% | Aggiungere il vincolo base |

I campi `constraintTypes` puntano ai tag del catalogo (`fet_constraint_catalog` / `fet_constraint_list`).

## Limiti (onesti)

1. Se `fet-cl` stampa solo **Impossible**, spesso **non** nomina il `Constraint*` colpevole: servono `difficult_activities.txt`, `initial_order.txt` e le euristiche statiche.
2. Su Windows la console di `fet-cl` può essere povera; i dettagli stanno nei file sotto `logs/`.
3. Le euristiche statiche **non** simulano tutto il solver (catene SameStarting complesse, matching aule virtuali, …).
4. **Time exceeded** ≠ dimostrazione di impossibilità.

## Smoke

```powershell
cd "C:\path\to\MCPFETIntegration"
npm run build
npm run smoke:diagnose
```

Artefatti: `examples/diagnose/teacher-unavailable-conflict.fet` + `examples/diagnose/sample-logs/`.  
Se `fet-cl` è installato, lo smoke prova anche `runFet=true` (altrimenti solo statico + log di esempio).
