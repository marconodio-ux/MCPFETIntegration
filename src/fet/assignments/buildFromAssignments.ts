import { FetDocument } from "../document.js";
import { defaultCalendar, parseAssignmentsText, yearKeyFromClass } from "./parseAssignments.js";
import { defaultSplitForHours, splitSum } from "./splitDefaults.js";
import type {
  Ambiguity,
  AssignmentRow,
  BuildOptions,
  BuildResult,
  CalendarDefaults,
  ParseWarning,
} from "./types.js";

function mergeCalendar(
  hints: Partial<CalendarDefaults>,
  opts?: CalendarDefaults,
): Required<
  Pick<
    CalendarDefaults,
    | "days"
    | "hours"
    | "institutionName"
    | "mode"
    | "defaultNumberOfStudents"
    | "minDaysWeight"
    | "minDays"
    | "consecutiveIfSameDay"
  >
> &
  CalendarDefaults {
  const base = defaultCalendar();
  return {
    ...base,
    ...hints,
    ...opts,
    days: opts?.days ?? hints.days ?? base.days,
    hours: opts?.hours ?? hints.hours ?? base.hours,
    institutionName: opts?.institutionName ?? hints.institutionName ?? base.institutionName,
    comments: opts?.comments ?? hints.comments ?? base.comments,
    mode: opts?.mode ?? hints.mode ?? base.mode,
    defaultNumberOfStudents:
      opts?.defaultNumberOfStudents ?? hints.defaultNumberOfStudents ?? base.defaultNumberOfStudents,
    minDaysWeight: opts?.minDaysWeight ?? hints.minDaysWeight ?? base.minDaysWeight,
    minDays: opts?.minDays ?? hints.minDays ?? base.minDays,
    consecutiveIfSameDay:
      opts?.consecutiveIfSameDay ?? hints.consecutiveIfSameDay ?? base.consecutiveIfSameDay,
  };
}

function ensureSplit(row: AssignmentRow): number[] {
  if (row.split && row.split.length > 0) return row.split;
  return defaultSplitForHours(row.hoursPerWeek);
}

/**
 * Build a FetDocument from structured assignment rows (Official mode by default).
 * Mapping:
 *  - teachers → Teachers_List
 *  - subjects → Subjects_List
 *  - class "1A" → Year "1" / Group "1A" (no explicit Subgroup; FET auto-fills)
 *  - hours + split → Activity components with shared Activity_Group_Id
 *  - multi-component splits → ConstraintMinDaysBetweenActivities
 */
export function buildDocumentFromAssignments(
  assignments: AssignmentRow[],
  calendar: ReturnType<typeof mergeCalendar>,
  extraAssumptions: string[] = [],
): {
  doc: FetDocument;
  mapping: BuildResult["mapping"];
} {
  const assumptions = [
    ...extraAssumptions,
    `Mode=${calendar.mode}; giorni=${calendar.days.join(",")}; ore/giorno=${calendar.hours.join(",")}`,
    `Classi italiane tipo "1A" → Year "${yearKeyFromClass("1A")}" + Group "1A" (senza Subgroup esplicito).`,
    `Split non dichiarato → pattern di default (es. 5→2+2+1, 6→2+2+2).`,
    `Su ogni split con ≥2 componenti: ConstraintMinDaysBetweenActivities (MinDays=${calendar.minDays}, weight=${calendar.minDaysWeight}%, Consecutive_If_Same_Day=${calendar.consecutiveIfSameDay}).`,
    `BasicCompulsoryTime/Space a peso 100% (già in documento nuovo).`,
    `Nessuna aula/edificio generata (solo se non presenti negli incarichi).`,
  ];

  const comments = [
    calendar.comments?.trim() || "",
    "Generato da incarichi insegnanti (MCP fet_from_assignments).",
  ]
    .filter(Boolean)
    .join("\n");

  const doc = FetDocument.create({
    mode: calendar.mode,
    institutionName: calendar.institutionName,
    comments,
    days: calendar.days,
    hours: calendar.hours,
  });

  const teachers = new Map<string, number>(); // name → target hours
  const subjects = new Set<string>();
  const tags = new Set<string>();
  /**
   * yearKey → set of group names.
   * When class is free-form (yearKey === class name), we store an empty group set and
   * activities reference the Year directly (avoids Year/Group duplicate names).
   */
  const years = new Map<string, Set<string>>();
  const yearOnlyClasses = new Set<string>();

  for (const row of assignments) {
    teachers.set(row.teacher, (teachers.get(row.teacher) ?? 0) + row.hoursPerWeek);
    subjects.add(row.subject);
    for (const t of row.tags ?? []) tags.add(t);
    const y = yearKeyFromClass(row.students);
    if (!years.has(y)) years.set(y, new Set());
    if (y === row.students) {
      yearOnlyClasses.add(row.students);
    } else {
      years.get(y)!.add(row.students);
    }
  }

  for (const name of subjects) {
    doc.upsertEntity("subjects", { Name: name, Long_Name: "", Code: "", Comments: "" });
  }
  for (const name of tags) {
    doc.upsertEntity("activity_tags", {
      Name: name,
      Long_Name: "",
      Code: "",
      Printable: "true",
      Comments: "",
    });
  }
  for (const [name, target] of teachers) {
    doc.upsertEntity("teachers", {
      Name: name,
      Long_Name: "",
      Code: "",
      Target_Number_of_Hours: String(target),
      Qualified_Subjects: {},
      Comments: "",
    });
  }

  for (const [yearName, groups] of years) {
    const groupFields = [...groups].map((g) => ({
      Name: g,
      Long_Name: "",
      Code: "",
      Number_of_Students: String(calendar.defaultNumberOfStudents),
      Comments: "",
    }));
    const nUnits = groupFields.length > 0 ? groupFields.length : 1;
    const nStudents = calendar.defaultNumberOfStudents * nUnits;
    const fields: Record<string, unknown> = {
      Name: yearName,
      Long_Name: "",
      Code: "",
      Number_of_Students: String(nStudents),
      Comments: yearOnlyClasses.has(yearName) ? "year-only class label" : "",
      Number_of_Categories: "0",
      First_Category_Is_Permanent: "false",
      Separator: " ",
    };
    if (groupFields.length === 1) fields.Group = groupFields[0]!;
    else if (groupFields.length > 1) fields.Group = groupFields;
    doc.upsertEntity("students", fields);
  }

  let nextId = 1;
  let nextGroupId = 1;
  const activityIds: number[] = [];
  const splitGroups: BuildResult["mapping"]["splitGroups"] = [];

  for (const row of assignments) {
    const split = ensureSplit(row);
    const total = splitSum(split);
    const isSplit = split.length > 1;
    const groupId = isSplit ? nextGroupId++ : 0;
    const idsForGroup: number[] = [];

    for (const duration of split) {
      const id = nextId++;
      idsForGroup.push(id);
      activityIds.push(id);
      const fields: Record<string, unknown> = {
        Teacher: row.teacher,
        Subject: row.subject,
        Students: row.students,
        Duration: String(duration),
        Total_Duration: String(total),
        Id: String(id),
        Activity_Group_Id: String(groupId),
        Active: "true",
        Comments: row.source ? `from: ${row.source}` : "",
      };
      if (row.tags && row.tags.length > 0) {
        fields.Activity_Tag = row.tags.length === 1 ? row.tags[0]! : [...row.tags];
      }
      doc.upsertEntity("activities", fields);
    }

    if (isSplit) {
      splitGroups.push({ activityGroupId: groupId, activityIds: idsForGroup, split: [...split] });
      doc.addConstraint("ConstraintMinDaysBetweenActivities", {
        Weight_Percentage: String(calendar.minDaysWeight),
        Consecutive_If_Same_Day: calendar.consecutiveIfSameDay ? "true" : "false",
        Number_of_Activities: String(idsForGroup.length),
        Activity_Id: idsForGroup.map(String),
        MinDays: String(calendar.minDays),
        Active: "true",
        Comments: `split ${split.join("+")} for ${row.teacher}/${row.subject}/${row.students}`,
      });
    }
  }

  const classNames = new Set<string>([
    ...[...years.values()].flatMap((s) => [...s]),
    ...yearOnlyClasses,
  ]);

  return {
    doc,
    mapping: {
      teachers: [...teachers.keys()].sort((a, b) => a.localeCompare(b, "it")),
      subjects: [...subjects].sort((a, b) => a.localeCompare(b, "it")),
      classes: [...classNames].sort((a, b) => a.localeCompare(b, "it")),
      activityIds,
      splitGroups,
      assumptions,
    },
  };
}

export function generateFetFromAssignments(
  input: string | AssignmentRow[],
  options: BuildOptions = {},
): { result: BuildResult; doc: FetDocument; ambiguities: Ambiguity[]; warnings: ParseWarning[] } {
  let assignments: AssignmentRow[];
  let ambiguities: Ambiguity[] = [];
  let warnings: ParseWarning[] = [];
  let hints: Partial<CalendarDefaults> = {};

  if (typeof input === "string") {
    const parsed = parseAssignmentsText(input);
    assignments = parsed.assignments;
    ambiguities = parsed.ambiguities;
    warnings = parsed.warnings;
    hints = parsed.calendarHints;
  } else {
    assignments = input.map((r) => ({
      ...r,
      split: r.split && r.split.length ? r.split : defaultSplitForHours(r.hoursPerWeek),
    }));
  }

  const calendar = mergeCalendar(hints, options.calendar);

  if (options.strictAmbiguities && ambiguities.length > 0) {
    const empty = FetDocument.create({
      mode: calendar.mode,
      institutionName: calendar.institutionName,
      days: calendar.days,
      hours: calendar.hours,
    });
    return {
      doc: empty,
      ambiguities,
      warnings,
      result: {
        assignments,
        ambiguities,
        warnings,
        mapping: {
          teachers: [],
          subjects: [],
          classes: [],
          activityIds: [],
          splitGroups: [],
          assumptions: ["Build skipped: strictAmbiguities=true and ambiguities present."],
        },
        summary: empty.summarize(),
      },
    };
  }

  if (assignments.length === 0) {
    const empty = FetDocument.create({
      mode: calendar.mode,
      institutionName: calendar.institutionName,
      days: calendar.days,
      hours: calendar.hours,
      comments: "Nessun incarico valido da generare.",
    });
    return {
      doc: empty,
      ambiguities,
      warnings,
      result: {
        assignments,
        ambiguities,
        warnings,
        mapping: {
          teachers: [],
          subjects: [],
          classes: [],
          activityIds: [],
          splitGroups: [],
          assumptions: ["Nessuna attività generata."],
        },
        summary: empty.summarize(),
      },
    };
  }

  const { doc, mapping } = buildDocumentFromAssignments(assignments, calendar);
  return {
    doc,
    ambiguities,
    warnings,
    result: {
      assignments,
      ambiguities,
      warnings,
      mapping,
      summary: doc.summarize(),
    },
  };
}
