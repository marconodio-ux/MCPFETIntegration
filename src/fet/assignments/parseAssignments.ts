import { defaultSplitForHours, parseSplitPattern, splitSum } from "./splitDefaults.js";
import type {
  Ambiguity,
  AssignmentRow,
  CalendarDefaults,
  ParseResult,
  ParseWarning,
} from "./types.js";

const DEFAULT_DAYS = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì"];
const DEFAULT_HOURS = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00"];

export function defaultCalendar(): Required<
  Pick<CalendarDefaults, "days" | "hours" | "institutionName" | "mode" | "defaultNumberOfStudents" | "minDaysWeight" | "minDays" | "consecutiveIfSameDay">
> &
  CalendarDefaults {
  return {
    days: [...DEFAULT_DAYS],
    hours: [...DEFAULT_HOURS],
    institutionName: "Istituto",
    mode: "Official",
    defaultNumberOfStudents: 20,
    minDaysWeight: 95,
    minDays: 1,
    consecutiveIfSameDay: true,
    comments: "",
  };
}

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "");
}

/** Normalize Italian class labels: "1 A", "1°A", "I A" → "1A". */
export function normalizeClassName(raw: string): string {
  let s = normalizeWs(raw);
  s = s.replace(/[°º]/g, "");
  // Roman numerals I–V commonly used for years
  const roman: Record<string, string> = {
    i: "1",
    ii: "2",
    iii: "3",
    iv: "4",
    v: "5",
  };
  const mRoman = s.match(/^([ivxIVX]+)\s*([A-Za-zÀ-ÿ0-9]+)?$/);
  if (mRoman) {
    const y = roman[mRoman[1]!.toLowerCase()];
    if (y) return mRoman[2] ? `${y}${mRoman[2].toUpperCase()}` : y;
  }
  // "1 A" / "1-A" / "1^A"
  const m = s.match(/^(\d+)\s*[-\/^]?\s*([A-Za-zÀ-ÿ])$/);
  if (m) return `${m[1]}${m[2]!.toUpperCase()}`;
  // Already compact "1A"
  const m2 = s.match(/^(\d+)([A-Za-zÀ-ÿ])$/);
  if (m2) return `${m2[1]}${m2[2]!.toUpperCase()}`;
  return s;
}

/** Year key for hierarchy: "1A" → "1"; free-form → whole name as year. */
export function yearKeyFromClass(className: string): string {
  const m = className.match(/^(\d+)/);
  return m ? m[1]! : className;
}

function extractSplit(line: string): { split: number[] | null; lineWithoutSplit: string } {
  // (2+2+1) or [2+2+1]
  const paren = line.match(/[(\[]\s*(\d+(?:\s*[+＋×xX]\s*\d+)+)\s*[)\]]/);
  if (paren) {
    const split = parseSplitPattern(paren[1]!);
    return {
      split,
      lineWithoutSplit: normalizeWs(line.replace(paren[0], " ")),
    };
  }
  // split 2+2+1 / suddivisione 2+2+1 / pattern 2+2+1
  const labeled = line.match(
    /(?:split|suddivisione|suddiv\.?|pattern|schema)\s*[:=]?\s*(\d+(?:\s*[+＋×xX]\s*\d+)+)/i,
  );
  if (labeled) {
    const split = parseSplitPattern(labeled[1]!);
    return {
      split,
      lineWithoutSplit: normalizeWs(line.replace(labeled[0], " ")),
    };
  }
  // trailing bare 2+2+1
  const bare = line.match(/(?:^|[\s,;:—-])(\d+(?:\s*\+\s*\d+){1,})\s*$/);
  if (bare) {
    const split = parseSplitPattern(bare[1]!);
    if (split && split.length >= 2) {
      return {
        split,
        lineWithoutSplit: normalizeWs(line.slice(0, bare.index) + line.slice(bare.index! + bare[0].length)),
      };
    }
  }
  return { split: null, lineWithoutSplit: line };
}

function extractHours(line: string): { hours: number | null; lineWithoutHours: string } {
  const patterns: RegExp[] = [
    /(\d+(?:[.,]\d+)?)\s*(?:ore|ora|h|ore\/sett(?:imana)?|h\/sett)\b/i,
    /\b(?:ore|ora|monte\s*ore)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i,
    /\b(\d+(?:[.,]\d+)?)\s*h\b/i,
  ];
  for (const re of patterns) {
    const m = line.match(re);
    if (m) {
      const hours = Number(String(m[1]).replace(",", "."));
      if (Number.isFinite(hours) && hours > 0) {
        return {
          hours,
          lineWithoutHours: normalizeWs(line.replace(m[0], " ")),
        };
      }
    }
  }
  return { hours: null, lineWithoutHours: line };
}

function extractClasses(segment: string): { classes: string[]; multi: boolean } {
  const s = normalizeWs(segment);
  // "1A e 1B" / "1A, 1B" / "1A/1B" / "1A e 1B e 1C"
  const parts = s
    .split(/\s*(?:,|;|\/|\be\b|\bed\b|\band\b|\+)\s*/i)
    .map((p) => normalizeClassName(p))
    .filter(Boolean);
  const classes = [...new Set(parts.filter((p) => p.length > 0))];
  return { classes, multi: classes.length > 1 };
}

function looksLikeClassToken(tok: string): boolean {
  const n = normalizeClassName(tok);
  return /^\d+[A-Za-zÀ-ÿ]$/.test(n) || /^(?:[1-5])$/.test(n) || /^[A-Za-zÀ-ÿ].*\d/.test(n) === false && /^\d/.test(n);
}

/**
 * Parse one assignment line.
 * Accepted shapes (Italian / plain text):
 *   Teacher: Subject — Class — 5 ore (2+2+1)
 *   Teacher - Subject - Class - 6h
 *   Teacher, Subject, Class, 4
 *   Teacher | Subject | Class | 5 | 2+2+1
 */
export function parseAssignmentLine(
  rawLine: string,
  lineNo: number,
): { rows: AssignmentRow[]; ambiguities: Ambiguity[]; warnings: ParseWarning[] } {
  const ambiguities: Ambiguity[] = [];
  const warnings: ParseWarning[] = [];
  let line = normalizeWs(rawLine);
  if (!line || line.startsWith("#") || line.startsWith("//") || line.startsWith(";")) {
    return { rows: [], ambiguities, warnings };
  }

  // Drop leading bullets / numbering
  line = line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "");

  const { split: extractedSplit, lineWithoutSplit } = extractSplit(line);
  line = lineWithoutSplit;
  const { hours: extractedHours, lineWithoutHours } = extractHours(line);
  line = lineWithoutHours;

  // Separators: pipe, em/en dash, colon after teacher, commas
  let parts: string[] = [];
  if (line.includes("|")) {
    parts = line.split("|").map(normalizeWs).filter(Boolean);
  } else if (/[:：]/.test(line) && !/^\s*\d/.test(line)) {
    // Teacher: rest
    const idx = line.search(/[:：]/);
    const teacher = normalizeWs(line.slice(0, idx));
    const rest = normalizeWs(line.slice(idx + 1));
    const restParts = rest.split(/\s*[—–-]\s*|\s*,\s*/).map(normalizeWs).filter(Boolean);
    parts = [teacher, ...restParts];
  } else if (/[—–]/.test(line) || /\s+-\s+/.test(line)) {
    parts = line.split(/\s*[—–]\s*|\s+-\s+/).map(normalizeWs).filter(Boolean);
  } else if (line.includes(",")) {
    parts = line.split(",").map(normalizeWs).filter(Boolean);
  } else {
    parts = [line];
  }

  if (parts.length < 3) {
    ambiguities.push({
      code: "unparsed_line",
      message: `Riga non interpretabile (servono docente, materia, classe, ore): "${rawLine}"`,
      line: lineNo,
      raw: rawLine,
      ask: "Riscrivi la riga come: Docente: Materia — Classe — N ore (opz. split 2+2+1)",
    });
    return { rows: [], ambiguities, warnings };
  }

  const teacher = parts[0]!;
  const subject = parts[1]!;
  let classPart = parts[2]!;
  let hours = extractedHours;
  let split = extractedSplit;

  // Remaining tokens may hold hours / split / extra class notes
  const extras = parts.slice(3);
  for (const ex of extras) {
    if (hours == null) {
      const h = extractHours(ex);
      if (h.hours != null) {
        hours = h.hours;
        continue;
      }
      if (/^\d+(?:[.,]\d+)?$/.test(ex)) {
        hours = Number(ex.replace(",", "."));
        continue;
      }
    }
    if (split == null) {
      const sp = parseSplitPattern(ex);
      if (sp && sp.length >= 1) {
        split = sp;
        continue;
      }
    }
    // Might be more class info glued
    if (looksLikeClassToken(ex) || /[e,/]/i.test(ex)) {
      classPart = `${classPart} e ${ex}`;
    } else {
      warnings.push({
        code: "ignored_token",
        message: `Token ignorato nella riga ${lineNo}: "${ex}"`,
        line: lineNo,
        raw: rawLine,
      });
    }
  }

  if (hours == null) {
    ambiguities.push({
      code: "missing_hours",
      message: `Ore settimanali mancanti per ${teacher} / ${subject} / ${classPart}`,
      line: lineNo,
      raw: rawLine,
      ask: `Quante ore settimanali per ${teacher} — ${subject} — ${classPart}?`,
    });
    return { rows: [], ambiguities, warnings };
  }

  const { classes, multi } = extractClasses(classPart);
  if (classes.length === 0) {
    ambiguities.push({
      code: "missing_class",
      message: `Classe/gruppo non riconosciuto: "${classPart}"`,
      line: lineNo,
      raw: rawLine,
      ask: `Quale classe/sezione intendevi con "${classPart}"? (es. 1A)`,
    });
    return { rows: [], ambiguities, warnings };
  }

  if (multi) {
    ambiguities.push({
      code: "multi_class_hours",
      message: `Più classi nella stessa riga (${classes.join(", ")}): le ${hours} ore sono per ciascuna classe o in totale?`,
      line: lineNo,
      raw: rawLine,
      ask: `Per "${rawLine}": le ${hours} ore valgono per ogni classe tra ${classes.join(", ")}, oppure vanno ripartite? (default applicato: ${hours} ore per ciascuna classe)`,
    });
  }

  if (split != null && Math.abs(splitSum(split) - hours) > 1e-9) {
    ambiguities.push({
      code: "split_sum_mismatch",
      message: `Lo split [${split.join("+")}] somma ${splitSum(split)} ma le ore sono ${hours}`,
      line: lineNo,
      raw: rawLine,
      ask: `Correggi lo split o le ore per ${teacher} / ${subject}: vuoi forzare lo split e impostare ore=${splitSum(split)}?`,
    });
    // Prefer split sum if explicit
    hours = splitSum(split);
  }

  if (split == null) {
    split = defaultSplitForHours(hours);
  }

  const rows: AssignmentRow[] = classes.map((students) => ({
    teacher,
    subject,
    students,
    hoursPerWeek: hours!,
    split: [...split!],
    source: rawLine,
  }));

  return { rows, ambiguities, warnings };
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
  const hours = text.match(/^\s*(?:ore|fasce|hours)\s*[:=]\s*(.+)$/im);
  if (hours) {
    hints.hours = hours[1]!
      .split(/[,;|]/)
      .map(normalizeWs)
      .filter(Boolean);
  }
  return hints;
}

/**
 * Parse a full Italian/plain-text assignment sheet into structured rows.
 * Also accepts a JSON array / object string for machine-fed input.
 */
export function parseAssignmentsText(input: string): ParseResult {
  const text = stripBom(input ?? "");
  const ambiguities: Ambiguity[] = [];
  const warnings: ParseWarning[] = [];
  const assignments: AssignmentRow[] = [];

  const trimmed = text.trim();
  if (!trimmed) {
    ambiguities.push({
      code: "empty_input",
      message: "Testo incarichi vuoto",
      ask: "Incolla l’elenco incarichi (una riga per docente/materia/classe/ore).",
    });
    return { assignments, ambiguities, warnings, calendarHints: {} };
  }

  // JSON structured input
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed) as unknown;
      return parseStructuredAssignments(data);
    } catch (e) {
      ambiguities.push({
        code: "invalid_json",
        message: `JSON non valido: ${e instanceof Error ? e.message : String(e)}`,
        ask: "Correggi il JSON oppure usa il formato testo riga-per-riga.",
      });
      return { assignments, ambiguities, warnings, calendarHints: {} };
    }
  }

  const calendarHints = parseCalendarHints(text);
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const t = normalizeWs(raw);
    if (!t) return;
    if (/^(?:istituto|scuola|institution|giorni|days|ore|fasce|hours)\s*[:=]/i.test(t)) return;
    const parsed = parseAssignmentLine(raw, lineNo);
    assignments.push(...parsed.rows);
    ambiguities.push(...parsed.ambiguities);
    warnings.push(...parsed.warnings);
  });

  if (assignments.length === 0 && ambiguities.length === 0) {
    ambiguities.push({
      code: "no_assignments",
      message: "Nessun incarico riconosciuto nel testo",
      ask: "Usa righe del tipo: Rossi Mario: Matematica — 1A — 5 ore (2+2+1)",
    });
  }

  return { assignments, ambiguities, warnings, calendarHints };
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

export function parseStructuredAssignments(data: unknown): ParseResult {
  const ambiguities: Ambiguity[] = [];
  const warnings: ParseWarning[] = [];
  const assignments: AssignmentRow[] = [];
  let calendarHints: Partial<CalendarDefaults> = {};

  let rows: unknown[] = [];
  if (Array.isArray(data)) {
    rows = data;
  } else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (obj.calendar && typeof obj.calendar === "object") {
      calendarHints = obj.calendar as Partial<CalendarDefaults>;
    }
    if (typeof obj.assignmentsText === "string") {
      const nested = parseAssignmentsText(obj.assignmentsText);
      return {
        assignments: nested.assignments,
        ambiguities: nested.ambiguities,
        warnings: nested.warnings,
        calendarHints: { ...nested.calendarHints, ...calendarHints },
      };
    }
    if (Array.isArray(obj.assignments)) rows = obj.assignments;
    else {
      ambiguities.push({
        code: "bad_structured_shape",
        message: "Oggetto JSON: usa { assignments: [...] } oppure { assignmentsText: \"...\" }",
        ask: "Fornisci un array assignments con teacher, subject, students, hoursPerWeek.",
      });
      return { assignments, ambiguities, warnings, calendarHints };
    }
  }

  rows.forEach((row, i) => {
    if (!row || typeof row !== "object") {
      ambiguities.push({
        code: "bad_row",
        message: `Elemento ${i} non è un oggetto`,
        ask: "Ogni incarico deve essere un oggetto JSON.",
      });
      return;
    }
    const r = row as Record<string, unknown>;
    const teacher = asString(r.teacher) ?? asString(r.docente) ?? asString(r.Teacher);
    const subject = asString(r.subject) ?? asString(r.materia) ?? asString(r.Subject);
    const studentsRaw =
      asString(r.students) ?? asString(r.class) ?? asString(r.classe) ?? asString(r.Students);
    const hours =
      asNumber(r.hoursPerWeek) ?? asNumber(r.hours) ?? asNumber(r.ore) ?? asNumber(r.Duration);
    let split: number[] | undefined;
    if (Array.isArray(r.split)) {
      split = r.split.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
    } else if (typeof r.split === "string") {
      split = parseSplitPattern(r.split) ?? undefined;
    }

    if (!teacher || !subject || !studentsRaw || hours == null) {
      ambiguities.push({
        code: "incomplete_row",
        message: `Incarico ${i} incompleto (servono teacher, subject, students, hoursPerWeek)`,
        ask: "Completa i campi mancanti nell’oggetto JSON.",
      });
      return;
    }

    const { classes, multi } = extractClasses(studentsRaw);
    if (multi) {
      ambiguities.push({
        code: "multi_class_hours",
        message: `Incarico ${i}: più classi (${classes.join(", ")}); applico ${hours} ore a ciascuna.`,
        ask: `Confermi ${hours} ore per ciascuna classe tra ${classes.join(", ")}?`,
      });
    }
    if (!split) split = defaultSplitForHours(hours);
    else if (Math.abs(splitSum(split) - hours) > 1e-9) {
      ambiguities.push({
        code: "split_sum_mismatch",
        message: `Incarico ${i}: split somma ${splitSum(split)} ≠ ore ${hours}; allineo ore allo split.`,
        ask: "Vuoi correggere split o ore?",
      });
    }
    const hoursFinal = split ? splitSum(split) : hours;
    for (const students of classes) {
      assignments.push({
        teacher,
        subject,
        students,
        hoursPerWeek: hoursFinal,
        split: [...(split ?? defaultSplitForHours(hoursFinal))],
        tags: Array.isArray(r.tags) ? r.tags.map(String) : undefined,
        source: JSON.stringify(r),
      });
    }
  });

  return { assignments, ambiguities, warnings, calendarHints };
}

export { DEFAULT_DAYS, DEFAULT_HOURS };
