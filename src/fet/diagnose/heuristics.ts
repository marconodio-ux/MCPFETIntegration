import type { FetDocument } from "../document.js";
import type { DiagnoseBlocker } from "./types.js";

function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

function asStringArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter((x): x is string => !!x);
  const s = asString(v);
  return s ? [s] : [];
}

function weight100(fields: Record<string, unknown>): boolean {
  const w = asNumber(fields.Weight_Percentage);
  return w == null || w >= 100;
}

function isActive(fields: Record<string, unknown>): boolean {
  const a = asString(fields.Active);
  return a == null || a.toLowerCase() === "true";
}

function activityTeachers(fields: Record<string, unknown>): string[] {
  return asStringArray(fields.Teacher);
}

function activityStudents(fields: Record<string, unknown>): string[] {
  return [
    ...asStringArray(fields.Students),
    ...asStringArray(fields.Students_Set),
  ];
}

function collectStudentSetNames(doc: FetDocument): Set<string> {
  const names = new Set<string>();
  for (const y of doc.listEntities("students")) {
    const yearName = asString(y.fields.Name);
    if (yearName) names.add(yearName);
    const groups = y.fields.Group;
    const groupList = Array.isArray(groups) ? groups : groups ? [groups] : [];
    for (const g of groupList) {
      if (!g || typeof g !== "object") continue;
      const gf = g as Record<string, unknown>;
      const gName = asString(gf.Name);
      if (gName) names.add(gName);
      const subs = gf.Subgroup;
      const subList = Array.isArray(subs) ? subs : subs ? [subs] : [];
      for (const s of subList) {
        if (!s || typeof s !== "object") continue;
        const sn = asString((s as Record<string, unknown>).Name);
        if (sn) names.add(sn);
      }
    }
  }
  return names;
}

function notAvailableSlotCount(fields: Record<string, unknown>): number {
  const nested = fields.Not_Available_Time;
  if (Array.isArray(nested)) return nested.length;
  if (nested && typeof nested === "object") return 1;
  const n = asNumber(fields.Number_of_Not_Available_Times);
  return n ?? 0;
}

function preferredSlotCount(fields: Record<string, unknown>): number {
  const nested = fields.Preferred_Time_Slot;
  if (Array.isArray(nested)) return nested.length;
  if (nested && typeof nested === "object") return 1;
  const n = asNumber(fields.Number_of_Preferred_Time_Slots);
  return n ?? 0;
}

function breakSlotCount(fields: Record<string, unknown>): number {
  const nested = fields.Break_Time;
  if (Array.isArray(nested)) return nested.length;
  if (nested && typeof nested === "object") return 1;
  const n = asNumber(fields.Number_of_Break_Times);
  return n ?? 0;
}

/**
 * Static conflict heuristics on a FetDocument (no fet-cl required).
 * Catches common Italian-school overconstraints before / without running the solver.
 */
export function runStaticHeuristics(doc: FetDocument): DiagnoseBlocker[] {
  const blockers: DiagnoseBlocker[] = [];
  const days = doc.listEntities("days");
  const hours = doc.listEntities("hours");
  const nDays = days.length;
  const nHours = hours.length;
  const slotsPerWeek = nDays * nHours;

  const teachers = new Set(
    doc.listEntities("teachers").map((t) => asString(t.fields.Name)).filter((x): x is string => !!x),
  );
  const subjects = new Set(
    doc.listEntities("subjects").map((t) => asString(t.fields.Name)).filter((x): x is string => !!x),
  );
  const studentNames = collectStudentSetNames(doc);
  const activities = doc.listEntities("activities").filter((a) => {
    const active = asString(a.fields.Active);
    return active == null || active.toLowerCase() === "true";
  });

  const activityById = new Map<number, Record<string, unknown>>();
  for (const a of activities) {
    const id = asNumber(a.fields.Id);
    if (id != null) activityById.set(id, a.fields);
  }

  const timeCs = doc.listConstraints({ kind: "time" }).filter((c) => isActive(c.fields));
  const spaceCs = doc.listConstraints({ kind: "space" }).filter((c) => isActive(c.fields));

  const hasBasicTime = timeCs.some((c) => c.type === "ConstraintBasicCompulsoryTime" && weight100(c.fields));
  const hasBasicSpace = spaceCs.some((c) => c.type === "ConstraintBasicCompulsorySpace" && weight100(c.fields));
  if (!hasBasicTime) {
    blockers.push({
      code: "missing_basic_time",
      severity: "error",
      titleIt: "Manca il vincolo temporale obbligatorio di base",
      detailIt:
        "Senza ConstraintBasicCompulsoryTime a peso 100% FET non considera valido il modello temporale (docenti/classi non possono sovrapporsi).",
      suggestedFixIt: "Aggiungere ConstraintBasicCompulsoryTime con Weight_Percentage=100 e Active=true.",
      constraintTypes: ["ConstraintBasicCompulsoryTime"],
      source: "static",
      confidence: "high",
    });
  }
  if (!hasBasicSpace) {
    blockers.push({
      code: "missing_basic_space",
      severity: "warning",
      titleIt: "Manca il vincolo spaziale obbligatorio di base",
      detailIt:
        "Senza ConstraintBasicCompulsorySpace a peso 100% FET non applica le regole base sulle aule (sovrapposizioni aule).",
      suggestedFixIt: "Aggiungere ConstraintBasicCompulsorySpace con Weight_Percentage=100 e Active=true.",
      constraintTypes: ["ConstraintBasicCompulsorySpace"],
      source: "static",
      confidence: "high",
    });
  }

  if (nDays === 0 || nHours === 0) {
    blockers.push({
      code: "empty_calendar",
      severity: "error",
      titleIt: "Calendario giorni/ore vuoto",
      detailIt: `Giorni=${nDays}, ore=${nHours}. Non ci sono slot in cui collocare le attività.`,
      suggestedFixIt: "Definire Days_List e Hours_List (es. Lun–Ven e fasce orarie mattutine).",
      source: "static",
      confidence: "high",
    });
  }

  if (activities.length === 0) {
    blockers.push({
      code: "no_activities",
      severity: "error",
      titleIt: "Nessuna attività attiva",
      detailIt: "Il documento non contiene attività Active=true da orariare.",
      suggestedFixIt: "Aggiungere Activities (o usare fet_from_assignments) prima di generare.",
      source: "static",
      confidence: "high",
    });
  }

  // Broken references
  for (const a of activities) {
    const id = asNumber(a.fields.Id);
    for (const t of activityTeachers(a.fields)) {
      if (!teachers.has(t)) {
        blockers.push({
          code: "missing_teacher_ref",
          severity: "error",
          titleIt: `Attività ${id ?? "?"} riferisce docente assente`,
          detailIt: `Il docente "${t}" non è in Teachers_List.`,
          suggestedFixIt: `Aggiungere Teacher Name="${t}" oppure correggere il nome sull'attività.`,
          entities: [{ kind: "teachers", name: t }],
          activityIds: id != null ? [id] : undefined,
          source: "static",
          confidence: "high",
        });
      }
    }
    const subj = asString(a.fields.Subject);
    if (subj && !subjects.has(subj)) {
      blockers.push({
        code: "missing_subject_ref",
        severity: "error",
        titleIt: `Attività ${id ?? "?"} riferisce materia assente`,
        detailIt: `La materia "${subj}" non è in Subjects_List.`,
        suggestedFixIt: `Aggiungere Subject Name="${subj}" oppure correggere il nome sull'attività.`,
        entities: [{ kind: "subjects", name: subj }],
        activityIds: id != null ? [id] : undefined,
        source: "static",
        confidence: "high",
      });
    }
    for (const st of activityStudents(a.fields)) {
      if (studentNames.size > 0 && !studentNames.has(st)) {
        blockers.push({
          code: "missing_students_ref",
          severity: "warning",
          titleIt: `Attività ${id ?? "?"} riferisce classe non trovata`,
          detailIt: `L'insieme studenti "${st}" non compare in Year/Group/Subgroup.`,
          suggestedFixIt: `Verificare il nome della classe/sezione o aggiungerla in Students_List.`,
          entities: [{ kind: "students", name: st }],
          activityIds: id != null ? [id] : undefined,
          source: "static",
          confidence: "medium",
        });
      }
    }
  }

  // Duration longer than a day
  for (const a of activities) {
    const id = asNumber(a.fields.Id);
    const dur = asNumber(a.fields.Duration) ?? 1;
    if (nHours > 0 && dur > nHours) {
      blockers.push({
        code: "duration_exceeds_day",
        severity: "error",
        titleIt: `Attività ${id ?? "?"} più lunga di un giorno`,
        detailIt: `Duration=${dur} ma ci sono solo ${nHours} ore/giorno.`,
        suggestedFixIt: "Ridurre Duration o aumentare le fasce orarie giornaliere.",
        activityIds: id != null ? [id] : undefined,
        source: "static",
        evidence: `duration=${dur} hoursPerDay=${nHours}`,
        confidence: "high",
      });
    }
  }

  // Breaks reduce global slots
  let breakSlots = 0;
  for (const c of timeCs.filter((x) => x.type === "ConstraintBreakTimes" && weight100(x.fields))) {
    breakSlots = Math.max(breakSlots, breakSlotCount(c.fields));
  }
  const globalUsable = Math.max(0, slotsPerWeek - breakSlots);

  // Teacher NotAvailable maps
  const teacherNa = new Map<string, number>();
  for (const c of timeCs.filter((x) => x.type === "ConstraintTeacherNotAvailableTimes" && weight100(x.fields))) {
    const name = asString(c.fields.Teacher);
    if (!name) continue;
    teacherNa.set(name, Math.max(teacherNa.get(name) ?? 0, notAvailableSlotCount(c.fields)));
  }

  // Students set NotAvailable
  const studentsNa = new Map<string, number>();
  for (const c of timeCs.filter(
    (x) => x.type === "ConstraintStudentsSetNotAvailableTimes" && weight100(x.fields),
  )) {
    const name = asString(c.fields.Students) ?? asString(c.fields.Students_Set);
    if (!name) continue;
    studentsNa.set(name, Math.max(studentsNa.get(name) ?? 0, notAvailableSlotCount(c.fields)));
  }

  // Load per teacher / students
  const teacherLoad = new Map<string, { hours: number; activityIds: number[] }>();
  const studentLoad = new Map<string, { hours: number; activityIds: number[] }>();
  for (const a of activities) {
    const id = asNumber(a.fields.Id);
    const dur = asNumber(a.fields.Duration) ?? 1;
    for (const t of activityTeachers(a.fields)) {
      const cur = teacherLoad.get(t) ?? { hours: 0, activityIds: [] };
      cur.hours += dur;
      if (id != null) cur.activityIds.push(id);
      teacherLoad.set(t, cur);
    }
    for (const st of activityStudents(a.fields)) {
      const cur = studentLoad.get(st) ?? { hours: 0, activityIds: [] };
      cur.hours += dur;
      if (id != null) cur.activityIds.push(id);
      studentLoad.set(st, cur);
    }
  }

  for (const [teacher, load] of teacherLoad) {
    const na = teacherNa.get(teacher) ?? 0;
    const available = Math.max(0, globalUsable - na);
    if (slotsPerWeek > 0 && load.hours > available) {
      blockers.push({
        code: "teacher_hours_overflow",
        severity: "error",
        titleIt: `Docente "${teacher}": ore richieste > slot disponibili`,
        detailIt: `Il docente ha ${load.hours} ore di attività ma solo ~${available} slot utili (settimana ${slotsPerWeek}, pause ${breakSlots}, non disponibili ${na}).`,
        suggestedFixIt:
          "Ridurre il monte ore, allentare ConstraintTeacherNotAvailableTimes / BreakTimes, o aumentare giorni/ore.",
        constraintTypes: ["ConstraintTeacherNotAvailableTimes", "ConstraintBreakTimes"],
        entities: [{ kind: "teachers", name: teacher }],
        activityIds: load.activityIds,
        source: "static",
        evidence: `load=${load.hours} available≈${available} na=${na} breaks=${breakSlots}`,
        confidence: "high",
      });
    }
    // Fully unavailable but has work
    if (slotsPerWeek > 0 && na >= slotsPerWeek && load.hours > 0) {
      blockers.push({
        code: "teacher_fully_unavailable",
        severity: "error",
        titleIt: `Docente "${teacher}" non disponibile in tutti gli slot`,
        detailIt: `ConstraintTeacherNotAvailableTimes a 100% copre tutti gli ${slotsPerWeek} slot, ma restano ${load.hours} ore da collocare → tipico “Activity … has no allowed slot”.`,
        suggestedFixIt:
          "Rimuovere o ridurre le fasce NotAvailable del docente, oppure togliere/spostare le sue attività.",
        constraintTypes: ["ConstraintTeacherNotAvailableTimes"],
        entities: [{ kind: "teachers", name: teacher }],
        activityIds: load.activityIds,
        source: "static",
        confidence: "high",
      });
    }
  }

  for (const [st, load] of studentLoad) {
    const na = studentsNa.get(st) ?? 0;
    const available = Math.max(0, globalUsable - na);
    if (slotsPerWeek > 0 && load.hours > available) {
      blockers.push({
        code: "students_hours_overflow",
        severity: "error",
        titleIt: `Classe "${st}": ore richieste > slot disponibili`,
        detailIt: `La classe ha ${load.hours} ore di attività ma solo ~${available} slot utili (NA=${na}, pause=${breakSlots}).`,
        suggestedFixIt:
          "Ridurre incarichi sulla classe, allentare StudentsSetNotAvailableTimes / BreakTimes, o ampliare il calendario.",
        constraintTypes: ["ConstraintStudentsSetNotAvailableTimes", "ConstraintBreakTimes"],
        entities: [{ kind: "students", name: st }],
        activityIds: load.activityIds,
        source: "static",
        evidence: `load=${load.hours} available≈${available}`,
        confidence: "high",
      });
    }
  }

  // MinDaysBetweenActivities vs number of days / components
  for (const c of timeCs.filter((x) => x.type === "ConstraintMinDaysBetweenActivities" && weight100(x.fields))) {
    const minDays = asNumber(c.fields.MinDays) ?? asNumber(c.fields.Min_Days) ?? 1;
    const ids = [
      ...asStringArray(c.fields.Activity_Id).map(Number).filter((n) => !Number.isNaN(n)),
      ...(Array.isArray(c.fields.Activity_Id)
        ? []
        : asNumber(c.fields.Activity_Id) != null
          ? [asNumber(c.fields.Activity_Id)!]
          : []),
    ];
    // Activity_Id may be repeated tags → already in asStringArray path; also Number_of_Activities
    const nAct =
      asNumber(c.fields.Number_of_Activities) ??
      (Array.isArray(c.fields.Activity_Id) ? c.fields.Activity_Id.length : ids.length || 0);
    const uniqueIds = [...new Set(ids.length ? ids : [])];
    const componentCount = uniqueIds.length || nAct;
    // Need at least 1 + (components-1)*minDays distinct day placements roughly
    const minDaysNeeded = componentCount <= 1 ? 1 : 1 + (componentCount - 1) * minDays;
    if (nDays > 0 && minDaysNeeded > nDays) {
      blockers.push({
        code: "mindays_overflow",
        severity: "error",
        titleIt: "MinDays tra attività incompatibile col numero di giorni",
        detailIt: `ConstraintMinDaysBetweenActivities con ${componentCount} componenti e MinDays=${minDays} richiederebbe almeno ~${minDaysNeeded} giorni, ma ce ne sono ${nDays}.`,
        suggestedFixIt:
          "Ridurre MinDays, ridurre i pezzi dello split, oppure aumentare i giorni della settimana.",
        constraintTypes: ["ConstraintMinDaysBetweenActivities"],
        activityIds: uniqueIds.length ? uniqueIds : undefined,
        source: "static",
        evidence: `components=${componentCount} minDays=${minDays} days=${nDays}`,
        confidence: "high",
      });
    }
  }

  // Preferred time slots / starting time at 100% with zero slots or teacher clash
  const preferredStartByTeacher = new Map<string, Array<{ activityId: number; day: string; hour: string }>>();
  for (const c of timeCs.filter(
    (x) =>
      (x.type === "ConstraintActivityPreferredStartingTime" ||
        x.type === "ConstraintActivityPreferredTimeSlots") &&
      weight100(x.fields),
  )) {
    const actId = asNumber(c.fields.Activity_Id);
    if (c.type === "ConstraintActivityPreferredTimeSlots") {
      const n = preferredSlotCount(c.fields);
      if (n === 0) {
        blockers.push({
          code: "preferred_slots_empty",
          severity: "error",
          titleIt: `PreferredTimeSlots vuoto per attività ${actId ?? "?"}`,
          detailIt: "Vincolo a peso 100% senza slot preferiti: l'attività non ha fasce ammesse.",
          suggestedFixIt: "Aggiungere Preferred_Time_Slot oppure abbassare il peso / disattivare il vincolo.",
          constraintTypes: ["ConstraintActivityPreferredTimeSlots"],
          activityIds: actId != null ? [actId] : undefined,
          source: "static",
          confidence: "high",
        });
      }
    }
    if (c.type === "ConstraintActivityPreferredStartingTime" && actId != null) {
      const day = asString(c.fields.Day) ?? asString(c.fields.Preferred_Day) ?? "";
      const hour = asString(c.fields.Hour) ?? asString(c.fields.Preferred_Hour) ?? "";
      const fields = activityById.get(actId);
      if (fields) {
        for (const t of activityTeachers(fields)) {
          const list = preferredStartByTeacher.get(t) ?? [];
          list.push({ activityId: actId, day, hour });
          preferredStartByTeacher.set(t, list);
        }
      }
    }
  }

  for (const [teacher, slots] of preferredStartByTeacher) {
    const keyCount = new Map<string, number[]>();
    for (const s of slots) {
      const key = `${s.day}|${s.hour}`;
      const arr = keyCount.get(key) ?? [];
      arr.push(s.activityId);
      keyCount.set(key, arr);
    }
    for (const [key, ids] of keyCount) {
      if (ids.length >= 2 && key !== "|") {
        const [day, hour] = key.split("|");
        blockers.push({
          code: "preferred_start_teacher_clash",
          severity: "error",
          titleIt: `Docente "${teacher}": più attività fissate allo stesso inizio`,
          detailIt: `ConstraintActivityPreferredStartingTime a 100% forza le attività ${ids.join(", ")} su ${day} ${hour}.`,
          suggestedFixIt: "Cambiare Day/Hour di una delle preferenze, oppure abbassare il peso sotto 100%.",
          constraintTypes: ["ConstraintActivityPreferredStartingTime"],
          entities: [{ kind: "teachers", name: teacher }],
          activityIds: ids,
          source: "static",
          confidence: "high",
        });
      }
    }
  }

  // Constraint references to missing activity ids
  for (const c of [...timeCs, ...spaceCs]) {
    const rawIds = asStringArray(c.fields.Activity_Id)
      .map(Number)
      .filter((n) => !Number.isNaN(n));
    const single = asNumber(c.fields.Activity_Id);
    const ids = rawIds.length ? rawIds : single != null ? [single] : [];
    for (const id of ids) {
      if (!activityById.has(id)) {
        blockers.push({
          code: "constraint_missing_activity",
          severity: "warning",
          titleIt: `Vincolo ${c.type} punta ad attività ${id} assente`,
          detailIt: "Il vincolo riferisce un Id non presente (o non Active) in Activities_List.",
          suggestedFixIt: "Correggere Activity_Id o ripristinare l'attività.",
          constraintTypes: [c.type],
          activityIds: [id],
          source: "static",
          confidence: "medium",
        });
      }
    }
  }

  // Deduplicate similar blockers by code+title
  const seen = new Set<string>();
  return blockers.filter((b) => {
    const key = `${b.code}|${b.titleIt}|${(b.activityIds ?? []).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
