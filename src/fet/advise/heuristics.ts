/**
 * School-timetable constraint heuristics (common IT school practice).
 * Maps findings only to real FET 7.12 catalog types.
 */

import type { FetDocument } from "../document.js";
import { getConstraintType } from "../catalog.js";
import type { AdviseConfidence, AdviseSuggestion } from "./types.js";

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

function isActive(fields: Record<string, unknown>): boolean {
  const a = asString(fields.Active);
  return a == null || a.toLowerCase() === "true";
}

function activityIdsOf(fields: Record<string, unknown>): number[] {
  const raw = fields.Activity_Id ?? fields.Activity;
  return asStringArray(raw)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
}

function catalogKind(type: string): "time" | "space" | "generation_option" {
  return getConstraintType(type)?.kind ?? "time";
}

function assertCatalog(type: string): void {
  if (!getConstraintType(type)) {
    throw new Error(`Advise heuristic referenced unknown catalog type: ${type}`);
  }
}

/** Lab / workshop / gym style subjects that typically need a dedicated room. */
const LAB_SUBJECT_RE =
  /\b(lab\.?|laboratorio|cnc|officina|palestra|informatica|aula\s*magna|sistemi|automazione|disegno)\b/i;

const INTENT_BREAK_RE = /\b(pausa|ricreazione|intervallo|break\s*time|ora\s+buca\s+obbligatoria)\b/i;
const INTENT_MAX_HOURS_RE =
  /\b(max(?:imo)?\s*\d+\s*ore?\s*(?:al\s*)?giorno|non\s+pi[uù]\s+di\s*\d+\s*ore?\s*(?:al\s*)?giorno|max\s*hours?\s*daily)\b/i;
const INTENT_NOT_AVAILABLE_RE =
  /\b(non\s+disponibil[ei]|indisponibil|libero\s+il|non\s+pu[oò]\s+(?:venire|insegnare)|not\s+available)\b/i;
const INTENT_CONSECUTIVE_RE =
  /\b(due\s+ore\s+consecutive|blocco\s+di\s+due|consecutive|una\s+dopo\s+l['']altra)\b/i;
const INTENT_ROOM_RE =
  /\b(?:aula|lab(?:oratorio)?\.?|room)\s*[:=]?\s*([A-Za-z0-9._-]{2,20})\b/gi;

interface ActivityView {
  id: number;
  groupId: number;
  teacher: string;
  subject: string;
  students: string;
  duration: number;
  tags: string[];
}

function listActiveActivities(doc: FetDocument): ActivityView[] {
  const out: ActivityView[] = [];
  for (const a of doc.listEntities("activities")) {
    if (!isActive(a.fields)) continue;
    const id = asNumber(a.fields.Id);
    if (id == null) continue;
    out.push({
      id,
      groupId: asNumber(a.fields.Activity_Group_Id) ?? 0,
      teacher: asStringArray(a.fields.Teacher)[0] ?? "",
      subject: asString(a.fields.Subject) ?? "",
      students: asStringArray(a.fields.Students)[0] ?? "",
      duration: asNumber(a.fields.Duration) ?? 1,
      tags: asStringArray(a.fields.Activity_Tag),
    });
  }
  return out;
}

function subgroupSiblingKey(students: string): { group: string; half: string } | null {
  // P1A-meccanica / P1A-Elettro / P1A_mec
  const m = students.match(/^([A-Za-z0-9]+)[-_](.+)$/);
  if (!m) return null;
  return { group: m[1]!, half: m[2]!.toLowerCase() };
}

function collectCoveredMinDays(doc: FetDocument): Set<number> {
  const covered = new Set<number>();
  for (const c of doc.listConstraints({ type: "ConstraintMinDaysBetweenActivities" })) {
    if (!isActive(c.fields)) continue;
    for (const id of activityIdsOf(c.fields)) covered.add(id);
  }
  return covered;
}

function collectCoveredSameStarting(doc: FetDocument): Set<string> {
  /** Canonical pair keys "a|b" with a<b. */
  const keys = new Set<string>();
  for (const c of doc.listConstraints({ type: "ConstraintActivitiesSameStartingTime" })) {
    if (!isActive(c.fields)) continue;
    const ids = activityIdsOf(c.fields).sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        keys.add(`${ids[i]}|${ids[j]}`);
      }
    }
  }
  return keys;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function subjectsWithPreferredRoom(doc: FetDocument): Set<string> {
  const set = new Set<string>();
  for (const type of [
    "ConstraintSubjectPreferredRoom",
    "ConstraintSubjectPreferredRooms",
  ] as const) {
    for (const c of doc.listConstraints({ type })) {
      if (!isActive(c.fields)) continue;
      const subj = asString(c.fields.Subject);
      if (subj) set.add(subj);
    }
  }
  // Also activity-level preferred rooms covering a subject's activities
  const actRoom = new Set<number>();
  for (const c of doc.listConstraints({ type: "ConstraintActivityPreferredRoom" })) {
    if (!isActive(c.fields)) continue;
    const id = asNumber(c.fields.Activity_Id);
    if (id != null) actRoom.add(id);
  }
  if (actRoom.size) {
    for (const a of listActiveActivities(doc)) {
      if (actRoom.has(a.id)) set.add(a.subject);
    }
  }
  return set;
}

function roomNames(doc: FetDocument): string[] {
  return doc
    .listEntities("rooms")
    .map((r) => asString(r.fields.Name))
    .filter((x): x is string => !!x);
}

function guessLabRoom(subject: string, rooms: string[]): { room: string; guessed: boolean } {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const sn = norm(subject);
  for (const r of rooms) {
    const rn = norm(r);
    if (rn.includes("lab") && (sn.includes(rn) || rn.includes(sn.slice(0, 8)))) {
      return { room: r, guessed: false };
    }
    // Orario-style: LAB. CNC → M09 etc. — match token overlap
    const tokens = subject.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    if (tokens.some((t) => rn.includes(t) && t !== "lab" && t !== "laboratorio")) {
      return { room: r, guessed: false };
    }
  }
  // Synthesize a room name from subject (apply will create it)
  let short = subject.trim();
  if (/^lab(?:oratorio)?\.?\s+/i.test(short)) {
    short = short.replace(/^lab(?:oratorio)?\.?\s+/i, "LAB ").trim();
  } else if (/^laboratorio$/i.test(short)) {
    short = "LAB";
  } else if (!/^lab\b/i.test(short)) {
    short = `LAB ${short}`;
  } else {
    short = short.replace(/^lab\.?\s*/i, "LAB ").trim();
  }
  return { room: short.slice(0, 40), guessed: true };
}

function parseIntentRoomHints(text: string | undefined): Map<string, string> {
  /** subject-ish → room (loose). */
  const map = new Map<string, string>();
  if (!text) return map;
  for (const m of text.matchAll(INTENT_ROOM_RE)) {
    const room = m[1];
    if (room) map.set(room.toLowerCase(), room);
  }
  return map;
}

function parseMaxHoursFromText(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.match(
    /(?:max(?:imo)?|non\s+pi[uù]\s+di)\s*(\d+)\s*ore?\s*(?:al\s*)?giorno|max\s*hours?\s*daily\s*[=:]?\s*(\d+)/i,
  );
  if (!m) return undefined;
  const n = Number(m[1] ?? m[2]);
  return Number.isFinite(n) ? n : undefined;
}

function confidenceRank(c: AdviseConfidence): number {
  return c === "high" ? 0 : c === "medium" ? 1 : 2;
}

/**
 * Analyze a FetDocument (+ optional intent text) and return ranked constraint suggestions.
 */
export function runAdviseHeuristics(
  doc: FetDocument,
  text?: string,
): { suggestions: AdviseSuggestion[]; intentHints: string[] } {
  const suggestions: AdviseSuggestion[] = [];
  const intentHints: string[] = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  const activities = listActiveActivities(doc);
  const days = doc.listEntities("days");
  const hours = doc.listEntities("hours");
  const nHours = hours.length;
  const hourNames = hours.map((h) => asString(h.fields.Name)).filter((x): x is string => !!x);
  const dayNames = days.map((d) => asString(d.fields.Name)).filter((x): x is string => !!x);
  const rooms = roomNames(doc);
  const coveredMin = collectCoveredMinDays(doc);
  const coveredSst = collectCoveredSameStarting(doc);
  const preferredSubjects = subjectsWithPreferredRoom(doc);
  const intentRooms = parseIntentRoomHints(text);

  if (text?.trim()) {
    if (INTENT_BREAK_RE.test(text)) intentHints.push("break_times");
    if (INTENT_MAX_HOURS_RE.test(text)) intentHints.push("max_hours_daily");
    if (INTENT_NOT_AVAILABLE_RE.test(text)) intentHints.push("not_available");
    if (INTENT_CONSECUTIVE_RE.test(text)) intentHints.push("consecutive");
    if (LAB_SUBJECT_RE.test(text) || intentRooms.size) intentHints.push("lab_rooms");
    if (/stesso\s+orario|parallelo|classe\s+spezzata|same\s+starting/i.test(text)) {
      intentHints.push("same_starting");
    }
    if (/min\s*days|giorni\s+minim|distribui|spargi|separa\s+le\s+ore/i.test(text)) {
      intentHints.push("min_days");
    }
  }

  // --- 1. MinDays on multi-component splits ---
  assertCatalog("ConstraintMinDaysBetweenActivities");
  const byGroup = new Map<number, ActivityView[]>();
  for (const a of activities) {
    if (a.groupId <= 0) continue;
    if (!byGroup.has(a.groupId)) byGroup.set(a.groupId, []);
    byGroup.get(a.groupId)!.push(a);
  }
  for (const [groupId, comps] of byGroup) {
    if (comps.length < 2) continue;
    const uncovered = comps.filter((c) => !coveredMin.has(c.id));
    if (uncovered.length < 2 && comps.every((c) => coveredMin.has(c.id))) continue;
    if (comps.every((c) => coveredMin.has(c.id))) continue;
    const ids = comps.map((c) => c.id).sort((a, b) => a - b);
    const sample = comps[0]!;
    suggestions.push({
      id: nextId("mindays"),
      type: "ConstraintMinDaysBetweenActivities",
      kind: catalogKind("ConstraintMinDaysBetweenActivities"),
      confidence: "high",
      code: "min_days_missing",
      titleIt: `Distribuire lo split di ${sample.subject} (${sample.teacher}) su più giorni`,
      rationaleIt: `L’attività «${sample.subject}» per ${sample.students} è spezzata in ${comps.length} componenti (Activity_Group_Id=${groupId}) senza ConstraintMinDaysBetweenActivities. Nella pratica scolastica italiana MinDays=1 evita che tutte le ore finiscano lo stesso giorno.`,
      improvesIt:
        "Ore della stessa materia più equilibrate nella settimana; meno giornate sovraccariche per classe e docente.",
      fieldsDraft: {
        Weight_Percentage: "95",
        Consecutive_If_Same_Day: "true",
        Number_of_Activities: String(ids.length),
        Activity_Id: ids.map(String),
        MinDays: "1",
        Active: "true",
        Comments: `advise:mindays group=${groupId} ${sample.teacher}/${sample.subject}`,
      },
      entities: [
        { kind: "teacher", name: sample.teacher },
        { kind: "subject", name: sample.subject },
        { kind: "students", name: sample.students },
      ],
      activityIds: ids,
    });
  }

  // --- 2. SameStartingTime for parallel subgroup halves ---
  assertCatalog("ConstraintActivitiesSameStartingTime");
  const byStudents = new Map<string, ActivityView[]>();
  for (const a of activities) {
    if (!a.students) continue;
    if (!byStudents.has(a.students)) byStudents.set(a.students, []);
    byStudents.get(a.students)!.push(a);
  }
  const siblingGroups = new Map<string, Map<string, ActivityView[]>>();
  for (const [stu, acts] of byStudents) {
    const sib = subgroupSiblingKey(stu);
    if (!sib) continue;
    if (!siblingGroups.has(sib.group)) siblingGroups.set(sib.group, new Map());
    siblingGroups.get(sib.group)!.set(sib.half, acts);
  }
  for (const [group, halves] of siblingGroups) {
    const halfNames = [...halves.keys()];
    if (halfNames.length < 2) continue;
    for (let i = 0; i < halfNames.length; i++) {
      for (let j = i + 1; j < halfNames.length; j++) {
        const ha = halfNames[i]!;
        const hb = halfNames[j]!;
        const actsA = [...(halves.get(ha) ?? [])].sort((a, b) => a.id - b.id);
        const actsB = [...(halves.get(hb) ?? [])].sort((a, b) => a.id - b.id);
        const n = Math.min(actsA.length, actsB.length);
        if (n < 1) continue;
        // Prefer pairing similar durations / lab-ish subjects
        const pairs: Array<[ActivityView, ActivityView]> = [];
        const usedB = new Set<number>();
        const isLabish = (x: ActivityView) =>
          LAB_SUBJECT_RE.test(x.subject) || /lab/i.test(x.subject);
        for (const a of actsA) {
          const candidates = actsB.filter((b) => !usedB.has(b.id) && b.duration === a.duration);
          const match =
            candidates.find((b) => isLabish(a) || isLabish(b)) ?? candidates[0];
          if (!match) continue;
          usedB.add(match.id);
          if (coveredSst.has(pairKey(a.id, match.id))) continue;
          pairs.push([a, match]);
        }
        for (const [a, b] of pairs) {
          const boosted = intentHints.includes("same_starting");
          suggestions.push({
            id: nextId("sst"),
            type: "ConstraintActivitiesSameStartingTime",
            kind: catalogKind("ConstraintActivitiesSameStartingTime"),
            confidence: boosted || LAB_SUBJECT_RE.test(a.subject) || LAB_SUBJECT_RE.test(b.subject)
              ? "high"
              : "medium",
            code: "same_starting_parallel",
            titleIt: `Allineare in parallelo ${group}: ${ha} ↔ ${hb}`,
            rationaleIt: `La classe ${group} è spezzata in sottogruppi (${ha}/${hb}). Le attività ${a.id} (${a.teacher}/${a.subject}) e ${b.id} (${b.teacher}/${b.subject}) dovrebbero partire insieme (ConstraintActivitiesSameStartingTime), come nei lab paralleli tipici, altrimenti una metà resta senza docente/aula nello stesso slot.`,
            improvesIt:
              "Le due metà della classe lavorano nello stesso orario; niente buchi forzati su un sottogruppo mentre l’altro è in lab.",
            fieldsDraft: {
              Weight_Percentage: "100",
              Number_of_Activities: "2",
              Activity_Id: [String(a.id), String(b.id)],
              Active: "true",
              Comments: `advise:sst ${group} ${ha}↔${hb}`,
            },
            entities: [
              { kind: "students", name: `${group}-${ha}` },
              { kind: "students", name: `${group}-${hb}` },
              { kind: "teacher", name: a.teacher },
              { kind: "teacher", name: b.teacher },
            ],
            activityIds: [a.id, b.id],
          });
        }
      }
    }
  }

  // --- 3. PreferredRoom for LAB subjects ---
  assertCatalog("ConstraintSubjectPreferredRoom");
  const labSubjects = [
    ...new Set(
      activities
        .map((a) => a.subject)
        .filter((s) => LAB_SUBJECT_RE.test(s) || /lab/i.test(s)),
    ),
  ].sort((a, b) => a.localeCompare(b, "it"));

  for (const subject of labSubjects) {
    if (preferredSubjects.has(subject)) continue;
    const guess = guessLabRoom(subject, rooms);
    // Prefer an explicit room mentioned in intent text if any
    let room = guess.room;
    let guessed = guess.guessed;
    if (intentRooms.size === 1) {
      room = [...intentRooms.values()][0]!;
      guessed = !rooms.includes(room);
    } else if (intentRooms.size > 1) {
      // keep guess
    }
    const creates = rooms.includes(room)
      ? undefined
      : [{ kind: "rooms" as const, name: room }];
    const conf: AdviseConfidence =
      !guessed || intentHints.includes("lab_rooms") ? "high" : "medium";
    suggestions.push({
      id: nextId("prefroom"),
      type: "ConstraintSubjectPreferredRoom",
      kind: catalogKind("ConstraintSubjectPreferredRoom"),
      confidence: conf,
      code: "lab_preferred_room",
      titleIt: `Aula dedicata per «${subject}»`,
      rationaleIt: `La materia «${subject}» è tipicamente di laboratorio/officina. In molte scuole IT le materie LAB.* usano ConstraintSubjectPreferredRoom (o PreferredRooms) verso aule attrezzate. Qui manca qualsiasi vincolo di spazio su questa materia.`,
      improvesIt:
        "Il generatore colloca le ore di lab solo nell’aula attrezzata, evitando aule normali insufficienti e conflitti di attrezzature.",
      fieldsDraft: {
        Weight_Percentage: "100",
        Subject: subject,
        Room: room,
        Active: "true",
        Comments: `advise:prefroom ${subject}→${room}`,
      },
      entities: [
        { kind: "subject", name: subject },
        { kind: "room", name: room },
      ],
      createsEntities: creates,
      cautionIt: guessed
        ? `Nome aula «${room}» proposto automaticamente: rinominalo se la scuola usa un codice diverso (es. M08-00).`
        : undefined,
    });
  }

  // --- 4. BreakTimes when calendar is long / intent mentions pause (Orario: 1) ---
  assertCatalog("ConstraintBreakTimes");
  const hasBreak = doc
    .listConstraints({ type: "ConstraintBreakTimes" })
    .some((c) => isActive(c.fields));
  if (!hasBreak && (nHours >= 6 || intentHints.includes("break_times")) && dayNames.length && hourNames.length) {
    const breakHour =
      hourNames.length >= 6 ? hourNames[hourNames.length - 1]! : hourNames[Math.floor(hourNames.length / 2)]!;
    const slots = dayNames.map((d) => ({ Day: d, Hour: breakHour }));
    suggestions.push({
      id: nextId("break"),
      type: "ConstraintBreakTimes",
      kind: catalogKind("ConstraintBreakTimes"),
      confidence: intentHints.includes("break_times") ? "high" : "medium",
      code: "break_times_missing",
      titleIt: `Pausa / ora non didattica (${breakHour})`,
      rationaleIt: `Il calendario ha ${nHours} ore/giorno e non c’è ConstraintBreakTimes. Nelle scuole IT spesso l’ultima ora (o una fascia centrale) è pausa o non usata per tutte le classi; spesso si marcano slot di break espliciti.`,
      improvesIt:
        "FET non colloca lezioni negli slot di pausa; l’orario rispetta ricreazione/uscita anticipata senza vincoli NotAvailable ripetuti su ogni classe.",
      fieldsDraft: {
        Weight_Percentage: "100",
        Number_of_Break_Times: String(slots.length),
        Break_Time: slots,
        Active: "true",
        Comments: `advise:break ${breakHour}`,
      },
      cautionIt:
        "Verifica quali giorni/ore sono davvero pausa nella tua scuola prima di applicare a peso 100%.",
    });
  }

  // --- 5. TeachersMaxHoursDaily (Orario had the type; IT practice ~5h) ---
  assertCatalog("ConstraintTeachersMaxHoursDaily");
  const hasMaxDaily = doc
    .listConstraints({ type: "ConstraintTeachersMaxHoursDaily" })
    .some((c) => isActive(c.fields));
  const hasTeacherMax = doc
    .listConstraints({ type: "ConstraintTeacherMaxHoursDaily" })
    .some((c) => isActive(c.fields));
  const teacherHours = new Map<string, number>();
  for (const a of activities) {
    if (!a.teacher) continue;
    teacherHours.set(a.teacher, (teacherHours.get(a.teacher) ?? 0) + a.duration);
  }
  const heavyTeachers = [...teacherHours.entries()].filter(([, h]) => h >= 10);
  const maxFromText = parseMaxHoursFromText(text);
  const suggestedMax = maxFromText ?? Math.min(5, Math.max(4, nHours - 1 || 5));
  if (
    !hasMaxDaily &&
    !hasTeacherMax &&
    (intentHints.includes("max_hours_daily") || heavyTeachers.length > 0 || nHours >= 6)
  ) {
    suggestions.push({
      id: nextId("maxh"),
      type: "ConstraintTeachersMaxHoursDaily",
      kind: catalogKind("ConstraintTeachersMaxHoursDaily"),
      confidence: intentHints.includes("max_hours_daily") || maxFromText != null ? "high" : "medium",
      code: "max_hours_daily",
      titleIt: `Limite ore giornaliere docenti (max ${suggestedMax})`,
      rationaleIt: `Nessun ConstraintTeachersMaxHoursDaily attivo. Con ${heavyTeachers.length || "alcuni"} docenti caricati (≥10h/sett) e ${nHours || "?"} fasce/giorno, un tetto (tipico IT: 4–5 ore) evita giornate estenuanti. È un vincolo tipico negli orari scolastici IT.`,
      improvesIt:
        "Distribuisce il monte ore dei docenti su più giorni; riduce le giornate da 6–7 ore consecutive.",
      fieldsDraft: {
        Weight_Percentage: maxFromText != null ? "100" : "95",
        Maximum_Hours_Daily: String(suggestedMax),
        Active: "true",
        Comments: `advise:maxhours ${suggestedMax}`,
      },
      entities: heavyTeachers.slice(0, 5).map(([name]) => ({ kind: "teacher", name })),
      cautionIt:
        "A peso 100% può rendere l’orario impossibile se un docente ha poche disponibilità: preferisci 95% se non sei sicuro.",
    });
  }

  // --- 6. NotAvailable from intent text (teacher) ---
  assertCatalog("ConstraintTeacherNotAvailableTimes");
  if (intentHints.includes("not_available") && text) {
    // Extract a teacher name if present near the phrase
    const teachers = doc
      .listEntities("teachers")
      .map((t) => asString(t.fields.Name))
      .filter((x): x is string => !!x);
    const mentioned = teachers.filter((t) => new RegExp(`\\b${escapeRe(t)}\\b`, "i").test(text));
    const dayHit = dayNames.find((d) => text.toLowerCase().includes(d.toLowerCase()));
    const hourHit = hourNames.find((h) => text.toLowerCase().includes(h.toLowerCase()));
    for (const teacher of mentioned.length ? mentioned : teachers.slice(0, 0)) {
      const slots =
        dayHit && hourHit
          ? [{ Day: dayHit, Hour: hourHit }]
          : dayHit
            ? hourNames.slice(-2).map((h) => ({ Day: dayHit, Hour: h }))
            : [];
      if (!slots.length) {
        suggestions.push({
          id: nextId("tnav"),
          type: "ConstraintTeacherNotAvailableTimes",
          kind: catalogKind("ConstraintTeacherNotAvailableTimes"),
          confidence: "low",
          code: "teacher_not_available_incomplete",
          titleIt: `Indisponibilità docente ${teacher} (serve giorno/ora)`,
          rationaleIt: `Il testo indica indisponibilità per ${teacher}, ma non ho abbastanza slot giorno+ora per compilare ConstraintTeacherNotAvailableTimes.`,
          improvesIt: "FET eviterà di assegnare lezioni quando il docente non c’è.",
          fieldsDraft: {
            Weight_Percentage: "100",
            Teacher: teacher,
            Number_of_Not_Available_Times: "0",
            Active: "true",
            Comments: "advise:tnav incomplete",
          },
          entities: [{ kind: "teacher", name: teacher }],
          cautionIt: "Completa Day/Hour prima di applicare, o usa fet_nl_patch con gli slot.",
        });
        continue;
      }
      suggestions.push({
        id: nextId("tnav"),
        type: "ConstraintTeacherNotAvailableTimes",
        kind: catalogKind("ConstraintTeacherNotAvailableTimes"),
        confidence: dayHit && hourHit ? "high" : "medium",
        code: "teacher_not_available",
        titleIt: `Indisponibilità ${teacher}`,
        rationaleIt: `Dal testo risulta che ${teacher} non è disponibile in certi slot. ConstraintTeacherNotAvailableTimes è il tipo FET corretto.`,
        improvesIt: "Niente lezioni negli slot in cui il docente è assente.",
        fieldsDraft: {
          Weight_Percentage: "100",
          Teacher: teacher,
          Number_of_Not_Available_Times: String(slots.length),
          Not_Available_Time: slots,
          Active: "true",
          Comments: `advise:tnav ${teacher}`,
        },
        entities: [{ kind: "teacher", name: teacher }],
      });
    }
    if (!mentioned.length) {
      suggestions.push({
        id: nextId("tnav"),
        type: "ConstraintTeacherNotAvailableTimes",
        kind: catalogKind("ConstraintTeacherNotAvailableTimes"),
        confidence: "low",
        code: "teacher_not_available_unnamed",
        titleIt: "Indisponibilità docente (nome non riconosciuto)",
        rationaleIt:
          "Il testo parla di indisponibilità, ma non ho abbinato un insegnante già presente nel .fet.",
        improvesIt: "Dopo aver indicato il docente e gli slot, FET rispetterà l’assenza.",
        fieldsDraft: {
          Weight_Percentage: "100",
          Teacher: "",
          Number_of_Not_Available_Times: "0",
          Active: "true",
          Comments: "advise:tnav unnamed",
        },
        cautionIt: "Specifica docente + giorno/ora, poi ri-esegui fet_advise o compila i campi.",
      });
    }
  }

  // --- 7. Consecutive for lab double-periods when intent asks ---
  assertCatalog("ConstraintTwoActivitiesConsecutive");
  if (intentHints.includes("consecutive")) {
    // Suggest consecutive on first two components of lab splits lacking Consecutive pairing
    for (const [, comps] of byGroup) {
      if (comps.length < 2) continue;
      const lab = comps.filter((c) => LAB_SUBJECT_RE.test(c.subject));
      if (lab.length < 2) continue;
      const a = lab[0]!;
      const b = lab[1]!;
      const already = doc.listConstraints({ type: "ConstraintTwoActivitiesConsecutive" }).some((c) => {
        if (!isActive(c.fields)) return false;
        const first = asNumber(c.fields.First_Activity_Id);
        const second = asNumber(c.fields.Second_Activity_Id);
        return (
          (first === a.id && second === b.id) || (first === b.id && second === a.id)
        );
      });
      if (already) continue;
      suggestions.push({
        id: nextId("consec"),
        type: "ConstraintTwoActivitiesConsecutive",
        kind: catalogKind("ConstraintTwoActivitiesConsecutive"),
        confidence: "medium",
        code: "lab_consecutive",
        titleIt: `Blocco consecutivo lab ${a.subject}`,
        rationaleIt: `Hai chiesto ore consecutive: per il lab «${a.subject}» si può usare ConstraintTwoActivitiesConsecutive tra le componenti ${a.id}→${b.id} (pattern tipico scuola IT).`,
        improvesIt: "Due ore di laboratorio restano attaccate (blocco 2h) invece di spezzarsi nella giornata.",
        fieldsDraft: {
          Weight_Percentage: "100",
          First_Activity_Id: String(a.id),
          Second_Activity_Id: String(b.id),
          Active: "true",
          Comments: `advise:consecutive ${a.id}→${b.id}`,
        },
        activityIds: [a.id, b.id],
        entities: [{ kind: "subject", name: a.subject }],
      });
      break;
    }
  }

  // Sort: confidence, then prefer mindays/sst/prefroom (Orario core)
  const priority: Record<string, number> = {
    min_days_missing: 0,
    same_starting_parallel: 1,
    lab_preferred_room: 2,
    break_times_missing: 3,
    max_hours_daily: 4,
    teacher_not_available: 5,
    lab_consecutive: 6,
    teacher_not_available_incomplete: 7,
    teacher_not_available_unnamed: 8,
  };
  suggestions.sort((a, b) => {
    const cr = confidenceRank(a.confidence) - confidenceRank(b.confidence);
    if (cr !== 0) return cr;
    return (priority[a.code] ?? 50) - (priority[b.code] ?? 50);
  });

  return { suggestions, intentHints };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
