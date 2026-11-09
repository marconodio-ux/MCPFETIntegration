/**
 * Heuristic Italian NL → NlIntent (MFI-8).
 * Handles free-form prose + structured JSON. Ambiguities become gaps, not silent guesses.
 */

import { defaultCalendar, normalizeClassName, yearKeyFromClass } from "../assignments/parseAssignments.js";
import { defaultSplitForHours, parseSplitPattern, splitSum } from "../assignments/splitDefaults.js";
import { parseConstraintPhrase } from "./phrases/catalogPhrases.js";
import type {
  CalendarDefaults,
  NlAssignment,
  NlClassSplit,
  NlConstraintSpec,
  NlGap,
  NlIntent,
  NlParseResult,
  NlPatchOp,
  NlWarning,
} from "./types.js";

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "");
}

/** Strip chat greetings / LLM-client fluff so we parse the school content. Preserves newlines. */
export function stripConversationFluff(text: string): string {
  let t = text;
  t = t.replace(
    /^\s*(?:ciao|salve|buongiorno|buonasera)[^.;\n]*(?:chatgpt|gemini|claude|cursor)?[^.;\n]*[!.?]?\s*/i,
    "",
  );
  t = t.replace(
    /\b(?:mi\s+generi|generami|crea|costruisci|fammi)\s+(?:l['']?orario|un\s+orario|l['']?orario\s+di\s+quest['']?anno)\s*[?.!]?\s*/gi,
    "",
  );
  t = t.replace(/\bpoi\s+comunicar(?:gli|mi|le)\s+modifiche\.*/gi, "");
  // Drop markdown/comment lines; keep blank lines as separators
  t = t
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line) && !/^\s*\/\//.test(line))
    .join("\n");
  return t.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Italian / school class labels:
 * - 1A, P1A, 1°A → keep compact
 * - "prima" / "seconda" → year tokens (ambiguous without section → gap later)
 */
export function normalizeNlClassLabel(raw: string): string {
  let s = normalizeWs(raw);
  s = s.replace(/[°º]/g, "");
  const ordinal: Record<string, string> = {
    prima: "1",
    seconda: "2",
    terza: "3",
    quarta: "4",
    quinta: "5",
  };
  const low = s.toLowerCase();
  if (ordinal[low]) return ordinal[low];
  // P1A / p1a / P1 A
  const p = s.match(/^P\s*(\d+)\s*([A-Za-zÀ-ÿ])$/i);
  if (p) return `P${p[1]}${p[2]!.toUpperCase()}`;
  return normalizeClassName(s);
}

/**
 * Year key for nesting: P1A → P1; 1A → 1; "prima"→1 already normalized.
 */
export function yearKeyFromNlClass(className: string): string {
  const m = className.match(/^(P?\d+)/i);
  if (m) return m[1]!.toUpperCase().replace(/^p/, "P");
  return yearKeyFromClass(className);
}

/** FET-unique subgroup name: Group + short label. */
export function fetSubgroupName(group: string, shortLabel: string): string {
  const label = normalizeWs(shortLabel)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9àèéìòù\-]/gi, "");
  if (!label) return `${group}-sub`;
  if (label.toLowerCase().startsWith(group.toLowerCase())) return label;
  return `${group}-${label}`;
}

function parseCalendarHints(text: string): Partial<CalendarDefaults> {
  const hints: Partial<CalendarDefaults> = {};
  const inst = text.match(/^\s*(?:istituto|scuola|institution)\s*[:=]\s*(.+)$/im);
  if (inst) hints.institutionName = normalizeWs(inst[1]!);
  const days = text.match(/^\s*(?:giorni|days)\s*[:=]\s*(.+)$/im);
  if (days) {
    hints.days = days[1]!
      .split(/[,;|]/)
      .map(normalizeWs)
      .filter(Boolean);
  }
  // Prefer "Fasce:" / "Hours:" — avoid matching bare "Ore:" that collides with "N ore" prose.
  const hours = text.match(/^\s*(?:fasce(?:\s+orarie)?|hours|ore(?:\s+giornaliere)?)\s*[:=]\s*(.+)$/im);
  if (hours) {
    const parts = hours[1]!
      .split(/[,;|]/)
      .map(normalizeWs)
      .filter(Boolean);
    // Only accept if values look like time slots (contain ':' or digit ranges), not weekday leftovers
    if (parts.every((p) => /\d/.test(p))) {
      hints.hours = parts;
    }
  }
  return hints;
}

function extractHoursToken(s: string): { hours: number | null; rest: string } {
  const patterns: RegExp[] = [
    /(\d+(?:[.,]\d+)?)\s*(?:ore(?:\s*\/\s*sett(?:imana)?)?|ora|h(?:\s*\/\s*sett)?)\b/i,
    /\b(?:ore|monte\s*ore)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const hours = Number(String(m[1]).replace(",", "."));
      if (Number.isFinite(hours) && hours > 0) {
        return { hours, rest: normalizeWs(s.replace(m[0], " ")) };
      }
    }
  }
  return { hours: null, rest: s };
}

/**
 * Parse class-split sentences:
 * "P1A è divisa in 2 gruppi — Marraffa solo metà meccanica, l'altra metà elettro ha Bianchi"
 */
export function parseClassSplitClauses(
  text: string,
  gaps: NlGap[],
  warnings: NlWarning[],
): { splits: NlClassSplit[]; teacherHalfHints: Array<{ teacher: string; group: string; half: string }> } {
  const splits: NlClassSplit[] = [];
  const teacherHalfHints: Array<{ teacher: string; group: string; half: string }> = [];

  const re =
    /([A-Za-zP]?\d+[A-Za-zÀ-ÿ]?|[A-Za-zÀ-ÿ0-9]+)\s+è\s+divis[aoe]\s+in\s+(\d+)\s+grupp[iy]?\s*[:\-—,]?\s*([^.;]+)?/gi;

  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const group = normalizeNlClassLabel(m[1]!);
    const n = Number(m[2]);
    const tail = normalizeWs(m[3] ?? "");
    const rawHalves: string[] = [];

    // Prefer short labels after "metà" / "gruppo" (meccanica, elettro)
    for (const hm of tail.matchAll(
      /(?:l['']altra\s+)?met[aà]\s+([A-Za-zÀ-ÿ]{3,20})|(?:gruppo\s+)([A-Za-zÀ-ÿ]{3,20})/gi,
    )) {
      const h = (hm[1] ?? hm[2] ?? "").toLowerCase();
      if (h && !/^(?:solo|altra|altro|dei|delle|gruppi|classe)$/i.test(h)) {
        rawHalves.push(h);
      }
    }

    // Teacher ↔ half bindings
    // "Marraffa solo metà meccanica" / "l'altra metà elettro ha Bianchi"
    for (const b of tail.matchAll(
      /([A-ZÀ-Ü][a-zà-üA-ZÀ-Ü'’]+)\s+solo\s+met[aà]\s+([A-Za-zÀ-ÿ]{3,20})/gi,
    )) {
      teacherHalfHints.push({
        teacher: normalizeWs(b[1]!),
        group,
        half: b[2]!.toLowerCase(),
      });
      if (!rawHalves.includes(b[2]!.toLowerCase())) rawHalves.push(b[2]!.toLowerCase());
    }
    for (const b of tail.matchAll(
      /met[aà]\s+([A-Za-zÀ-ÿ]{3,20})\s+ha\s+([A-ZÀ-Ü][a-zà-üA-ZÀ-Ü'’]+)/gi,
    )) {
      teacherHalfHints.push({
        teacher: normalizeWs(b[2]!),
        group,
        half: b[1]!.toLowerCase(),
      });
      if (!rawHalves.includes(b[1]!.toLowerCase())) rawHalves.push(b[1]!.toLowerCase());
    }

    // Fallback: "meccanica e elettro" / "meccanica, elettro"
    if (rawHalves.length < 2) {
      const simple = tail.match(
        /([A-Za-zÀ-ÿ]{3,20})\s*(?:,|e|ed|\/)\s*([A-Za-zÀ-ÿ]{3,20})/i,
      );
      if (simple) {
        rawHalves.push(simple[1]!.toLowerCase(), simple[2]!.toLowerCase());
      }
    }

    const unique = [...new Set(rawHalves)];
    if (unique.length < 2) {
      gaps.push({
        code: "split_halves_unclear",
        message: `Classe ${group} divisa in ${n} gruppi ma i nomi delle metà non sono chiari`,
        ask: `Come si chiamano i ${n} sottogruppi di ${group}? (es. meccanica, elettro)`,
        about: { group },
        raw: m[0],
      });
    }
    const subgroups = unique.slice(0, Math.max(n, unique.length));
    if (subgroups.length >= 2) {
      splits.push({
        group,
        year: yearKeyFromNlClass(group),
        subgroups,
        parallel: true,
        source: m[0],
      });
    } else {
      warnings.push({
        code: "split_incomplete",
        message: `Split di ${group} incompleto`,
        raw: m[0],
      });
    }
  }

  return { splits, teacherHalfHints };
}

/**
 * Extract assignment-like clauses from free prose.
 */
export function parseAssignmentClauses(
  text: string,
  gaps: NlGap[],
  warnings: NlWarning[],
): NlAssignment[] {
  const assignments: NlAssignment[] = [];
  const seen = new Set<string>();

  const push = (a: NlAssignment) => {
    const k = `${a.teacher}|${a.subject}|${a.students}|${a.hoursPerWeek}`;
    if (seen.has(k)) return;
    seen.add(k);
    assignments.push(a);
  };

  // Pattern A: "Rossi insegna laboratorio meccanico in prima per 8 ore/sett"
  // Students may be year ("prima"), group ("P1A"), or subgroup ("P1A-elettro").
  const reA =
    /([A-ZÀ-Ü][a-zà-üA-ZÀ-Ü'’]+(?:\s+[A-ZÀ-Ü][a-zà-üA-ZÀ-Ü'’]+)?)\s+insegna\s+(.+?)\s+in\s+(P?\d+[A-Za-zÀ-ÿ]?(?:-[A-Za-zÀ-ÿ0-9]+)?|prima|seconda|terza|quarta|quinta|[A-Za-zÀ-ÿ0-9\-]+)\s+per\s+(\d+(?:[.,]\d+)?)\s*(?:ore(?:\s*\/\s*sett(?:imana)?)?|h)?/gi;

  for (const m of text.matchAll(reA)) {
    const teacher = normalizeWs(m[1]!);
    let subject = normalizeWs(m[2]!);
    subject = subject.replace(/^(?:il|la|lo|l['']|un|una)\s+/i, "");
    const studentsRaw = m[3]!;
    const students = /-/i.test(studentsRaw)
      ? normalizeWs(studentsRaw)
      : normalizeNlClassLabel(studentsRaw);
    const hours = Number(String(m[4]).replace(",", "."));
    push({
      teacher,
      subject: titleCaseSubject(subject),
      students,
      hoursPerWeek: hours,
      split: defaultSplitForHours(hours),
      source: m[0],
    });
    if (/^\d+$/.test(students) || /^(?:1|2|3|4|5|P\d+)$/i.test(students)) {
      gaps.push({
        code: "year_without_section",
        message: `${teacher} assegnato all’anno "${students}" senza sezione (A/B/…)`,
        ask: `Per ${teacher} (${subject}, ${hours} ore): quali sezioni di ${students}ª? (es. P${students}A, oppure tutte le sezioni dell’anno)`,
        about: { teacher, subject, students },
        raw: m[0],
      });
    }
  }

  // Pattern B: "Marraffa in P1A sempre laboratorio 7 ore"
  // No `i` flag: teacher must start with a real capital (avoids "meccanico in P1A…").
  const reB =
    /([A-ZÀ-Ü][a-zà-ü'’]+)\s+in\s+((?:P|p)?\d+\s*[A-Za-zÀ-ÿ]|[1-5]\s*[A-Za-zÀ-ÿ])\s+(?:sempre\s+)?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ]{1,40}?)\s+(\d+(?:[.,]\d+)?)\s*(?:ore(?:\s*\/\s*sett(?:imana)?)?|h)\b/g;

  for (const m of text.matchAll(reB)) {
    const teacher = normalizeWs(m[1]!);
    // Skip if this span sits in the same clause as an "insegna" (Pattern A).
    // Clauses are separated by newlines or semicolons (common in Italian prose).
    const idx = m.index ?? 0;
    const lineStart = Math.max(text.lastIndexOf("\n", idx - 1), text.lastIndexOf(";", idx - 1)) + 1;
    const beforeOnLine = text.slice(lineStart, idx);
    if (/\binsegna\b/i.test(beforeOnLine)) continue;
    if (
      /^(?:Laboratorio|Matematica|Italiano|Storia|Geografia|Inglese|Scienze|Fisica|Chimica|Meccanico|Elettro)/i.test(
        teacher,
      )
    ) {
      continue;
    }
    const students = normalizeNlClassLabel(m[2]!);
    let subject = normalizeWs(m[3]!);
    subject = subject.replace(/^(?:il|la|lo|l['']|un|una|sempre)\s+/i, "");
    subject = subject.replace(/\s+(?:per|di|del|della)\s*$/i, "");
    const hours = Number(String(m[4]).replace(",", "."));
    if (!subject || subject.length < 2) {
      gaps.push({
        code: "missing_subject",
        message: `Materia mancante per ${teacher} in ${students}`,
        ask: `Quale materia insegna ${teacher} in ${students}?`,
        about: { teacher, students },
        raw: m[0],
      });
      continue;
    }
    if (
      assignments.some(
        (a) =>
          a.teacher.toLowerCase() === teacher.toLowerCase() &&
          (a.students === students || a.students.startsWith(students)),
      )
    ) {
      continue;
    }
    push({
      teacher,
      subject: titleCaseSubject(subject),
      students,
      hoursPerWeek: hours,
      split: defaultSplitForHours(hours),
      source: m[0],
    });
  }

  // Pattern C: line-oriented fallbacks already covered by from_assignments style
  // "Rossi: Laboratorio — P1A — 8 ore"
  for (const rawLine of text.split(/\r?\n|;/)) {
    const line = normalizeWs(rawLine);
    if (!line || line.length < 8) continue;
    if (!/[:：]/.test(line) && !/[—–]/.test(line)) continue;
    if (/è\s+divis/i.test(line)) continue;
    if (/insegna\s+/i.test(line) && /\sper\s+\d+/i.test(line)) continue;

    const { hours, rest } = extractHoursToken(line);
    let work = rest;
    let parts: string[] = [];
    if (/[:：]/.test(work)) {
      const idx = work.search(/[:：]/);
      const teacher = normalizeWs(work.slice(0, idx));
      const restParts = normalizeWs(work.slice(idx + 1))
        .split(/\s*[—–-]\s*|\s*,\s*/)
        .map(normalizeWs)
        .filter(Boolean);
      parts = [teacher, ...restParts];
    } else if (/[—–]/.test(work) || /\s+-\s+/.test(work)) {
      parts = work.split(/\s*[—–]\s*|\s+-\s+/).map(normalizeWs).filter(Boolean);
    }
    if (parts.length >= 3 && hours != null) {
      const teacher = parts[0]!;
      const subject = titleCaseSubject(parts[1]!);
      const students = normalizeNlClassLabel(parts[2]!);
      // Avoid duplicating if already captured
      const already = assignments.some(
        (a) => a.teacher === teacher && a.subject === subject && a.students === students,
      );
      if (!already) {
        push({
          teacher,
          subject,
          students,
          hoursPerWeek: hours,
          split: defaultSplitForHours(hours),
          source: line,
        });
      }
    }
  }

  if (assignments.length === 0) {
    warnings.push({
      code: "no_assignment_clause",
      message: "Nessuna clausola incarico riconosciuta nei pattern NL principali",
    });
  }

  return assignments;
}

function titleCaseSubject(s: string): string {
  const t = normalizeWs(s);
  if (!t) return t;
  // Keep short ALLCAPS codes
  if (/^[A-Z0-9]{2,6}$/.test(t)) return t;
  return t
    .split(" ")
    .map((w) => {
      if (/^(?:e|di|del|della|dei|delle|in|per|a|ad|al|da)$/i.test(w)) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Apply teacher↔half hints: retarget assignments from Group → Subgroup when split says so.
 */
export function applyHalfRetargeting(
  assignments: NlAssignment[],
  splits: NlClassSplit[],
  halfHints: Array<{ teacher: string; group: string; half: string }>,
  gaps: NlGap[],
): NlAssignment[] {
  if (splits.length === 0 && halfHints.length === 0) return assignments;

  const out = assignments.map((a) => ({ ...a }));

  for (const hint of halfHints) {
    const split = splits.find((s) => s.group === hint.group);
    if (!split) continue;
    const short = split.subgroups.find(
      (h) => h === hint.half || h.includes(hint.half) || hint.half.includes(h),
    );
    if (!short) {
      gaps.push({
        code: "half_not_in_split",
        message: `Metà "${hint.half}" non tra i sottogruppi di ${hint.group}`,
        ask: `Confermi i sottogruppi di ${hint.group}: ${split.subgroups.join(", ")}? Dove va ${hint.teacher}?`,
        about: { teacher: hint.teacher, group: hint.group, half: hint.half },
      });
      continue;
    }
    const target = fetSubgroupName(hint.group, short);
    // Retarget existing assignment for this teacher on this group
    let hit = false;
    for (const a of out) {
      if (
        a.teacher.toLowerCase() === hint.teacher.toLowerCase() &&
        (a.students === hint.group || a.students.startsWith(hint.group))
      ) {
        a.students = target;
        a.source = `${a.source ?? ""} [→ ${target}]`;
        hit = true;
      }
    }
    if (!hit) {
      // Teacher mentioned only in split clause — need subject + hours
      gaps.push({
        code: "split_teacher_incomplete",
        message: `${hint.teacher} assegnato a ${target} nello split, ma mancano materia e/o ore`,
        ask: `Quale materia e quante ore/settimana per ${hint.teacher} sul gruppo ${short} di ${hint.group}?`,
        about: { teacher: hint.teacher, students: target, group: hint.group },
      });
    }
  }

  // Teachers on a split group without half retarget → note (whole-class is valid FET)
  for (const a of out) {
    const split = splits.find((s) => s.group === a.students);
    if (!split) continue;
    const hinted = halfHints.some(
      (h) =>
        h.group === split.group && h.teacher.toLowerCase() === a.teacher.toLowerCase(),
    );
    if (!hinted) {
      // Keep as gap only when hours look like a "half" subject already taught on a subgroup
      // otherwise treat as whole-class activity on the Group (valid).
      gaps.push({
        code: "assignment_on_split_group",
        message: `${a.teacher} su ${a.students} (classe spezzata in ${split.subgroups.join("/")}): interpretato come classe intera; conferma se doveva essere una metà.`,
        ask: `${a.teacher} (${a.subject}) è per tutta ${a.students} o solo ${split.subgroups.join("/")}? (default: tutta la classe)`,
        about: { teacher: a.teacher, students: a.students, subject: a.subject },
      });
    }
  }

  return out;
}

function parsePatchClauses(text: string, gaps: NlGap[]): NlPatchOp[] {
  const ops: NlPatchOp[] = [];
  const t = text;

  // "rimuovi|cancella|elimina [attività di] Teacher"
  for (const m of t.matchAll(
    /(?:rimuovi|cancella|elimina|togli)\s+(?:l['']attività\s+(?:di\s+)?)?([A-ZÀ-Ü][a-zà-üA-ZÀ-Ü'’]+(?:\s+[A-ZÀ-Ü][a-zà-üA-ZÀ-Ü'’]+)?)(?:\s+(?:su|in|per)\s+(\S+))?/gi,
  )) {
    ops.push({
      op: "remove_assignment",
      match: {
        teacher: normalizeWs(m[1]!),
        students: m[2] ? normalizeNlClassLabel(m[2]) : undefined,
      },
    });
  }

  // "cambia|porta|imposta Teacher a N ore"
  for (const m of t.matchAll(
    /(?:cambia|porta|imposta|modifica)\s+([A-ZÀ-Ü][a-zà-üA-ZÀ-Ü'’]+(?:\s+[A-ZÀ-Ü][a-zà-üA-ZÀ-Ü'’]+)?)\s+(?:a|ad|con)\s+(\d+(?:[.,]\d+)?)\s*ore/gi,
  )) {
    ops.push({
      op: "change_assignment",
      match: { teacher: normalizeWs(m[1]!) },
      set: { hoursPerWeek: Number(String(m[2]).replace(",", ".")) },
    });
  }

  // "aggiungi Teacher: Subject — Class — N ore"
  for (const m of t.matchAll(
    /(?:aggiungi|add)\s+([A-ZÀ-Ü][a-zà-üA-ZÀ-Ü'’]+(?:\s+[A-ZÀ-Ü][a-zà-üA-ZÀ-Ü'’]+)?)\s*[:：]\s*(.+?)\s*[—–-]\s*(\S+)\s*[—–-]\s*(\d+(?:[.,]\d+)?)\s*ore/gi,
  )) {
    const hours = Number(String(m[4]).replace(",", "."));
    ops.push({
      op: "add_assignment",
      assignment: {
        teacher: normalizeWs(m[1]!),
        subject: titleCaseSubject(m[2]!),
        students: normalizeNlClassLabel(m[3]!),
        hoursPerWeek: hours,
        split: defaultSplitForHours(hours),
        source: m[0],
      },
    });
  }

  if (/modific/i.test(t) && ops.length === 0) {
    gaps.push({
      code: "patch_unparsed",
      message: "Testo di modifica non interpretato in operazioni strutturate",
      ask: "Specifica la modifica come: «aggiungi …», «cambia X a N ore», «rimuovi attività di X», oppure passa `patches` strutturati a fet_nl_patch.",
      raw: t.slice(0, 200),
    });
  }

  return ops;
}

function mergeIntent(base: NlIntent, extra: Partial<NlIntent>): NlIntent {
  return {
    institutionName: extra.institutionName ?? base.institutionName,
    comments: extra.comments ?? base.comments,
    calendar: { ...(base.calendar ?? {}), ...(extra.calendar ?? {}) },
    assignments: [...(base.assignments ?? []), ...(extra.assignments ?? [])],
    classSplits: [...(base.classSplits ?? []), ...(extra.classSplits ?? [])],
    studentsTree: extra.studentsTree ?? base.studentsTree,
    constraints: [...(base.constraints ?? []), ...(extra.constraints ?? [])],
    patches: [...(base.patches ?? []), ...(extra.patches ?? [])],
  };
}

/** Split prose into candidate constraint sentences / lines. */
export function parseConstraintClauses(
  text: string,
  gaps: NlGap[],
  warnings: NlWarning[],
): NlConstraintSpec[] {
  const out: NlConstraintSpec[] = [];
  const chunks = text
    .split(/\n+|(?<=[.|;])\s+(?=[A-ZÀ-Ÿ«]|Constraint|Il |La |Le |I |Tutti |Pausa|Docente|Materia|Attivit|Aula|Classe|Students|Teacher|Room|Subject)/)
    .map((c) => c.trim())
    .filter((c) => c.length > 8);

  for (const chunk of chunks) {
    // Skip pure assignment lines if they look like "X insegna ..."
    if (/\binsegna\b/i.test(chunk) && !/vincolo|constraint|prefer|disponib|pausa|mindays|consecutive|aula prefer/i.test(chunk)) {
      continue;
    }
    const hit = parseConstraintPhrase(chunk);
    if (!hit) continue;
    if (hit.confidence < 0.45) {
      warnings.push({
        code: "constraint_low_confidence",
        message: `Possibile ${hit.type} a bassa confidenza (${hit.confidence})`,
        raw: chunk.slice(0, 160),
      });
    }
    out.push({
      type: hit.type,
      fields: hit.fields,
      italian: chunk,
      source: `nl:${hit.type}`,
    });
    if (hit.notes?.length) {
      for (const n of hit.notes) {
        warnings.push({ code: "constraint_note", message: n, raw: chunk.slice(0, 120) });
      }
    }
  }

  if (/\bvincolo\b|\bconstraint\b/i.test(text) && out.length === 0) {
    gaps.push({
      code: "constraint_unparsed",
      message: "Testo sembra contenere vincoli ma nessuno è stato riconosciuto",
      ask: "Formula es. «Il docente Rossi non è disponibile lunedì 2^A ORA» oppure passa intent.constraints / patches add_constraint.",
    });
  }

  return out;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v.replace(",", ".")))) {
    return Number(v.replace(",", "."));
  }
  return undefined;
}

/** Parse structured intent object (LLM-friendly). */
export function parseStructuredNlIntent(data: unknown): NlParseResult {
  const gaps: NlGap[] = [];
  const warnings: NlWarning[] = [];
  const notes: string[] = ["Input strutturato (JSON intent)."];

  if (!data || typeof data !== "object") {
    gaps.push({
      code: "bad_intent",
      message: "Intent non è un oggetto",
      ask: "Passa un oggetto { assignments, classSplits?, calendar? }.",
    });
    return {
      intent: { assignments: [], classSplits: [] },
      gaps,
      warnings,
      notes,
    };
  }

  const obj = data as Record<string, unknown>;
  const intent: NlIntent = {
    institutionName: asString(obj.institutionName) ?? asString(obj.istituto),
    comments: asString(obj.comments),
    calendar: (obj.calendar as CalendarDefaults) ?? {},
    assignments: [],
    classSplits: [],
    constraints: [],
    studentsTree: Array.isArray(obj.studentsTree)
      ? (obj.studentsTree as NlIntent["studentsTree"])
      : undefined,
    patches: Array.isArray(obj.patches) ? (obj.patches as NlPatchOp[]) : [],
  };

  const constraintRows = Array.isArray(obj.constraints) ? obj.constraints : [];
  for (const [i, row] of constraintRows.entries()) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const type = asString(r.type) ?? asString(r.constraintType);
    if (!type) {
      gaps.push({
        code: "bad_constraint",
        message: `constraints[${i}] senza type`,
        ask: "Ogni constraint richiede type (es. ConstraintTeacherNotAvailableTimes) e fields.",
      });
      continue;
    }
    const fields =
      r.fields && typeof r.fields === "object"
        ? (r.fields as Record<string, unknown>)
        : ({ ...r } as Record<string, unknown>);
    delete fields.type;
    delete fields.constraintType;
    delete fields.italian;
    delete fields.source;
    intent.constraints!.push({
      type,
      fields,
      italian: asString(r.italian),
      source: asString(r.source) ?? `constraints[${i}]`,
    });
  }

  const rows = Array.isArray(obj.assignments) ? obj.assignments : [];
  for (const [i, row] of rows.entries()) {
    if (!row || typeof row !== "object") {
      gaps.push({
        code: "bad_assignment",
        message: `assignments[${i}] non valido`,
        ask: "Ogni assignment richiede teacher, subject, students, hoursPerWeek.",
      });
      continue;
    }
    const r = row as Record<string, unknown>;
    const teacher = asString(r.teacher) ?? asString(r.docente);
    const subject = asString(r.subject) ?? asString(r.materia);
    const students = asString(r.students) ?? asString(r.class) ?? asString(r.classe);
    const hours = asNumber(r.hoursPerWeek) ?? asNumber(r.hours) ?? asNumber(r.ore);
    if (!teacher || !subject || !students || hours == null) {
      gaps.push({
        code: "incomplete_assignment",
        message: `assignments[${i}] incompleto`,
        ask: "Completa teacher, subject, students, hoursPerWeek.",
      });
      continue;
    }
    let split: number[] | undefined;
    if (Array.isArray(r.split)) {
      split = r.split.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    } else if (typeof r.split === "string") {
      split = parseSplitPattern(r.split) ?? undefined;
    }
    if (!split) split = defaultSplitForHours(hours);
    else if (Math.abs(splitSum(split) - hours) > 1e-9) {
      gaps.push({
        code: "split_sum_mismatch",
        message: `assignments[${i}]: split somma ${splitSum(split)} ≠ ore ${hours}`,
        ask: "Allineo le ore alla somma dello split; conferma o correggi.",
      });
    }
    intent.assignments.push({
      teacher,
      subject,
      students: normalizeNlClassLabel(students),
      hoursPerWeek: split ? splitSum(split) : hours,
      split,
      tags: Array.isArray(r.tags) ? r.tags.map(String) : undefined,
      key: asString(r.key),
      source: asString(r.source) ?? `assignments[${i}]`,
    });
  }

  const splits = Array.isArray(obj.classSplits) ? obj.classSplits : [];
  for (const [i, s] of splits.entries()) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    const group = asString(r.group) ?? asString(r.classe);
    const subgroups = Array.isArray(r.subgroups) ? r.subgroups.map(String) : [];
    if (!group || subgroups.length < 2) {
      gaps.push({
        code: "bad_class_split",
        message: `classSplits[${i}] richiede group + almeno 2 subgroups`,
        ask: "Esempio: { group: \"P1A\", subgroups: [\"meccanica\",\"elettro\"] }",
      });
      continue;
    }
    intent.classSplits.push({
      group: normalizeNlClassLabel(group),
      year: asString(r.year) ?? yearKeyFromNlClass(normalizeNlClassLabel(group)),
      subgroups: subgroups.map((x) => x.toLowerCase()),
      parallel: r.parallel !== false,
      source: `classSplits[${i}]`,
    });
  }

  return { intent, gaps, warnings, notes };
}

/**
 * Parse free-form Italian (or JSON) into NlIntent + gaps.
 */
export function parseNlText(input: string): NlParseResult {
  const text = stripBom(input ?? "");
  const gaps: NlGap[] = [];
  const warnings: NlWarning[] = [];
  const notes: string[] = [];

  const trimmed = text.trim();
  if (!trimmed) {
    gaps.push({
      code: "empty_input",
      message: "Testo vuoto",
      ask: "Incolla la descrizione in italiano degli incarichi e dei vincoli (classi spezzate, docenti, ore).",
    });
    return { intent: { assignments: [], classSplits: [] }, gaps, warnings, notes };
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed) as unknown;
      if (Array.isArray(data)) {
        return parseStructuredNlIntent({ assignments: data });
      }
      return parseStructuredNlIntent(data);
    } catch (e) {
      gaps.push({
        code: "invalid_json",
        message: `JSON non valido: ${e instanceof Error ? e.message : String(e)}`,
        ask: "Correggi il JSON oppure usa prosa italiana.",
      });
      return { intent: { assignments: [], classSplits: [] }, gaps, warnings, notes };
    }
  }

  const cleaned = stripConversationFluff(trimmed);
  notes.push("Rimossi saluti/richieste chat generiche; resta il contenuto scolastico.");
  const calendarHints = parseCalendarHints(cleaned);
  const { splits, teacherHalfHints } = parseClassSplitClauses(cleaned, gaps, warnings);
  let assignments = parseAssignmentClauses(cleaned, gaps, warnings);
  assignments = applyHalfRetargeting(assignments, splits, teacherHalfHints, gaps);

  // Teachers mentioned in half hints without any assignment already flagged as gaps.
  // Bianchi often appears only in split clause → ensure gap if no hours.
  for (const h of teacherHalfHints) {
    const has = assignments.some((a) => a.teacher.toLowerCase() === h.teacher.toLowerCase());
    if (!has) {
      // already added split_teacher_incomplete in applyHalfRetargeting when no hit —
      // but applyHalf only adds that when retarget fails; when there's no assignment at all:
      const already = gaps.some(
        (g) =>
          g.code === "split_teacher_incomplete" && g.about?.teacher === h.teacher,
      );
      if (!already) {
        const target = fetSubgroupName(h.group, h.half);
        gaps.push({
          code: "split_teacher_incomplete",
          message: `${h.teacher} citato per ${target} ma senza materia/ore`,
          ask: `Materia e ore settimanali per ${h.teacher} (${h.half} di ${h.group})?`,
          about: { teacher: h.teacher, students: target, group: h.group },
        });
      }
    }
  }

  const patches = parsePatchClauses(cleaned, gaps);
  const constraints = parseConstraintClauses(cleaned, gaps, warnings);

  if (
    assignments.length === 0 &&
    splits.length === 0 &&
    patches.length === 0 &&
    constraints.length === 0
  ) {
    gaps.push({
      code: "no_nl_content",
      message: "Nessun incarico, split classe, vincolo o patch riconosciuto",
      ask: "Descrivi ad es.: «Rossi insegna Lab meccanico in P1A per 8 ore; P1A è divisa in meccanica e elettro — Marraffa metà meccanica, Bianchi metà elettro 7 ore».",
    });
  }

  notes.push(
    "Classi tipo P1A → Year P1 + Group P1A; sottogruppi → Subgroup P1A-<label> (nomi univoci FET).",
  );
  notes.push(
    "Ore senza split esplicito → pattern default (es. 7→2+2+2+1, 8→2+2+2+2) + MinDaysBetweenActivities.",
  );
  if (constraints.length) {
    notes.push(`Riconosciuti ${constraints.length} vincolo/i da prosa (catalogo 358 live; overlay scuola IT).`);
  }

  const intent: NlIntent = {
    institutionName: calendarHints.institutionName ?? defaultCalendar().institutionName,
    calendar: calendarHints,
    assignments,
    classSplits: splits,
    constraints,
    patches,
  };

  return { intent, gaps, warnings, notes };
}

export function mergeNlInputs(
  text: string | undefined,
  intent: Partial<NlIntent> | undefined,
): NlParseResult {
  const fromText = text && text.trim() ? parseNlText(text) : null;
  const fromIntent =
    intent &&
    (intent.assignments?.length ||
      intent.classSplits?.length ||
      intent.patches?.length ||
      intent.constraints?.length)
      ? parseStructuredNlIntent(intent)
      : null;

  if (!fromText && !fromIntent) {
    return {
      intent: { assignments: [], classSplits: [] },
      gaps: [
        {
          code: "empty_input",
          message: "Nessun text né intent",
          ask: "Passa `text` in italiano e/o `intent` strutturato.",
        },
      ],
      warnings: [],
      notes: [],
    };
  }

  if (fromText && !fromIntent) return fromText;
  if (!fromText && fromIntent) return fromIntent;

  const merged = mergeIntent(fromText!.intent, fromIntent!.intent);
  return {
    intent: merged,
    gaps: [...fromText!.gaps, ...fromIntent!.gaps],
    warnings: [...fromText!.warnings, ...fromIntent!.warnings],
    notes: [...fromText!.notes, ...fromIntent!.notes, "Merge text + intent strutturato."],
  };
}
