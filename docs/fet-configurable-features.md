# Catalogo funzioni e vincoli configurabili FET 7.12.0

Documento utente per **MCP FET Integration**: mappa di ciò che si può configurare in un file `.fet`, come base per (a) generare il `.fet` da testo degli incarichi insegnanti e (b) diagnosticare i vincoli che bloccano la generazione.

## Provenienza (nessuna invenzione)

| Campo | Valore |
|-------|--------|
| Versione FET | **7.12.0** (file `VERSION`) |
| Sorgenti | `vendor/fet-src/fet-7.12.0/` (estratto da `vendor/archives/fet-7.12.0.tar.xz`) |
| Tipi tempo | classi `Constraint*` in `src/engine/timeconstraint.h` |
| Tipi spazio | classi `Constraint*` in `src/engine/spaceconstraint.h` |
| Entità / mode | `src/engine/rules.h`, `activity.h`, `teacher.h`, `subject.h`, `activitytag.h`, `studentsset.h`, `room.h`, `building.h` |
| Scrittura XML `.fet` | `Rules` write in `src/engine/rules.cpp` (`<fet version="…">` …) |
| Opzione generazione (constraint-like) | `GroupActivitiesInInitialOrder` in `activity.h` / lista `Timetable_Generation_Options_List` |
| Traduzioni IT di riferimento | `translations/fet_it.ts` (etichette UI, non tipi aggiuntivi) |

Conteggi verificati dai header:

- **Entità / strutture di modello** documentate sotto: **14** gruppi (mode, meta, giorni, ore, giorni/ore reali, materie, chiavi attività, insegnanti, studenti, attività, edifici, aule, liste vincoli, opzioni di generazione).
- **Tipi vincolo tempo**: **275**
- **Tipi vincolo spazio**: **82**
- **Totale tipi vincolo**: **357**
- **Constraint-like** (non sottoclasse di Time/SpaceConstraint): **1** (`GroupActivitiesInInitialOrder`)

Pin vendor (`vendor/FET_PIN.json`):

```json
{
  "version": "7.12.0",
  "upstreamUrl": "https://github.com/lalesculiviu/fet",
  "upstreamCommit": "c4f67a7b9a430033133cab602d60d85e90ccbd86",
  "upstreamNote": "commit message FET-7.12.0 on branch main (2026-10-14)",
  "archive": "fet-7.12.0.tar.xz",
  "extracted": "vendor/fet-src/fet-7.12.0",
  "homepage": "https://lalescu.ro/liviu/fet/",
  "license": "AGPL-3.0-only"
}
```

## Come leggere le colonne Gen / Diag

- **Gen**: rilevanza tipica quando si costruisce un `.fet` da descrizione testuale degli incarichi.
- **Diag**: rilevanza tipica quando `fet-cl` fallisce o stenta (conflitti a peso alto, slot insufficienti, catene di allineamento).
- **Mode**: `tutti` = valido in Official (e in generale); `MA` = famiglia pensata per *Mornings_Afternoons*; `Terms` = mode *Terms*. I tipi restano presenti nel motore anche fuori mode, ma di solito non vanno emessi se il mode del file non li usa.
- Tag XML = nome classe `Constraint…` (es. `<ConstraintTeacherNotAvailableTimes>…</ConstraintTeacherNotAvailableTimes>`), come in `getXmlDescription`.

Campi comuni a (quasi) ogni vincolo, da `TimeConstraint` / `SpaceConstraint`:

| Campo XML | Ruolo |
|-----------|--------|
| `Weight_Percentage` | Peso 0–100. A **100%** è hard (non violabile); sotto 100% è soft (preferenza). |
| `Active` | Se `false`, il vincolo è ignorato in generazione. |
| `Comments` | Nota libera (utile in diagnosi). |

---

## 1. Mode e metadati file

| Elemento | XML / valori | Cosa configura | Gen | Diag |
|----------|--------------|----------------|-----|------|
| Versione file | attributo `version` su `<fet>` | Versione FET che ha scritto il file. | Impostare alla versione tool (7.12.0). | File troppo nuovi possono essere rifiutati da FET più vecchi. |
| Mode | `<Mode>` = `Official` \| `Mornings_Afternoons` \| `Block_Planning` \| `Terms` (`rules.h` costanti 0–3) | Seleziona il “dialetto” di orario (settimana classica, mattina/pomeriggio, planning a blocchi, periodi finlandesi). | **Obbligatorio**. Per scuole IT tipiche: `Official`. | Mode sbagliato → famiglie di vincoli inutili o mancanti. |
| Istituto | `<Institution_Name>` | Nome scuola/istituzione. | Da testo o default. | Cosmetico. |
| Commenti file | `<Comments>` | Note globali. | Opzionale. | Utile traccia generazione automatica. |
| Terms | `<Number_of_Terms>`, `<Number_of_Days_Per_Term>` | Solo mode Terms. | Solo se Terms. | Irrilevante in Official. |

---

## 2. Entità del modello

Ordine di scrittura nel `.fet` (da `rules.cpp`): Mode → Institution → Comments → (Terms) → Days → Real_Days → Hours → Real_Hours → **Subjects** → **Activity_Tags** → **Teachers** → **Students** → **Activities** → **Buildings** → **Rooms** → Time_Constraints → Space_Constraints → Timetable_Generation_Options.

### 2.1 Giorni e ore

| Entità | XML | Campi rilevanti | Gen | Diag |
|---------|-----|-----------------|-----|------|
| Giorni | `Days_List` / `Day` | `Name`, `Long_Name`; conteggio `Number_of_Days` (= `nDaysPerWeek`) | Definire la settimana (es. Lun–Ven). | Troppi pochi slot (giorni×ore) vs monte ore totale. |
| Ore | `Hours_List` / `Hour` | `Name`, `Long_Name`; `Number_of_Hours` (= `nHoursPerDay`) | Fasce orarie giornaliere. | Come sopra; nomi devono combaciare con vincoli NotAvailable/Break. |
| Giorni reali | `Real_Days_List` | Usati in mode MA (mattina/pomeriggio come metà-giorni). | Solo MA. | Confusione Official vs MA. |
| Ore reali | `Real_Hours_List` | Ore del giorno reale in MA. | Solo MA. | Come sopra. |

Limiti motore (`timetable_defs.h`): fino a `MAX_DAYS_PER_WEEK=1000`, `MAX_HOURS_PER_DAY=1440` (prodotto deve stare in `int`).

### 2.2 Materie (`Subject`)

| Campo | Ruolo |
|-------|--------|
| `name` | Nome univoco corto |
| `longName`, `code` | Etichette/codici |
| `comments` | Note |

- **Gen**: estrarre dal testo incarichi ogni materia citata; ogni attività richiede una `subjectName`.
- **Diag**: materia mancante o nome non allineato all’attività → errore di caricamento / attività incomplete.

### 2.3 Chiavi attività / activity tags (`ActivityTag`)

| Campo | Ruolo |
|-------|--------|
| `name` | Nome univoco |
| `longName`, `code` | Etichette |
| `printable` | Se compare negli orari stampati |
| `comments` | Note |

- **Gen**: usare per etichette (lab, teorica, compresenza, sport). Facoltative ma potenti con vincoli *ActivityTag*.*
- **Diag**: vincoli su tag inesistenti o tag non assegnati alle attività giuste.

### 2.4 Insegnanti (`Teacher`)

| Campo | Ruolo |
|-------|--------|
| `name`, `longName`, `code` | Identità |
| `targetNumberOfHours` | Monte ore obiettivo (controllo/qualità, non vincolo hard da solo) |
| `morningsAfternoonsBehavior` | Solo MA: non inizializzato / unrestricted / morning-or-afternoon esclusivo / eccezioni 1–5 giorni (`teacher.h`) |
| `comments` | Note |

- **Gen**: elenco docenti dagli incarichi; collegare alle attività.
- **Diag**: sovraccarico vs `MaxHours*`, indisponibilità, doppie assegnazioni (coperto anche da BasicCompulsoryTime).

### 2.5 Studenti (`StudentsYear` → `StudentsGroup` → `StudentsSubgroup`)

Gerarchia obbligatoria; **ogni nome (year/group/subgroup) deve essere univoco** in tutto l’istituto (`rules.h`).

| Livello | Campi |
|---------|--------|
| Comune (`StudentsSet`) | `name`, `longName`, `code`, `numberOfStudents`, `comments`, `type` |
| Year | `groupsList`; `divisions` + `separator` + `firstCategoryIsPermanent` (divisioni per categorie) |
| Group | `subgroupsList` |
| Subgroup | unità atomica usata dal motore |

- **Gen**: classi/sezioni dal testo; se non specificato, creare almeno year→group→subgroup coerenti.
- **Diag**: nomi duplicati; attività su set che non esistono; `numberOfStudents` vs capacità aule.

### 2.6 Attività (`Activity`)

Unità schedulata: corso tenuto da uno+ insegnanti a uno+ set di studenti su una materia.

| Campo | Ruolo |
|-------|--------|
| `id` | ID stabile (non è l’indice in lista) |
| `activityGroupId` | `0` se non split; `>0` uguale per tutte le componenti di uno split |
| `teachersNames` | Lista insegnanti |
| `subjectName` | Materia |
| `activityTagsNames` | Lista chiavi |
| `studentsNames` | Year/group/subgroup coinvolti |
| `duration` | Durata in ore di questa componente |
| `totalDuration` | Somma durate dello split (`== duration` se non split) |
| `active` | Se false, esclusa dalla generazione |
| `computeNTotalStudents` / `nTotalStudents` | Studenti calcolati dai set oppure forzati |
| `comments` | Note |

- **Gen**: cuore della traduzione testo→`.fet` (chi insegna cosa a chi, quante ore, eventuale split).
- **Diag**: attività inactive dimenticate; split malformato (`activityGroupId`/`totalDuration`); docenti/studenti vuoti; durata 0.

Limite: `MAX_ACTIVITIES=500000`; split fino a `MAX_SPLIT_OF_AN_ACTIVITY=1000`.

### 2.7 Edifici e aule

**Building**: `name`, `longName`, `code`, `comments`.

**Room**:

| Campo | Ruolo |
|-------|--------|
| `name`, `longName`, `code` | Identità |
| `capacity` | Capienza (`MAX_ROOM_CAPACITY=30000`) |
| `building` | Nome edificio (stringa; vuota = ignorato) |
| `isVirtual` | Aula virtuale = insieme di set di aule reali |
| `realRoomsSetsList` | Se virtuale: liste di nomi aule reali |
| `comments` | Note |

- **Gen**: solo se il testo/regolamento parla di aule; altrimenti si può generare senza space constraints (FET assegna comunque con BasicCompulsorySpace se presente).
- **Diag**: capacità < studenti; troppe attività con stessa PreferredRoom; aule virtuali mal definite.

### 2.8 Opzione di generazione (constraint-like)

| Tipo | XML | Cosa fa | Gen | Diag |
|------|-----|---------|-----|------|
| `GroupActivitiesInInitialOrder` | dentro `Timetable_Generation_Options_List` | Suggerisce l’ordine iniziale di piazzamento di un gruppo di ID attività (heuristica, non vincolo di fattibilità). Campi: lista `ids`, `active`, `comments`. | Bassa in v1 testo→fet; utile tuning. | Di solito non “blocca”; può influenzare tempi/ricerca. |

---

## 3. Famiglie di vincoli — guida rapida prodotto

Priorità tipica per **scuola italiana / Official** da testo incarichi:

1. Entità + attività (split) + `ConstraintBasicCompulsoryTime` + `ConstraintBasicCompulsorySpace`
2. `ConstraintTeacherNotAvailableTimes` / `ConstraintStudentsSetNotAvailableTimes` / `ConstraintBreakTimes`
3. `ConstraintMinDaysBetweenActivities` sugli split
4. Limiti ore/buchi docenti e classi (`MaxHoursDaily`, `MaxGaps*`, `MinHoursDaily`, …)
5. Preferenze aula / home room se presenti
6. Allineamenti didattici (same starting, ordered, not overlapping) solo se espliciti
7. Famiglie MA / Terms solo se mode dedicato

Nota di lettura: i molti tipi `*ActivityTag*` (limiti ore/buchi/cambi per chiave) sono elencati sotto **carichi orari insegnanti/studenti** e, per lo spazio, sotto **vincoli su aule** — non in una sezione tag separata.

Segnali di blocco frequenti in diagnosi:

- Peso **100%** su preferenze troppo strette (starting time / time slots / preferred room)
- Monte ore attività > slot disponibili dopo NotAvailable+Break
- `MinDaysBetweenActivities` con troppe componenti rispetto ai giorni
- Catene SameStarting/Ordered su molti docenti/classi
- Capienze aule e home room in conflitto

---

## 4. Vincoli di tempo (275 tipi)

### 4.1 Obbligatori di base (1)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintBasicCompulsoryTime` | vincoli temporali obbligatori di base | tutti | Sempre: includere nel .fet (peso 100%). | Se assente/peso≠100% il modello non è valido; raramente “blocco” semantico. |

### 4.2 Disponibilità / pause (3)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintTeacherNotAvailableTimes` | insegnante — fasce orarie non disponibili | tutti | Alta: mappare indisponibilità da testo incarichi (giorni/ore vietati). | Alta: spesso blocca se le ore richieste non stanno nelle fasce residue. |
| `ConstraintStudentsSetNotAvailableTimes` | insieme di studenti — fasce orarie non disponibili | tutti | Alta: mappare indisponibilità da testo incarichi (giorni/ore vietati). | Alta: spesso blocca se le ore richieste non stanno nelle fasce residue. |
| `ConstraintBreakTimes` | pause (slot vietati a tutti) | tutti | Media: pause istituzionali (ricreazione, intervalli). | Media: riduce slot utili; verifica ore settimanali vs slot disponibili. |

### 4.3 Allineamento / ordine attività (36)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintActivitiesSameStartingTime` | attività — stesso inizio (giorno+ora) | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintActivitiesNotOverlapping` | attività — non sovrapposte | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintActivityTagsNotOverlapping` | chiavi attività — non sovrapposte | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintActivitiesSameStartingHour` | attività — stessa ora di inizio | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintActivitiesSameStartingDay` | attività — stesso giorno di inizio | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTwoActivitiesConsecutive` | due attività consecutive | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTwoActivitiesGrouped` | due attività raggruppate (stesso giorno, adiacenti o con gap) | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintThreeActivitiesGrouped` | tre attività raggruppate | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTwoActivitiesOrdered` | due attività ordinate (A prima di B) | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTwoSetsOfActivitiesOrdered` | due insiemi di attività ordinati | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTwoActivitiesOrderedIfSameDay` | due attività ordinate se nello stesso giorno | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintStudentsSetMinGapsBetweenOrderedPairOfActivityTags` | insieme di studenti — buchi minimi tra una coppia ordinata di chiavi attività | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintStudentsMinGapsBetweenOrderedPairOfActivityTags` | tutti gli studenti — buchi minimi tra una coppia ordinata di chiavi attività | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTeacherMinGapsBetweenOrderedPairOfActivityTags` | insegnante — buchi minimi tra una coppia ordinata di chiavi attività | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTeachersMinGapsBetweenOrderedPairOfActivityTags` | tutti gli insegnanti — buchi minimi tra una coppia ordinata di chiavi attività | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintStudentsSetMinGapsBetweenOrderedPairOfActivityTagsPerRealDay` | insieme di studenti — buchi minimi (giorno reale) tra coppia ordinata di chiavi | MA | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintStudentsMinGapsBetweenOrderedPairOfActivityTagsPerRealDay` | tutti gli studenti — buchi minimi (giorno reale) tra coppia ordinata di chiavi | MA | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTeacherMinGapsBetweenOrderedPairOfActivityTagsPerRealDay` | insegnante — buchi minimi (giorno reale) tra coppia ordinata di chiavi | MA | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTeachersMinGapsBetweenOrderedPairOfActivityTagsPerRealDay` | tutti gli insegnanti — buchi minimi (giorno reale) tra coppia ordinata di chiavi | MA | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintStudentsSetMinGapsBetweenOrderedPairOfActivityTagsBetweenMorningAndAfternoon` | insieme di studenti — buchi minimi mattina↔pomeriggio tra coppia ordinata di chiavi | MA | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintStudentsMinGapsBetweenOrderedPairOfActivityTagsBetweenMorningAndAfternoon` | tutti gli studenti — buchi minimi mattina↔pomeriggio tra coppia ordinata di chiavi | MA | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTeacherMinGapsBetweenOrderedPairOfActivityTagsBetweenMorningAndAfternoon` | insegnante — buchi minimi mattina↔pomeriggio tra coppia ordinata di chiavi | MA | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTeachersMinGapsBetweenOrderedPairOfActivityTagsBetweenMorningAndAfternoon` | tutti gli insegnanti — buchi minimi mattina↔pomeriggio tra coppia ordinata di chiavi | MA | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTeacherMaxTwoConsecutiveMornings` | insegnante — al massimo due mattine consecutive | MA | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTeachersMaxTwoConsecutiveMornings` | tutti gli insegnanti — al massimo due mattine consecutive | MA | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTeacherMaxTwoConsecutiveAfternoons` | insegnante — al massimo due pomeriggi consecutivi | MA | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTeachersMaxTwoConsecutiveAfternoons` | tutti gli insegnanti — al massimo due pomeriggi consecutivi | MA | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTeacherMaxThreeConsecutiveDays` | insegnante — al massimo tre giorni consecutivi | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTeachersMaxThreeConsecutiveDays` | tutti gli insegnanti — al massimo tre giorni consecutivi | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintStudentsSetMaxThreeConsecutiveDays` | insieme di studenti — al massimo tre giorni consecutivi | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintStudentsMaxThreeConsecutiveDays` | tutti gli studenti — al massimo tre giorni consecutivi | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTeacherNoTwoConsecutiveDays` | insegnante — niente due giorni consecutivi | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTeachersNoTwoConsecutiveDays` | tutti gli insegnanti — niente due giorni consecutivi | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintTwoSetsOfActivitiesSameSections` | due insiemi con le stesse sezioni (allineamento) | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesOverlapCompletelyOrDoNotOverlap` | attività — si sovrappongono del tutto oppure per niente | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintMaxDaysBetweenEachPairOfConsecutiveActivities` | giorni massimi tra ogni coppia di attività consecutive dell’insieme | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |

### 4.4 Separazione temporale tra attività (25)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintMinDaysBetweenActivities` | giorni minimi tra — attività | tutti | Alta: da split settimanale materie (non concentrare le ore). | Alta: tipico blocco con troppe componenti o peso 100% troppo stretto. |
| `ConstraintMaxDaysBetweenActivities` | giorni massimi tra — attività | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesMaxHourlySpan` | attività — ampiezza oraria massima | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintMinGapsBetweenActivities` | buchi minimi tra — attività | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintMaxGapsBetweenActivities` | buchi massimi tra — attività | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherMaxDaysPerWeek` | insegnante — giorni massimi a settimana | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeachersMaxDaysPerWeek` | tutti gli insegnanti — giorni massimi a settimana | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeacherMinDaysPerWeek` | insegnante — giorni minimi a settimana | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeachersMinDaysPerWeek` | tutti gli insegnanti — giorni minimi a settimana | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeacherIntervalMaxDaysPerWeek` | insegnante — giorni massimi a settimana in un intervallo orario | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeachersIntervalMaxDaysPerWeek` | tutti gli insegnanti — giorni massimi a settimana in un intervallo orario | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsSetIntervalMaxDaysPerWeek` | insieme di studenti — giorni massimi a settimana in un intervallo orario | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsIntervalMaxDaysPerWeek` | tutti gli studenti — giorni massimi a settimana in un intervallo orario | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsSetMaxDaysPerWeek` | insieme di studenti — giorni massimi a settimana | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsMaxDaysPerWeek` | tutti gli studenti — giorni massimi a settimana | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeacherMorningIntervalMaxDaysPerWeek` | insegnante — giorni massimi a settimana in un intervallo del mattino | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMorningIntervalMaxDaysPerWeek` | tutti gli insegnanti — giorni massimi a settimana in un intervallo del mattino | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherAfternoonIntervalMaxDaysPerWeek` | insegnante — giorni massimi a settimana in un intervallo del pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersAfternoonIntervalMaxDaysPerWeek` | tutti gli insegnanti — giorni massimi a settimana in un intervallo del pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMorningIntervalMaxDaysPerWeek` | insieme di studenti — giorni massimi a settimana in un intervallo del mattino | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMorningIntervalMaxDaysPerWeek` | tutti gli studenti — giorni massimi a settimana in un intervallo del mattino | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetAfternoonIntervalMaxDaysPerWeek` | insieme di studenti — giorni massimi a settimana in un intervallo del pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsAfternoonIntervalMaxDaysPerWeek` | tutti gli studenti — giorni massimi a settimana in un intervallo del pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintMinHalfDaysBetweenActivities` | mezzi giorni minimi tra — attività | MA/Terms? | Alta: da split settimanale materie (non concentrare le ore). | Alta: tipico blocco con troppe componenti o peso 100% troppo stretto. |
| `ConstraintMaxHalfDaysBetweenActivities` | mezzi giorni massimi tra — attività | MA/Terms? | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |

### 4.5 Preferenze di orario (8)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintActivityPreferredStartingTime` | attività — orario di inizio preferito (giorno/ora) | tutti | Media: orari fissi/locked da assegnazioni (“sempre il lunedì alla 1ª”). | Alta se permanentlyLocked o peso 100% su slot già saturi. |
| `ConstraintActivityPreferredTimeSlots` | attività — fasce orarie ammesse | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivityPreferredStartingTimes` | attività — inizi preferiti (insieme di slot) | tutti | Media: orari fissi/locked da assegnazioni (“sempre il lunedì alla 1ª”). | Alta se permanentlyLocked o peso 100% su slot già saturi. |
| `ConstraintActivitiesPreferredTimeSlots` | attività — fasce orarie ammesse | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintSubactivitiesPreferredTimeSlots` | sotto-attività (componenti di uno split) — fasce orarie ammesse | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesPreferredStartingTimes` | attività — inizi preferiti (insieme di slot) | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintSubactivitiesPreferredStartingTimes` | sotto-attività (componenti di uno split) — inizi preferiti (insieme di slot) | tutti | Media: orari fissi/locked da assegnazioni (“sempre il lunedì alla 1ª”). | Alta se permanentlyLocked o peso 100% su slot già saturi. |
| `ConstraintActivityPreferredDay` | attività — giorno preferito | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |

### 4.6 Inizio/fine giornata (22)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintStudentsEarlyMaxBeginningsAtSecondHour` | tutti gli studenti — inizio al più tardi dalla 2ª ora (max N eccezioni) | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsSetEarlyMaxBeginningsAtSecondHour` | insieme di studenti — inizio al più tardi dalla 2ª ora (max N eccezioni) | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivityEndsStudentsDay` | attività — chiude la giornata degli studenti | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesEndStudentsDay` | attività — chiudono la giornata degli studenti | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivityEndsTeachersDay` | attività — chiude la giornata dell’insegnante | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesEndTeachersDay` | attività — chiudono la giornata dell’insegnante | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeachersAfternoonsEarlyMaxBeginningsAtSecondHour` | tutti gli insegnanti — inizio pomeridiano al più tardi dalla 2ª ora | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherAfternoonsEarlyMaxBeginningsAtSecondHour` | insegnante — inizio pomeridiano al più tardi dalla 2ª ora | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMorningsEarlyMaxBeginningsAtSecondHour` | tutti gli insegnanti — inizio mattutino al più tardi dalla 2ª ora | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherMorningsEarlyMaxBeginningsAtSecondHour` | insegnante — inizio mattutino al più tardi dalla 2ª ora | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsAfternoonsEarlyMaxBeginningsAtSecondHour` | tutti gli studenti — inizio pomeridiano al più tardi dalla 2ª ora | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetAfternoonsEarlyMaxBeginningsAtSecondHour` | insieme di studenti — inizio pomeridiano al più tardi dalla 2ª ora | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMorningsEarlyMaxBeginningsAtSecondHour` | tutti gli studenti — inizio mattutino al più tardi dalla 2ª ora | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMorningsEarlyMaxBeginningsAtSecondHour` | insieme di studenti — inizio mattutino al più tardi dalla 2ª ora | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintActivityBeginsStudentsDay` | attività — apre la giornata degli studenti | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesBeginStudentsDay` | attività — aprono la giornata degli studenti | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivityBeginsTeachersDay` | attività — apre la giornata dell’insegnante | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesBeginTeachersDay` | attività — aprono la giornata dell’insegnante | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivityBeginsOrEndsStudentsDay` | attività — apre o chiude la giornata degli studenti | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesBeginOrEndStudentsDay` | attività — aprono o chiudono la giornata degli studenti | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivityBeginsOrEndsTeachersDay` | attività — apre o chiude la giornata dell’insegnante | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesBeginOrEndTeachersDay` | attività — aprono o chiudono la giornata dell’insegnante | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |

### 4.7 Carichi orari insegnanti (84)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintTeachersMaxHoursDaily` | tutti gli insegnanti — ore massime al giorno | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherMaxHoursDaily` | insegnante — ore massime al giorno | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherMaxHoursDailyInInterval` | insegnante — ore massime al giorno in un intervallo orario | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeachersMaxHoursDailyInInterval` | tutti gli insegnanti — ore massime al giorno in un intervallo orario | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeachersMaxHoursContinuously` | tutti gli insegnanti — ore massime consecutive | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeacherMaxHoursContinuously` | insegnante — ore massime consecutive | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeachersActivityTagMaxHoursContinuously` | tutti gli insegnanti — ore massime consecutive per chiave attività | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintTeacherActivityTagMaxHoursContinuously` | insegnante — ore massime consecutive per chiave attività | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintTeachersMaxGapsPerWeek` | tutti gli insegnanti — buchi massimi a settimana | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherMaxGapsPerWeek` | insegnante — buchi massimi a settimana | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeachersMaxGapsPerDay` | tutti gli insegnanti — buchi massimi al giorno | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherMaxGapsPerDay` | insegnante — buchi massimi al giorno | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeachersMaxGapsPerMorningAndAfternoon` | tutti gli insegnanti — buchi massimi mattina+pomeriggio | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherMaxGapsPerMorningAndAfternoon` | insegnante — buchi massimi mattina+pomeriggio | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeachersMinHoursDaily` | tutti gli insegnanti — ore minime al giorno | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherMinHoursDaily` | insegnante — ore minime al giorno | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeachersActivityTagMaxHoursDaily` | tutti gli insegnanti — ore massime giornaliere per chiave attività | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherActivityTagMaxHoursDaily` | insegnante — ore massime giornaliere per chiave attività | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeachersActivityTagMinHoursDaily` | tutti gli insegnanti — ore minime giornaliere per chiave attività | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherActivityTagMinHoursDaily` | insegnante — ore minime giornaliere per chiave attività | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherMaxSpanPerDay` | insegnante — ampiezza massima della giornata (prima→ultima ora) | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeachersMaxSpanPerDay` | tutti gli insegnanti — ampiezza massima della giornata (prima→ultima ora) | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeacherMinRestingHours` | insegnante — ore minime di riposo | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeachersMinRestingHours` | tutti gli insegnanti — ore minime di riposo | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeacherMinGapsBetweenActivityTag` | insegnante — buchi minimi tra occorrenze della stessa chiave attività | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintTeachersMinGapsBetweenActivityTag` | tutti gli insegnanti — buchi minimi tra occorrenze della stessa chiave attività | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintTeacherMinGapsBetweenActivityTagPerRealDay` | insegnante — buchi minimi (giorno reale) tra occorrenze della stessa chiave | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMinGapsBetweenActivityTagPerRealDay` | tutti gli insegnanti — buchi minimi (giorno reale) tra occorrenze della stessa chiave | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherMinGapsBetweenActivityTagBetweenMorningAndAfternoon` | insegnante — buchi minimi mattina↔pomeriggio per una chiave | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMinGapsBetweenActivityTagBetweenMorningAndAfternoon` | tutti gli insegnanti — buchi minimi mattina↔pomeriggio per una chiave | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMaxHoursDailyRealDays` | tutti gli insegnanti — ore massime per giorno reale | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherMaxHoursDailyRealDays` | insegnante — ore massime per giorno reale | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherMaxRealDaysPerWeek` | insegnante — giorni reali massimi a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMaxRealDaysPerWeek` | tutti gli insegnanti — giorni reali massimi a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherMinRealDaysPerWeek` | insegnante — giorni reali minimi a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMinRealDaysPerWeek` | tutti gli insegnanti — giorni reali minimi a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMaxGapsPerRealDay` | tutti gli insegnanti — buchi massimi per giorno reale | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherMaxGapsPerRealDay` | insegnante — buchi massimi per giorno reale | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeachersMinHoursPerMorning` | tutti gli insegnanti — ore minime al mattino | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherMinHoursPerMorning` | insegnante — ore minime al mattino | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMinHoursDailyRealDays` | tutti gli insegnanti — ore minime per giorno reale | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherMinHoursDailyRealDays` | insegnante — ore minime per giorno reale | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeachersActivityTagMaxHoursDailyRealDays` | tutti gli insegnanti — ore massime per chiave attività su giorno reale | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherActivityTagMaxHoursDailyRealDays` | insegnante — ore massime per chiave attività su giorno reale | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherMaxSpanPerRealDay` | insegnante — ampiezza massima per giorno reale | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMaxSpanPerRealDay` | tutti gli insegnanti — ampiezza massima per giorno reale | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherMaxAfternoonsPerWeek` | insegnante — pomeriggi massimi a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMaxAfternoonsPerWeek` | tutti gli insegnanti — pomeriggi massimi a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherMaxMorningsPerWeek` | insegnante — mattine massime a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMaxMorningsPerWeek` | tutti gli insegnanti — mattine massime a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherMaxActivityTagsPerDayFromSet` | insegnante — massimo di chiavi attività al giorno da un insieme | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintTeachersMaxActivityTagsPerDayFromSet` | tutti gli insegnanti — massimo di chiavi attività al giorno da un insieme | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintTeacherMinMorningsPerWeek` | insegnante — mattine minime a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMinMorningsPerWeek` | tutti gli insegnanti — mattine minime a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherMinAfternoonsPerWeek` | insegnante — pomeriggi minimi a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMinAfternoonsPerWeek` | tutti gli insegnanti — pomeriggi minimi a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherMaxZeroGapsPerAfternoon` | insegnante — zero buchi nel pomeriggio (max 0) | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMaxZeroGapsPerAfternoon` | tutti gli insegnanti — zero buchi nel pomeriggio (max 0) | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherMaxHoursPerAllAfternoons` | insegnante — ore massime su tutti i pomeriggi | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMaxHoursPerAllAfternoons` | tutti gli insegnanti — ore massime su tutti i pomeriggi | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherMinRestingHoursBetweenMorningAndAfternoon` | insegnante — ore minime di riposo tra mattina e pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMinRestingHoursBetweenMorningAndAfternoon` | tutti gli insegnanti — ore minime di riposo tra mattina e pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMaxGapsPerWeekForRealDays` | tutti gli insegnanti — buchi massimi a settimana contati sui giorni reali | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherMaxGapsPerWeekForRealDays` | insegnante — buchi massimi a settimana contati sui giorni reali | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintTeacherMaxActivityTagsPerRealDayFromSet` | insegnante — massimo di chiavi attività per giorno reale da un insieme | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMaxActivityTagsPerRealDayFromSet` | tutti gli insegnanti — massimo di chiavi attività per giorno reale da un insieme | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMinHoursPerAfternoon` | tutti gli insegnanti — ore minime al pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherMinHoursPerAfternoon` | insegnante — ore minime al pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherPairOfMutuallyExclusiveTimeSlots` | insegnante — coppia di slot mutuamente esclusivi | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeachersPairOfMutuallyExclusiveTimeSlots` | tutti gli insegnanti — coppia di slot mutuamente esclusivi | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeacherMaxSingleGapsInSelectedTimeSlots` | insegnante — massimo di buchi singoli negli slot selezionati | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeachersMaxSingleGapsInSelectedTimeSlots` | tutti gli insegnanti — massimo di buchi singoli negli slot selezionati | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeacherMaxHoursPerTerm` | insegnante — ore massime per periodo/term | Terms | Solo se Mode=Terms. | Irrilevante fuori dal mode Terms. |
| `ConstraintTeachersMaxHoursPerTerm` | tutti gli insegnanti — ore massime per periodo/term | Terms | Solo se Mode=Terms. | Irrilevante fuori dal mode Terms. |
| `ConstraintTeacherPairOfMutuallyExclusiveSetsOfTimeSlots` | insegnante — coppia di insiemi di slot mutuamente esclusivi | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeachersPairOfMutuallyExclusiveSetsOfTimeSlots` | tutti gli insegnanti — coppia di insiemi di slot mutuamente esclusivi | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeacherOccupiesMaxSetsOfTimeSlotsFromSelection` | insegnante — occupa al massimo N insiemi di slot dalla selezione | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeachersOccupyMaxSetsOfTimeSlotsFromSelection` | tutti gli insegnanti — occupano al massimo N insiemi di slot dalla selezione | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeacherMaxActivityTagChangesPerDay` | insegnante — cambi massimi di chiave attività al giorno | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintTeachersMaxActivityTagChangesPerDay` | tutti gli insegnanti — cambi massimi di chiave attività al giorno | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintTeacherMaxActivityTagChangesPerWeek` | insegnante — cambi massimi di chiave attività a settimana | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintTeachersMaxActivityTagChangesPerWeek` | tutti gli insegnanti — cambi massimi di chiave attività a settimana | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintTeacherMaxSingleEarlyGaps` | insegnante — massimo di buchi singoli all’inizio giornata | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintTeachersMaxSingleEarlyGaps` | tutti gli insegnanti — massimo di buchi singoli all’inizio giornata | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |

### 4.8 Carichi orari studenti (82)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintStudentsSetMaxHoursDailyInInterval` | insieme di studenti — ore massime al giorno in un intervallo orario | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsMaxHoursDailyInInterval` | tutti gli studenti — ore massime al giorno in un intervallo orario | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsMaxGapsPerWeek` | tutti gli studenti — buchi massimi a settimana | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsSetMaxGapsPerWeek` | insieme di studenti — buchi massimi a settimana | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsMaxHoursDaily` | tutti gli studenti — ore massime al giorno | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsSetMaxHoursDaily` | insieme di studenti — ore massime al giorno | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsMaxHoursContinuously` | tutti gli studenti — ore massime consecutive | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsSetMaxHoursContinuously` | insieme di studenti — ore massime consecutive | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsActivityTagMaxHoursContinuously` | tutti gli studenti — ore massime consecutive per chiave attività | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintStudentsSetActivityTagMaxHoursContinuously` | insieme di studenti — ore massime consecutive per chiave attività | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintStudentsMinHoursDaily` | tutti gli studenti — ore minime al giorno | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsSetMinHoursDaily` | insieme di studenti — ore minime al giorno | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsActivityTagMaxHoursDaily` | tutti gli studenti — ore massime giornaliere per chiave attività | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsSetActivityTagMaxHoursDaily` | insieme di studenti — ore massime giornaliere per chiave attività | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsActivityTagMinHoursDaily` | tutti gli studenti — ore minime giornaliere per chiave attività | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsSetActivityTagMinHoursDaily` | insieme di studenti — ore minime giornaliere per chiave attività | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsMaxGapsPerDay` | tutti gli studenti — buchi massimi al giorno | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsSetMaxGapsPerDay` | insieme di studenti — buchi massimi al giorno | tutti | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsSetMaxSpanPerDay` | insieme di studenti — ampiezza massima della giornata (prima→ultima ora) | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsMaxSpanPerDay` | tutti gli studenti — ampiezza massima della giornata (prima→ultima ora) | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsSetMinRestingHours` | insieme di studenti — ore minime di riposo | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsMinRestingHours` | tutti gli studenti — ore minime di riposo | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsSetMinGapsBetweenActivityTag` | insieme di studenti — buchi minimi tra occorrenze della stessa chiave attività | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintStudentsMinGapsBetweenActivityTag` | tutti gli studenti — buchi minimi tra occorrenze della stessa chiave attività | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintStudentsSetMinGapsBetweenActivityTagPerRealDay` | insieme di studenti — buchi minimi (giorno reale) tra occorrenze della stessa chiave | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMinGapsBetweenActivityTagPerRealDay` | tutti gli studenti — buchi minimi (giorno reale) tra occorrenze della stessa chiave | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMinGapsBetweenActivityTagBetweenMorningAndAfternoon` | insieme di studenti — buchi minimi mattina↔pomeriggio per una chiave | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMinGapsBetweenActivityTagBetweenMorningAndAfternoon` | tutti gli studenti — buchi minimi mattina↔pomeriggio per una chiave | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMaxHoursDailyRealDays` | tutti gli studenti — ore massime per giorno reale | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsSetMaxHoursDailyRealDays` | insieme di studenti — ore massime per giorno reale | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsActivityTagMaxHoursDailyRealDays` | tutti gli studenti — ore massime per chiave attività su giorno reale | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsSetActivityTagMaxHoursDailyRealDays` | insieme di studenti — ore massime per chiave attività su giorno reale | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsMaxGapsPerRealDay` | tutti gli studenti — buchi massimi per giorno reale | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsSetMaxGapsPerRealDay` | insieme di studenti — buchi massimi per giorno reale | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsSetMaxRealDaysPerWeek` | insieme di studenti — giorni reali massimi a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMaxRealDaysPerWeek` | tutti gli studenti — giorni reali massimi a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMaxSpanPerRealDay` | insieme di studenti — ampiezza massima per giorno reale | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMaxSpanPerRealDay` | tutti gli studenti — ampiezza massima per giorno reale | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMinHoursPerMorning` | tutti gli studenti — ore minime al mattino | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMinHoursPerMorning` | insieme di studenti — ore minime al mattino | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMaxAfternoonsPerWeek` | tutti gli studenti — pomeriggi massimi a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMaxAfternoonsPerWeek` | insieme di studenti — pomeriggi massimi a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMaxMorningsPerWeek` | tutti gli studenti — mattine massime a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMaxMorningsPerWeek` | insieme di studenti — mattine massime a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMinAfternoonsPerWeek` | tutti gli studenti — pomeriggi minimi a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMinAfternoonsPerWeek` | insieme di studenti — pomeriggi minimi a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMinMorningsPerWeek` | tutti gli studenti — mattine minime a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMinMorningsPerWeek` | insieme di studenti — mattine minime a settimana | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMaxHoursPerAllAfternoons` | insieme di studenti — ore massime su tutti i pomeriggi | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMaxHoursPerAllAfternoons` | tutti gli studenti — ore massime su tutti i pomeriggi | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMinRestingHoursBetweenMorningAndAfternoon` | insieme di studenti — ore minime di riposo tra mattina e pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMinRestingHoursBetweenMorningAndAfternoon` | tutti gli studenti — ore minime di riposo tra mattina e pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMaxGapsPerWeekForRealDays` | tutti gli studenti — buchi massimi a settimana contati sui giorni reali | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsSetMaxGapsPerWeekForRealDays` | insieme di studenti — buchi massimi a settimana contati sui giorni reali | MA | Alta per regole di contratto/benessere (docenti e classi). | Alta: limiti troppo bassi rispetto al monte ore. |
| `ConstraintStudentsSetMaxActivityTagsPerDayFromSet` | insieme di studenti — massimo di chiavi attività al giorno da un insieme | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintStudentsMaxActivityTagsPerDayFromSet` | tutti gli studenti — massimo di chiavi attività al giorno da un insieme | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintStudentsSetMaxActivityTagsPerRealDayFromSet` | insieme di studenti — massimo di chiavi attività per giorno reale da un insieme | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMaxActivityTagsPerRealDayFromSet` | tutti gli studenti — massimo di chiavi attività per giorno reale da un insieme | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMinHoursPerAfternoon` | tutti gli studenti — ore minime al pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMinHoursPerAfternoon` | insieme di studenti — ore minime al pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetPairOfMutuallyExclusiveTimeSlots` | insieme di studenti — coppia di slot mutuamente esclusivi | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsPairOfMutuallyExclusiveTimeSlots` | tutti gli studenti — coppia di slot mutuamente esclusivi | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsMaxSingleGapsInSelectedTimeSlots` | tutti gli studenti — massimo di buchi singoli negli slot selezionati | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsSetMaxSingleGapsInSelectedTimeSlots` | insieme di studenti — massimo di buchi singoli negli slot selezionati | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsSetPairOfMutuallyExclusiveSetsOfTimeSlots` | insieme di studenti — coppia di insiemi di slot mutuamente esclusivi | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsPairOfMutuallyExclusiveSetsOfTimeSlots` | tutti gli studenti — coppia di insiemi di slot mutuamente esclusivi | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsSetOccupiesMaxSetsOfTimeSlotsFromSelection` | insieme di studenti — occupa al massimo N insiemi di slot dalla selezione | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsOccupyMaxSetsOfTimeSlotsFromSelection` | tutti gli studenti — occupano al massimo N insiemi di slot dalla selezione | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsSetMaxActivityTagChangesPerDay` | insieme di studenti — cambi massimi di chiave attività al giorno | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintStudentsMaxActivityTagChangesPerDay` | tutti gli studenti — cambi massimi di chiave attività al giorno | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintStudentsSetMaxActivityTagChangesPerWeek` | insieme di studenti — cambi massimi di chiave attività a settimana | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintStudentsMaxActivityTagChangesPerWeek` | tutti gli studenti — cambi massimi di chiave attività a settimana | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintStudentsSetMaxSingleEarlyMorningGaps` | insieme di studenti — massimo di buchi singoli all’inizio della mattina | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMaxSingleEarlyMorningGaps` | tutti gli studenti — massimo di buchi singoli all’inizio della mattina | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMaxSingleEarlyAfternoonGaps` | insieme di studenti — massimo di buchi singoli all’inizio del pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMaxSingleEarlyAfternoonGaps` | tutti gli studenti — massimo di buchi singoli all’inizio del pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMaxSingleGapsBetweenMorningAndAfternoon` | insieme di studenti — massimo di buchi singoli tra mattina e pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMaxSingleGapsBetweenMorningAndAfternoon` | tutti gli studenti — massimo di buchi singoli tra mattina e pomeriggio | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMaxHoursContinuouslyRealDays` | tutti gli studenti — ore massime consecutive su giorno reale | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMaxHoursContinuouslyRealDays` | insieme di studenti — ore massime consecutive su giorno reale | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMaxSingleEarlyGaps` | insieme di studenti — massimo di buchi singoli all’inizio giornata | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintStudentsMaxSingleEarlyGaps` | tutti gli studenti — massimo di buchi singoli all’inizio giornata | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |

### 4.9 Slot selezionati / mutuamente esclusivi (10)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintActivitiesOccupyMaxTimeSlotsFromSelection` | attività — occupano al massimo N slot dalla selezione | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesOccupyMinTimeSlotsFromSelection` | attività — occupano almeno N slot dalla selezione | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesMaxSimultaneousInSelectedTimeSlots` | attività — massimo di attività simultanee negli slot selezionati | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesMinSimultaneousInSelectedTimeSlots` | attività — minimo di attività simultanee negli slot selezionati | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintMaxTotalActivitiesFromSetInSelectedTimeSlots` | massimo totale di attività dell’insieme negli slot selezionati | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesPairOfMutuallyExclusiveSetsOfTimeSlots` | attività — coppia di insiemi di slot mutuamente esclusivi | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesPairOfMutuallyExclusiveTimeSlots` | attività — coppia di slot mutuamente esclusivi | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesOccupyMaxSetsOfTimeSlotsFromSelection` | attività — occupano al massimo N insiemi di slot dalla selezione | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesMaxTotalNumberOfStudentsInSelectedTimeSlots` | attività — numero massimo totale di studenti negli slot selezionati | tutti | Valutare se il testo incarichi lo implica; altrimenti omettere. | Se attivo a peso alto, verificare contro monte ore e slot liberi. |
| `ConstraintActivitiesMaxActivityTagsFromSetInSelectedTimeSlots` | attività — massimo di chiavi (da un insieme) negli slot selezionati | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |

### 4.10 Periodi / Terms (4)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintActivitiesMaxInATerm` | attività — massimo in un periodo/term | Terms | Solo se Mode=Terms. | Irrilevante fuori dal mode Terms. |
| `ConstraintActivitiesOccupyMaxTerms` | attività — occupano al massimo N periodi/term | Terms | Solo se Mode=Terms. | Irrilevante fuori dal mode Terms. |
| `ConstraintActivitiesMinInATerm` | attività — minimo in un periodo/term | Terms | Solo se Mode=Terms. | Irrilevante fuori dal mode Terms. |
| `ConstraintMaxTermsBetweenActivities` | massimo di periodi/term tra — attività | Terms | Solo se Mode=Terms. | Irrilevante fuori dal mode Terms. |

## 5. Vincoli di spazio (82 tipi)

### 5.1 Obbligatori di base (1)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintBasicCompulsorySpace` | vincoli spaziali obbligatori di base | tutti | Sempre: includere nel .fet (peso 100%). | Se assente/peso≠100% il modello non è valido; raramente “blocco” semantico. |

### 5.2 Disponibilità / pause (2)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintRoomNotAvailableTimes` | aula non disponibile in fasce | tutti | Valutare se aule/edifici compaiono nel testo; altrimenti omettere. | Se attivo a peso alto, verificare capacità e conflitti aula. |
| `ConstraintTeacherRoomNotAvailableTimes` | coppia insegnante+aula non disponibile in fasce | tutti | Valutare se aule/edifici compaiono nel testo; altrimenti omettere. | Se attivo a peso alto, verificare capacità e conflitti aula. |

### 5.3 Aule preferite / home (12)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintActivityPreferredRoom` | attività — aula preferita | tutti | Media/alta: aule materie speciali o aule classe. | Alta: capacità insufficiente o conflitto home room vs preferenza materia. |
| `ConstraintActivityPreferredRooms` | attività — aule preferite (insieme) | tutti | Media/alta: aule materie speciali o aule classe. | Alta: capacità insufficiente o conflitto home room vs preferenza materia. |
| `ConstraintStudentsSetHomeRoom` | insieme di studenti — aula di appartenenza (home) | tutti | Media/alta: aule materie speciali o aule classe. | Alta: capacità insufficiente o conflitto home room vs preferenza materia. |
| `ConstraintStudentsSetHomeRooms` | insieme di studenti — aule di appartenenza (insieme) | tutti | Media/alta: aule materie speciali o aule classe. | Alta: capacità insufficiente o conflitto home room vs preferenza materia. |
| `ConstraintTeacherHomeRoom` | insegnante — aula di appartenenza (home) | tutti | Media/alta: aule materie speciali o aule classe. | Alta: capacità insufficiente o conflitto home room vs preferenza materia. |
| `ConstraintTeacherHomeRooms` | insegnante — aule di appartenenza (insieme) | tutti | Media/alta: aule materie speciali o aule classe. | Alta: capacità insufficiente o conflitto home room vs preferenza materia. |
| `ConstraintSubjectPreferredRoom` | materia — aula preferita | tutti | Media/alta: aule materie speciali o aule classe. | Alta: capacità insufficiente o conflitto home room vs preferenza materia. |
| `ConstraintSubjectPreferredRooms` | materia — aule preferite (insieme) | tutti | Media/alta: aule materie speciali o aule classe. | Alta: capacità insufficiente o conflitto home room vs preferenza materia. |
| `ConstraintSubjectActivityTagPreferredRoom` | materia — chiave attività — aula preferita | tutti | Media/alta: aule materie speciali o aule classe. | Alta: capacità insufficiente o conflitto home room vs preferenza materia. |
| `ConstraintSubjectActivityTagPreferredRooms` | materia — chiave attività — aule preferite (insieme) | tutti | Media/alta: aule materie speciali o aule classe. | Alta: capacità insufficiente o conflitto home room vs preferenza materia. |
| `ConstraintActivityTagPreferredRoom` | chiave attività — aula preferita | tutti | Media/alta: aule materie speciali o aule classe. | Alta: capacità insufficiente o conflitto home room vs preferenza materia. |
| `ConstraintActivityTagPreferredRooms` | chiave attività — aule preferite (insieme) | tutti | Media/alta: aule materie speciali o aule classe. | Alta: capacità insufficiente o conflitto home room vs preferenza materia. |

### 5.4 Cambi aula / edificio (50)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintStudentsSetMaxBuildingChangesPerDay` | insieme di studenti — cambi edificio massimi al giorno | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintStudentsMaxBuildingChangesPerDay` | tutti gli studenti — cambi edificio massimi al giorno | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintStudentsSetMaxBuildingChangesPerDayInInterval` | insieme di studenti — cambi edificio massimi al giorno in un intervallo | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintStudentsMaxBuildingChangesPerDayInInterval` | tutti gli studenti — cambi edificio massimi al giorno in un intervallo | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintStudentsSetMaxBuildingChangesPerRealDayInInterval` | insieme di studenti — cambi edificio massimi per giorno reale in un intervallo | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMaxBuildingChangesPerRealDayInInterval` | tutti gli studenti — cambi edificio massimi per giorno reale in un intervallo | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMaxRoomChangesPerDayInInterval` | insieme di studenti — cambi aula massimi al giorno in un intervallo | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintStudentsMaxRoomChangesPerDayInInterval` | tutti gli studenti — cambi aula massimi al giorno in un intervallo | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintStudentsSetMaxRoomChangesPerRealDayInInterval` | insieme di studenti — cambi aula massimi per giorno reale in un intervallo | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMaxRoomChangesPerRealDayInInterval` | tutti gli studenti — cambi aula massimi per giorno reale in un intervallo | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMaxBuildingChangesPerWeek` | insieme di studenti — cambi edificio massimi a settimana | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintStudentsMaxBuildingChangesPerWeek` | tutti gli studenti — cambi edificio massimi a settimana | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintStudentsSetMinGapsBetweenBuildingChanges` | insieme di studenti — buchi minimi tra cambi di edificio | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintStudentsMinGapsBetweenBuildingChanges` | tutti gli studenti — buchi minimi tra cambi di edificio | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeacherMaxBuildingChangesPerDay` | insegnante — cambi edificio massimi al giorno | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeacherMaxBuildingChangesPerDayInInterval` | insegnante — cambi edificio massimi al giorno in un intervallo | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeachersMaxBuildingChangesPerDayInInterval` | tutti gli insegnanti — cambi edificio massimi al giorno in un intervallo | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeacherMaxBuildingChangesPerRealDayInInterval` | insegnante — cambi edificio massimi per giorno reale in un intervallo | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMaxBuildingChangesPerRealDayInInterval` | tutti gli insegnanti — cambi edificio massimi per giorno reale in un intervallo | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherMaxRoomChangesPerDayInInterval` | insegnante — cambi aula massimi al giorno in un intervallo | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeachersMaxRoomChangesPerDayInInterval` | tutti gli insegnanti — cambi aula massimi al giorno in un intervallo | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeacherMaxRoomChangesPerRealDayInInterval` | insegnante — cambi aula massimi per giorno reale in un intervallo | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMaxRoomChangesPerRealDayInInterval` | tutti gli insegnanti — cambi aula massimi per giorno reale in un intervallo | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMaxBuildingChangesPerDay` | tutti gli insegnanti — cambi edificio massimi al giorno | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeacherMaxBuildingChangesPerWeek` | insegnante — cambi edificio massimi a settimana | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeachersMaxBuildingChangesPerWeek` | tutti gli insegnanti — cambi edificio massimi a settimana | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeacherMinGapsBetweenBuildingChanges` | insegnante — buchi minimi tra cambi di edificio | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeachersMinGapsBetweenBuildingChanges` | tutti gli insegnanti — buchi minimi tra cambi di edificio | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintStudentsSetMaxRoomChangesPerDay` | insieme di studenti — cambi aula massimi al giorno | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintStudentsMaxRoomChangesPerDay` | tutti gli studenti — cambi aula massimi al giorno | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintStudentsSetMaxRoomChangesPerWeek` | insieme di studenti — cambi aula massimi a settimana | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintStudentsMaxRoomChangesPerWeek` | tutti gli studenti — cambi aula massimi a settimana | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintStudentsSetMinGapsBetweenRoomChanges` | insieme di studenti — buchi minimi tra cambi di aula | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintStudentsMinGapsBetweenRoomChanges` | tutti gli studenti — buchi minimi tra cambi di aula | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeacherMaxRoomChangesPerDay` | insegnante — cambi aula massimi al giorno | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeachersMaxRoomChangesPerDay` | tutti gli insegnanti — cambi aula massimi al giorno | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeacherMaxRoomChangesPerWeek` | insegnante — cambi aula massimi a settimana | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeachersMaxRoomChangesPerWeek` | tutti gli insegnanti — cambi aula massimi a settimana | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeacherMinGapsBetweenRoomChanges` | insegnante — buchi minimi tra cambi di aula | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintTeachersMinGapsBetweenRoomChanges` | tutti gli insegnanti — buchi minimi tra cambi di aula | tutti | Bassa/media: qualità spostamenti; spesso soft (peso <100%). | Media se peso 100% con edifici multipli e poche pause. |
| `ConstraintActivitiesOccupyMaxDifferentRooms` | attività — occupano al massimo N aule diverse | tutti | Valutare se aule/edifici compaiono nel testo; altrimenti omettere. | Se attivo a peso alto, verificare capacità e conflitti aula. |
| `ConstraintActivitiesSameRoomIfConsecutive` | attività — stessa aula se consecutive | tutti | Media: da vincoli didattici (compresenze, ordine lab/teoria). | Media/alta: catene di allineamento possono irrigidire il grafo. |
| `ConstraintStudentsMaxRoomChangesPerRealDay` | tutti gli studenti — cambi aula massimi per giorno reale | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMaxRoomChangesPerRealDay` | insieme di studenti — cambi aula massimi per giorno reale | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherMaxRoomChangesPerRealDay` | insegnante — cambi aula massimi per giorno reale | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMaxRoomChangesPerRealDay` | tutti gli insegnanti — cambi aula massimi per giorno reale | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsMaxBuildingChangesPerRealDay` | tutti gli studenti — cambi edificio massimi per giorno reale | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintStudentsSetMaxBuildingChangesPerRealDay` | insieme di studenti — cambi edificio massimi per giorno reale | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeacherMaxBuildingChangesPerRealDay` | insegnante — cambi edificio massimi per giorno reale | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintTeachersMaxBuildingChangesPerRealDay` | tutti gli insegnanti — cambi edificio massimi per giorno reale | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |

### 5.5 Vincoli su aule/edifici (11)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintRoomMaxActivityTagsPerDayFromSet` | aula — massimo di chiavi attività al giorno da un insieme | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintRoomMaxActivityTagsPerRealDayFromSet` | aula — massimo di chiavi attività per giorno reale da un insieme | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintRoomMaxActivityTagsPerWeekFromSet` | aula — massimo di chiavi attività a settimana da un insieme | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintRoomsMaxActivityTagsPerDayFromSet` | tutte le aule — massimo di chiavi attività al giorno da un insieme | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintRoomsMaxActivityTagsPerRealDayFromSet` | tutte le aule — massimo di chiavi attività per giorno reale da un insieme | MA | Solo se Mode=Mornings_Afternoons (o regole MA esplicite). | Ignorare in Official tipico IT; in MA sono frequenti cause di blocco. |
| `ConstraintRoomsMaxActivityTagsPerWeekFromSet` | tutte le aule — massimo di chiavi attività a settimana da un insieme | tutti | Media: se il testo usa etichette (lab, teorica, sport). | Media: limiti per tag troppo stretti vs distribuzione. |
| `ConstraintBuildingMinOneActivityInEachAvailableTimeSlot` | edificio — almeno un’attività in ogni slot disponibile | tutti | Valutare se aule/edifici compaiono nel testo; altrimenti omettere. | Se attivo a peso alto, verificare capacità e conflitti aula. |
| `ConstraintBuildingsMinOneActivityInEachAvailableTimeSlot` | tutti gli edifici — almeno un’attività in ogni slot disponibile | tutti | Valutare se aule/edifici compaiono nel testo; altrimenti omettere. | Se attivo a peso alto, verificare capacità e conflitti aula. |
| `ConstraintRoomMaxActivitiesPerTeacher` | aula — massimo di attività per insegnante (in quell’aula) | tutti | Valutare se aule/edifici compaiono nel testo; altrimenti omettere. | Se attivo a peso alto, verificare capacità e conflitti aula. |
| `ConstraintRoomsMaxActivitiesPerTeacher` | tutte le aule — massimo di attività per insegnante (in quell’aula) | tutti | Valutare se aule/edifici compaiono nel testo; altrimenti omettere. | Se attivo a peso alto, verificare capacità e conflitti aula. |
| `ConstraintTeacherMaxActivitiesInRoom` | insegnante — massimo di attività dell’insegnante in un’aula | tutti | Valutare se aule/edifici compaiono nel testo; altrimenti omettere. | Se attivo a peso alto, verificare capacità e conflitti aula. |

### 5.6 Slot selezionati / mutuamente esclusivi (6)

| Tag XML | Descrizione (IT) | Mode | Gen | Diag |
|---------|------------------|------|-----|------|
| `ConstraintRoomPairOfMutuallyExclusiveTimeSlots` | aula — coppia di slot mutuamente esclusivi | tutti | Valutare se aule/edifici compaiono nel testo; altrimenti omettere. | Se attivo a peso alto, verificare capacità e conflitti aula. |
| `ConstraintRoomPairOfMutuallyExclusiveSetsOfTimeSlots` | aula — coppia di insiemi di slot mutuamente esclusivi | tutti | Valutare se aule/edifici compaiono nel testo; altrimenti omettere. | Se attivo a peso alto, verificare capacità e conflitti aula. |
| `ConstraintRoomOccupiesMaxSetsOfTimeSlotsFromSelection` | aula — occupa al massimo N insiemi di slot dalla selezione | tutti | Valutare se aule/edifici compaiono nel testo; altrimenti omettere. | Se attivo a peso alto, verificare capacità e conflitti aula. |
| `ConstraintRoomsPairOfMutuallyExclusiveTimeSlots` | tutte le aule — coppia di slot mutuamente esclusivi | tutti | Valutare se aule/edifici compaiono nel testo; altrimenti omettere. | Se attivo a peso alto, verificare capacità e conflitti aula. |
| `ConstraintRoomsPairOfMutuallyExclusiveSetsOfTimeSlots` | tutte le aule — coppia di insiemi di slot mutuamente esclusivi | tutti | Valutare se aule/edifici compaiono nel testo; altrimenti omettere. | Se attivo a peso alto, verificare capacità e conflitti aula. |
| `ConstraintRoomsOccupyMaxSetsOfTimeSlotsFromSelection` | tutte le aule — occupano al massimo N insiemi di slot dalla selezione | tutti | Valutare se aule/edifici compaiono nel testo; altrimenti omettere. | Se attivo a peso alto, verificare capacità e conflitti aula. |

---

## 6. Elenco piatto di verifica (tutti i tag)

### Tempo

1. `ConstraintBasicCompulsoryTime`
2. `ConstraintTeacherNotAvailableTimes`
3. `ConstraintStudentsSetNotAvailableTimes`
4. `ConstraintActivitiesSameStartingTime`
5. `ConstraintActivitiesNotOverlapping`
6. `ConstraintActivityTagsNotOverlapping`
7. `ConstraintMinDaysBetweenActivities`
8. `ConstraintMaxDaysBetweenActivities`
9. `ConstraintActivitiesMaxHourlySpan`
10. `ConstraintMinGapsBetweenActivities`
11. `ConstraintMaxGapsBetweenActivities`
12. `ConstraintTeachersMaxHoursDaily`
13. `ConstraintTeacherMaxHoursDaily`
14. `ConstraintTeacherMaxHoursDailyInInterval`
15. `ConstraintTeachersMaxHoursDailyInInterval`
16. `ConstraintStudentsSetMaxHoursDailyInInterval`
17. `ConstraintStudentsMaxHoursDailyInInterval`
18. `ConstraintTeachersMaxHoursContinuously`
19. `ConstraintTeacherMaxHoursContinuously`
20. `ConstraintTeachersActivityTagMaxHoursContinuously`
21. `ConstraintTeacherActivityTagMaxHoursContinuously`
22. `ConstraintTeacherMaxDaysPerWeek`
23. `ConstraintTeachersMaxDaysPerWeek`
24. `ConstraintTeacherMinDaysPerWeek`
25. `ConstraintTeachersMinDaysPerWeek`
26. `ConstraintBreakTimes`
27. `ConstraintStudentsMaxGapsPerWeek`
28. `ConstraintStudentsSetMaxGapsPerWeek`
29. `ConstraintTeachersMaxGapsPerWeek`
30. `ConstraintTeacherMaxGapsPerWeek`
31. `ConstraintTeachersMaxGapsPerDay`
32. `ConstraintTeacherMaxGapsPerDay`
33. `ConstraintTeachersMaxGapsPerMorningAndAfternoon`
34. `ConstraintTeacherMaxGapsPerMorningAndAfternoon`
35. `ConstraintStudentsEarlyMaxBeginningsAtSecondHour`
36. `ConstraintStudentsSetEarlyMaxBeginningsAtSecondHour`
37. `ConstraintStudentsMaxHoursDaily`
38. `ConstraintStudentsSetMaxHoursDaily`
39. `ConstraintStudentsMaxHoursContinuously`
40. `ConstraintStudentsSetMaxHoursContinuously`
41. `ConstraintStudentsActivityTagMaxHoursContinuously`
42. `ConstraintStudentsSetActivityTagMaxHoursContinuously`
43. `ConstraintStudentsMinHoursDaily`
44. `ConstraintStudentsSetMinHoursDaily`
45. `ConstraintActivityPreferredStartingTime`
46. `ConstraintActivityPreferredTimeSlots`
47. `ConstraintActivityPreferredStartingTimes`
48. `ConstraintActivitiesPreferredTimeSlots`
49. `ConstraintSubactivitiesPreferredTimeSlots`
50. `ConstraintActivitiesPreferredStartingTimes`
51. `ConstraintSubactivitiesPreferredStartingTimes`
52. `ConstraintActivitiesSameStartingHour`
53. `ConstraintActivitiesSameStartingDay`
54. `ConstraintTwoActivitiesConsecutive`
55. `ConstraintTwoActivitiesGrouped`
56. `ConstraintThreeActivitiesGrouped`
57. `ConstraintTwoActivitiesOrdered`
58. `ConstraintTwoSetsOfActivitiesOrdered`
59. `ConstraintTwoActivitiesOrderedIfSameDay`
60. `ConstraintActivityEndsStudentsDay`
61. `ConstraintTeachersMinHoursDaily`
62. `ConstraintTeacherMinHoursDaily`
63. `ConstraintTeacherIntervalMaxDaysPerWeek`
64. `ConstraintTeachersIntervalMaxDaysPerWeek`
65. `ConstraintStudentsSetIntervalMaxDaysPerWeek`
66. `ConstraintStudentsIntervalMaxDaysPerWeek`
67. `ConstraintActivitiesEndStudentsDay`
68. `ConstraintActivityEndsTeachersDay`
69. `ConstraintActivitiesEndTeachersDay`
70. `ConstraintTeachersActivityTagMaxHoursDaily`
71. `ConstraintTeacherActivityTagMaxHoursDaily`
72. `ConstraintStudentsActivityTagMaxHoursDaily`
73. `ConstraintStudentsSetActivityTagMaxHoursDaily`
74. `ConstraintTeachersActivityTagMinHoursDaily`
75. `ConstraintTeacherActivityTagMinHoursDaily`
76. `ConstraintStudentsActivityTagMinHoursDaily`
77. `ConstraintStudentsSetActivityTagMinHoursDaily`
78. `ConstraintStudentsMaxGapsPerDay`
79. `ConstraintStudentsSetMaxGapsPerDay`
80. `ConstraintActivitiesOccupyMaxTimeSlotsFromSelection`
81. `ConstraintActivitiesOccupyMinTimeSlotsFromSelection`
82. `ConstraintActivitiesMaxSimultaneousInSelectedTimeSlots`
83. `ConstraintActivitiesMinSimultaneousInSelectedTimeSlots`
84. `ConstraintMaxTotalActivitiesFromSetInSelectedTimeSlots`
85. `ConstraintActivitiesMaxInATerm`
86. `ConstraintActivitiesOccupyMaxTerms`
87. `ConstraintStudentsSetMaxDaysPerWeek`
88. `ConstraintStudentsMaxDaysPerWeek`
89. `ConstraintTeacherMaxSpanPerDay`
90. `ConstraintTeachersMaxSpanPerDay`
91. `ConstraintTeacherMinRestingHours`
92. `ConstraintTeachersMinRestingHours`
93. `ConstraintStudentsSetMaxSpanPerDay`
94. `ConstraintStudentsMaxSpanPerDay`
95. `ConstraintStudentsSetMinRestingHours`
96. `ConstraintStudentsMinRestingHours`
97. `ConstraintStudentsSetMinGapsBetweenOrderedPairOfActivityTags`
98. `ConstraintStudentsMinGapsBetweenOrderedPairOfActivityTags`
99. `ConstraintTeacherMinGapsBetweenOrderedPairOfActivityTags`
100. `ConstraintTeachersMinGapsBetweenOrderedPairOfActivityTags`
101. `ConstraintStudentsSetMinGapsBetweenActivityTag`
102. `ConstraintStudentsMinGapsBetweenActivityTag`
103. `ConstraintTeacherMinGapsBetweenActivityTag`
104. `ConstraintTeachersMinGapsBetweenActivityTag`
105. `ConstraintStudentsSetMinGapsBetweenOrderedPairOfActivityTagsPerRealDay`
106. `ConstraintStudentsMinGapsBetweenOrderedPairOfActivityTagsPerRealDay`
107. `ConstraintTeacherMinGapsBetweenOrderedPairOfActivityTagsPerRealDay`
108. `ConstraintTeachersMinGapsBetweenOrderedPairOfActivityTagsPerRealDay`
109. `ConstraintStudentsSetMinGapsBetweenActivityTagPerRealDay`
110. `ConstraintStudentsMinGapsBetweenActivityTagPerRealDay`
111. `ConstraintTeacherMinGapsBetweenActivityTagPerRealDay`
112. `ConstraintTeachersMinGapsBetweenActivityTagPerRealDay`
113. `ConstraintStudentsSetMinGapsBetweenOrderedPairOfActivityTagsBetweenMorningAndAfternoon`
114. `ConstraintStudentsMinGapsBetweenOrderedPairOfActivityTagsBetweenMorningAndAfternoon`
115. `ConstraintTeacherMinGapsBetweenOrderedPairOfActivityTagsBetweenMorningAndAfternoon`
116. `ConstraintTeachersMinGapsBetweenOrderedPairOfActivityTagsBetweenMorningAndAfternoon`
117. `ConstraintStudentsSetMinGapsBetweenActivityTagBetweenMorningAndAfternoon`
118. `ConstraintStudentsMinGapsBetweenActivityTagBetweenMorningAndAfternoon`
119. `ConstraintTeacherMinGapsBetweenActivityTagBetweenMorningAndAfternoon`
120. `ConstraintTeachersMinGapsBetweenActivityTagBetweenMorningAndAfternoon`
121. `ConstraintTeachersMaxHoursDailyRealDays`
122. `ConstraintTeacherMaxHoursDailyRealDays`
123. `ConstraintTeacherMaxRealDaysPerWeek`
124. `ConstraintTeachersMaxRealDaysPerWeek`
125. `ConstraintTeacherMinRealDaysPerWeek`
126. `ConstraintTeachersMinRealDaysPerWeek`
127. `ConstraintTeachersMaxGapsPerRealDay`
128. `ConstraintTeacherMaxGapsPerRealDay`
129. `ConstraintStudentsMaxHoursDailyRealDays`
130. `ConstraintStudentsSetMaxHoursDailyRealDays`
131. `ConstraintTeachersMinHoursPerMorning`
132. `ConstraintTeacherMinHoursPerMorning`
133. `ConstraintTeachersMinHoursDailyRealDays`
134. `ConstraintTeacherMinHoursDailyRealDays`
135. `ConstraintTeacherMorningIntervalMaxDaysPerWeek`
136. `ConstraintTeachersMorningIntervalMaxDaysPerWeek`
137. `ConstraintTeacherAfternoonIntervalMaxDaysPerWeek`
138. `ConstraintTeachersAfternoonIntervalMaxDaysPerWeek`
139. `ConstraintTeachersActivityTagMaxHoursDailyRealDays`
140. `ConstraintTeacherActivityTagMaxHoursDailyRealDays`
141. `ConstraintStudentsActivityTagMaxHoursDailyRealDays`
142. `ConstraintStudentsSetActivityTagMaxHoursDailyRealDays`
143. `ConstraintStudentsMaxGapsPerRealDay`
144. `ConstraintStudentsSetMaxGapsPerRealDay`
145. `ConstraintStudentsSetMaxRealDaysPerWeek`
146. `ConstraintStudentsMaxRealDaysPerWeek`
147. `ConstraintTeacherMaxSpanPerRealDay`
148. `ConstraintTeachersMaxSpanPerRealDay`
149. `ConstraintStudentsSetMaxSpanPerRealDay`
150. `ConstraintStudentsMaxSpanPerRealDay`
151. `ConstraintTeacherMaxAfternoonsPerWeek`
152. `ConstraintTeachersMaxAfternoonsPerWeek`
153. `ConstraintTeacherMaxMorningsPerWeek`
154. `ConstraintTeachersMaxMorningsPerWeek`
155. `ConstraintTeacherMaxActivityTagsPerDayFromSet`
156. `ConstraintTeachersMaxActivityTagsPerDayFromSet`
157. `ConstraintTeacherMinMorningsPerWeek`
158. `ConstraintTeachersMinMorningsPerWeek`
159. `ConstraintTeacherMinAfternoonsPerWeek`
160. `ConstraintTeachersMinAfternoonsPerWeek`
161. `ConstraintTeacherMaxTwoConsecutiveMornings`
162. `ConstraintTeachersMaxTwoConsecutiveMornings`
163. `ConstraintTeacherMaxTwoConsecutiveAfternoons`
164. `ConstraintTeachersMaxTwoConsecutiveAfternoons`
165. `ConstraintTeachersAfternoonsEarlyMaxBeginningsAtSecondHour`
166. `ConstraintTeacherAfternoonsEarlyMaxBeginningsAtSecondHour`
167. `ConstraintTeachersMorningsEarlyMaxBeginningsAtSecondHour`
168. `ConstraintTeacherMorningsEarlyMaxBeginningsAtSecondHour`
169. `ConstraintStudentsMinHoursPerMorning`
170. `ConstraintStudentsSetMinHoursPerMorning`
171. `ConstraintTeacherMaxZeroGapsPerAfternoon`
172. `ConstraintTeachersMaxZeroGapsPerAfternoon`
173. `ConstraintStudentsMaxAfternoonsPerWeek`
174. `ConstraintStudentsSetMaxAfternoonsPerWeek`
175. `ConstraintStudentsMaxMorningsPerWeek`
176. `ConstraintStudentsSetMaxMorningsPerWeek`
177. `ConstraintStudentsMinAfternoonsPerWeek`
178. `ConstraintStudentsSetMinAfternoonsPerWeek`
179. `ConstraintStudentsMinMorningsPerWeek`
180. `ConstraintStudentsSetMinMorningsPerWeek`
181. `ConstraintStudentsSetMorningIntervalMaxDaysPerWeek`
182. `ConstraintStudentsMorningIntervalMaxDaysPerWeek`
183. `ConstraintStudentsSetAfternoonIntervalMaxDaysPerWeek`
184. `ConstraintStudentsAfternoonIntervalMaxDaysPerWeek`
185. `ConstraintTeacherMaxHoursPerAllAfternoons`
186. `ConstraintTeachersMaxHoursPerAllAfternoons`
187. `ConstraintStudentsSetMaxHoursPerAllAfternoons`
188. `ConstraintStudentsMaxHoursPerAllAfternoons`
189. `ConstraintTeacherMinRestingHoursBetweenMorningAndAfternoon`
190. `ConstraintTeachersMinRestingHoursBetweenMorningAndAfternoon`
191. `ConstraintStudentsSetMinRestingHoursBetweenMorningAndAfternoon`
192. `ConstraintStudentsMinRestingHoursBetweenMorningAndAfternoon`
193. `ConstraintStudentsAfternoonsEarlyMaxBeginningsAtSecondHour`
194. `ConstraintStudentsSetAfternoonsEarlyMaxBeginningsAtSecondHour`
195. `ConstraintStudentsMorningsEarlyMaxBeginningsAtSecondHour`
196. `ConstraintStudentsSetMorningsEarlyMaxBeginningsAtSecondHour`
197. `ConstraintTeachersMaxGapsPerWeekForRealDays`
198. `ConstraintTeacherMaxGapsPerWeekForRealDays`
199. `ConstraintStudentsMaxGapsPerWeekForRealDays`
200. `ConstraintStudentsSetMaxGapsPerWeekForRealDays`
201. `ConstraintTeacherMaxThreeConsecutiveDays`
202. `ConstraintTeachersMaxThreeConsecutiveDays`
203. `ConstraintStudentsSetMaxThreeConsecutiveDays`
204. `ConstraintStudentsMaxThreeConsecutiveDays`
205. `ConstraintMinHalfDaysBetweenActivities`
206. `ConstraintActivityPreferredDay`
207. `ConstraintActivitiesMinInATerm`
208. `ConstraintMaxTermsBetweenActivities`
209. `ConstraintStudentsSetMaxActivityTagsPerDayFromSet`
210. `ConstraintStudentsMaxActivityTagsPerDayFromSet`
211. `ConstraintTeacherMaxActivityTagsPerRealDayFromSet`
212. `ConstraintTeachersMaxActivityTagsPerRealDayFromSet`
213. `ConstraintStudentsSetMaxActivityTagsPerRealDayFromSet`
214. `ConstraintStudentsMaxActivityTagsPerRealDayFromSet`
215. `ConstraintMaxHalfDaysBetweenActivities`
216. `ConstraintActivityBeginsStudentsDay`
217. `ConstraintActivitiesBeginStudentsDay`
218. `ConstraintActivityBeginsTeachersDay`
219. `ConstraintActivitiesBeginTeachersDay`
220. `ConstraintTeachersMinHoursPerAfternoon`
221. `ConstraintTeacherMinHoursPerAfternoon`
222. `ConstraintStudentsMinHoursPerAfternoon`
223. `ConstraintStudentsSetMinHoursPerAfternoon`
224. `ConstraintTeacherNoTwoConsecutiveDays`
225. `ConstraintTeachersNoTwoConsecutiveDays`
226. `ConstraintTeacherPairOfMutuallyExclusiveTimeSlots`
227. `ConstraintTeachersPairOfMutuallyExclusiveTimeSlots`
228. `ConstraintStudentsSetPairOfMutuallyExclusiveTimeSlots`
229. `ConstraintStudentsPairOfMutuallyExclusiveTimeSlots`
230. `ConstraintTwoSetsOfActivitiesSameSections`
231. `ConstraintStudentsMaxSingleGapsInSelectedTimeSlots`
232. `ConstraintStudentsSetMaxSingleGapsInSelectedTimeSlots`
233. `ConstraintTeacherMaxSingleGapsInSelectedTimeSlots`
234. `ConstraintTeachersMaxSingleGapsInSelectedTimeSlots`
235. `ConstraintTeacherMaxHoursPerTerm`
236. `ConstraintTeachersMaxHoursPerTerm`
237. `ConstraintTeacherPairOfMutuallyExclusiveSetsOfTimeSlots`
238. `ConstraintTeachersPairOfMutuallyExclusiveSetsOfTimeSlots`
239. `ConstraintStudentsSetPairOfMutuallyExclusiveSetsOfTimeSlots`
240. `ConstraintStudentsPairOfMutuallyExclusiveSetsOfTimeSlots`
241. `ConstraintActivitiesPairOfMutuallyExclusiveSetsOfTimeSlots`
242. `ConstraintActivitiesPairOfMutuallyExclusiveTimeSlots`
243. `ConstraintTeacherOccupiesMaxSetsOfTimeSlotsFromSelection`
244. `ConstraintTeachersOccupyMaxSetsOfTimeSlotsFromSelection`
245. `ConstraintStudentsSetOccupiesMaxSetsOfTimeSlotsFromSelection`
246. `ConstraintStudentsOccupyMaxSetsOfTimeSlotsFromSelection`
247. `ConstraintActivitiesOverlapCompletelyOrDoNotOverlap`
248. `ConstraintActivitiesOccupyMaxSetsOfTimeSlotsFromSelection`
249. `ConstraintActivityBeginsOrEndsStudentsDay`
250. `ConstraintActivitiesBeginOrEndStudentsDay`
251. `ConstraintActivityBeginsOrEndsTeachersDay`
252. `ConstraintActivitiesBeginOrEndTeachersDay`
253. `ConstraintActivitiesMaxTotalNumberOfStudentsInSelectedTimeSlots`
254. `ConstraintActivitiesMaxActivityTagsFromSetInSelectedTimeSlots`
255. `ConstraintMaxDaysBetweenEachPairOfConsecutiveActivities`
256. `ConstraintTeacherMaxActivityTagChangesPerDay`
257. `ConstraintTeachersMaxActivityTagChangesPerDay`
258. `ConstraintTeacherMaxActivityTagChangesPerWeek`
259. `ConstraintTeachersMaxActivityTagChangesPerWeek`
260. `ConstraintStudentsSetMaxActivityTagChangesPerDay`
261. `ConstraintStudentsMaxActivityTagChangesPerDay`
262. `ConstraintStudentsSetMaxActivityTagChangesPerWeek`
263. `ConstraintStudentsMaxActivityTagChangesPerWeek`
264. `ConstraintStudentsSetMaxSingleEarlyMorningGaps`
265. `ConstraintStudentsMaxSingleEarlyMorningGaps`
266. `ConstraintStudentsSetMaxSingleEarlyAfternoonGaps`
267. `ConstraintStudentsMaxSingleEarlyAfternoonGaps`
268. `ConstraintStudentsSetMaxSingleGapsBetweenMorningAndAfternoon`
269. `ConstraintStudentsMaxSingleGapsBetweenMorningAndAfternoon`
270. `ConstraintStudentsMaxHoursContinuouslyRealDays`
271. `ConstraintStudentsSetMaxHoursContinuouslyRealDays`
272. `ConstraintStudentsSetMaxSingleEarlyGaps`
273. `ConstraintStudentsMaxSingleEarlyGaps`
274. `ConstraintTeacherMaxSingleEarlyGaps`
275. `ConstraintTeachersMaxSingleEarlyGaps`

### Spazio

1. `ConstraintBasicCompulsorySpace`
2. `ConstraintRoomNotAvailableTimes`
3. `ConstraintTeacherRoomNotAvailableTimes`
4. `ConstraintActivityPreferredRoom`
5. `ConstraintActivityPreferredRooms`
6. `ConstraintStudentsSetHomeRoom`
7. `ConstraintStudentsSetHomeRooms`
8. `ConstraintTeacherHomeRoom`
9. `ConstraintTeacherHomeRooms`
10. `ConstraintSubjectPreferredRoom`
11. `ConstraintSubjectPreferredRooms`
12. `ConstraintSubjectActivityTagPreferredRoom`
13. `ConstraintSubjectActivityTagPreferredRooms`
14. `ConstraintActivityTagPreferredRoom`
15. `ConstraintActivityTagPreferredRooms`
16. `ConstraintStudentsSetMaxBuildingChangesPerDay`
17. `ConstraintStudentsMaxBuildingChangesPerDay`
18. `ConstraintStudentsSetMaxBuildingChangesPerDayInInterval`
19. `ConstraintStudentsMaxBuildingChangesPerDayInInterval`
20. `ConstraintStudentsSetMaxBuildingChangesPerRealDayInInterval`
21. `ConstraintStudentsMaxBuildingChangesPerRealDayInInterval`
22. `ConstraintStudentsSetMaxRoomChangesPerDayInInterval`
23. `ConstraintStudentsMaxRoomChangesPerDayInInterval`
24. `ConstraintStudentsSetMaxRoomChangesPerRealDayInInterval`
25. `ConstraintStudentsMaxRoomChangesPerRealDayInInterval`
26. `ConstraintStudentsSetMaxBuildingChangesPerWeek`
27. `ConstraintStudentsMaxBuildingChangesPerWeek`
28. `ConstraintStudentsSetMinGapsBetweenBuildingChanges`
29. `ConstraintStudentsMinGapsBetweenBuildingChanges`
30. `ConstraintTeacherMaxBuildingChangesPerDay`
31. `ConstraintTeacherMaxBuildingChangesPerDayInInterval`
32. `ConstraintTeachersMaxBuildingChangesPerDayInInterval`
33. `ConstraintTeacherMaxBuildingChangesPerRealDayInInterval`
34. `ConstraintTeachersMaxBuildingChangesPerRealDayInInterval`
35. `ConstraintTeacherMaxRoomChangesPerDayInInterval`
36. `ConstraintTeachersMaxRoomChangesPerDayInInterval`
37. `ConstraintTeacherMaxRoomChangesPerRealDayInInterval`
38. `ConstraintTeachersMaxRoomChangesPerRealDayInInterval`
39. `ConstraintTeachersMaxBuildingChangesPerDay`
40. `ConstraintTeacherMaxBuildingChangesPerWeek`
41. `ConstraintTeachersMaxBuildingChangesPerWeek`
42. `ConstraintTeacherMinGapsBetweenBuildingChanges`
43. `ConstraintTeachersMinGapsBetweenBuildingChanges`
44. `ConstraintStudentsSetMaxRoomChangesPerDay`
45. `ConstraintStudentsMaxRoomChangesPerDay`
46. `ConstraintStudentsSetMaxRoomChangesPerWeek`
47. `ConstraintStudentsMaxRoomChangesPerWeek`
48. `ConstraintStudentsSetMinGapsBetweenRoomChanges`
49. `ConstraintStudentsMinGapsBetweenRoomChanges`
50. `ConstraintTeacherMaxRoomChangesPerDay`
51. `ConstraintTeachersMaxRoomChangesPerDay`
52. `ConstraintTeacherMaxRoomChangesPerWeek`
53. `ConstraintTeachersMaxRoomChangesPerWeek`
54. `ConstraintTeacherMinGapsBetweenRoomChanges`
55. `ConstraintTeachersMinGapsBetweenRoomChanges`
56. `ConstraintActivitiesOccupyMaxDifferentRooms`
57. `ConstraintActivitiesSameRoomIfConsecutive`
58. `ConstraintStudentsMaxRoomChangesPerRealDay`
59. `ConstraintStudentsSetMaxRoomChangesPerRealDay`
60. `ConstraintTeacherMaxRoomChangesPerRealDay`
61. `ConstraintTeachersMaxRoomChangesPerRealDay`
62. `ConstraintStudentsMaxBuildingChangesPerRealDay`
63. `ConstraintStudentsSetMaxBuildingChangesPerRealDay`
64. `ConstraintTeacherMaxBuildingChangesPerRealDay`
65. `ConstraintTeachersMaxBuildingChangesPerRealDay`
66. `ConstraintRoomMaxActivityTagsPerDayFromSet`
67. `ConstraintRoomMaxActivityTagsPerRealDayFromSet`
68. `ConstraintRoomMaxActivityTagsPerWeekFromSet`
69. `ConstraintRoomPairOfMutuallyExclusiveTimeSlots`
70. `ConstraintRoomPairOfMutuallyExclusiveSetsOfTimeSlots`
71. `ConstraintRoomOccupiesMaxSetsOfTimeSlotsFromSelection`
72. `ConstraintRoomsMaxActivityTagsPerDayFromSet`
73. `ConstraintRoomsMaxActivityTagsPerRealDayFromSet`
74. `ConstraintRoomsMaxActivityTagsPerWeekFromSet`
75. `ConstraintRoomsPairOfMutuallyExclusiveTimeSlots`
76. `ConstraintRoomsPairOfMutuallyExclusiveSetsOfTimeSlots`
77. `ConstraintRoomsOccupyMaxSetsOfTimeSlotsFromSelection`
78. `ConstraintBuildingMinOneActivityInEachAvailableTimeSlot`
79. `ConstraintBuildingsMinOneActivityInEachAvailableTimeSlot`
80. `ConstraintRoomMaxActivitiesPerTeacher`
81. `ConstraintRoomsMaxActivitiesPerTeacher`
82. `ConstraintTeacherMaxActivitiesInRoom`

---

## 7. Gap e limiti di questo catalogo

Cose **incluse** perché presenti nei sorgenti 7.12.0 citati sopra.

Gap noti (non inventati qui; da approfondire in task successive se serve):

1. **Parametri interni per-tipo** (ogni campo XML figlio oltre a Weight/Active/Comments): non espansi uno-a-uno in questo documento; vanno letti da `getXmlDescription` / membri della classe quando si implementa l’emitter `.fet`.
2. **Messaggi di conflitto runtime** di `fet-cl` / `fitness()`: non catalogati; utili per la diagnosi automatica ma sono output, non configurazione.
3. **Opzioni CLI di `fet-cl`** (export HTML, timeout, ecc.): fuori scope “configurabile nel `.fet`”; vedi README FET e il setup MCP.
4. **Costanti `CONSTRAINT_*` negli header** (276 time / 83 space) sono 1 in più rispetto alle classi (275 / 82): tipicamente ID legacy/riserva; il catalogo ufficiale dei *tipi istanziabili* sono le classi `Constraint*`.
5. **Esempi** in `examples/` illustrano combinazioni reali ma non aggiungono tipi oltre agli header.
6. Descrizioni IT sono **parafrasi fedeli dei nomi ufficiali inglese** delle classi (e del ruolo documentato nei commenti/`getDetailedDescription` dove consultato); non sono nuovi vincoli.

---

## 8. Riferimenti file locali

- `C:\path\to\MCPFETIntegration\vendor\fet-src\fet-7.12.0\src\engine\timeconstraint.h`
- `C:\path\to\MCPFETIntegration\vendor\fet-src\fet-7.12.0\src\engine\spaceconstraint.h`
- `C:\path\to\MCPFETIntegration\vendor\fet-src\fet-7.12.0\src\engine\rules.h`
- `C:\path\to\MCPFETIntegration\vendor\fet-src\fet-7.12.0\src\engine\rules.cpp`
- `C:\path\to\MCPFETIntegration\vendor\FET_PIN.json`

