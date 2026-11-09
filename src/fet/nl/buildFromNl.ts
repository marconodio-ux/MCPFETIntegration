/**
 * Build FetDocument from NlIntent: Year → Group → Subgroup, activities, MinDays, SameStartingTime.
 */

import { FetDocument } from "../document.js";
import { defaultCalendar } from "../assignments/parseAssignments.js";
import { defaultSplitForHours, splitSum } from "../assignments/splitDefaults.js";
import { getPhraseTemplate } from "./phrases/catalogPhrases.js";
import {
  fetSubgroupName,
  mergeNlInputs,
  yearKeyFromNlClass,
} from "./parseNl.js";
import type {
  CalendarDefaults,
  NlAssignment,
  NlBuildMapping,
  NlBuildOptions,
  NlBuildResult,
  NlClassSplit,
  NlConstraintSpec,
  NlGap,
  NlIntent,
  NlParseResult,
} from "./types.js";

function mergeCalendar(
  hints: Partial<CalendarDefaults> | undefined,
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
    days: opts?.days ?? hints?.days ?? base.days,
    hours: opts?.hours ?? hints?.hours ?? base.hours,
    institutionName: opts?.institutionName ?? hints?.institutionName ?? base.institutionName,
    comments: opts?.comments ?? hints?.comments ?? base.comments,
    mode: opts?.mode ?? hints?.mode ?? base.mode,
    defaultNumberOfStudents:
      opts?.defaultNumberOfStudents ?? hints?.defaultNumberOfStudents ?? base.defaultNumberOfStudents,
    minDaysWeight: opts?.minDaysWeight ?? hints?.minDaysWeight ?? base.minDaysWeight,
    minDays: opts?.minDays ?? hints?.minDays ?? base.minDays,
    consecutiveIfSameDay:
      opts?.consecutiveIfSameDay ?? hints?.consecutiveIfSameDay ?? base.consecutiveIfSameDay,
  };
}

function ensureSplit(row: NlAssignment): number[] {
  if (row.split && row.split.length > 0) return row.split;
  return defaultSplitForHours(row.hoursPerWeek);
}

interface TreeGroup {
  name: string;
  subgroups: Set<string>; // FET unique subgroup names
}

interface StudentTree {
  years: Map<string, Map<string, TreeGroup>>; // year → groupName → TreeGroup
  /** short label lookup: "P1A|meccanica" → "P1A-meccanica" */
  subgroupNames: Record<string, string>;
}

function buildStudentTree(intent: NlIntent): StudentTree {
  const years = new Map<string, Map<string, TreeGroup>>();
  const subgroupNames: Record<string, string> = {};

  const ensureYear = (y: string) => {
    if (!years.has(y)) years.set(y, new Map());
    return years.get(y)!;
  };
  const ensureGroup = (y: string, g: string) => {
    const ym = ensureYear(y);
    if (!ym.has(g)) ym.set(g, { name: g, subgroups: new Set() });
    return ym.get(g)!;
  };

  if (intent.studentsTree?.length) {
    for (const y of intent.studentsTree) {
      for (const g of y.groups) {
        const tg = ensureGroup(y.year, g.name);
        for (const s of g.subgroups) {
          const fet = s.includes("-") || s.startsWith(g.name) ? s : fetSubgroupName(g.name, s);
          tg.subgroups.add(fet);
          subgroupNames[`${g.name}|${s}`] = fet;
        }
      }
    }
  }

  for (const split of intent.classSplits) {
    const year = split.year ?? yearKeyFromNlClass(split.group);
    const tg = ensureGroup(year, split.group);
    for (const short of split.subgroups) {
      const fet = fetSubgroupName(split.group, short);
      tg.subgroups.add(fet);
      subgroupNames[`${split.group}|${short}`] = fet;
      subgroupNames[`${split.group}|${fet}`] = fet;
    }
  }

  for (const a of intent.assignments) {
    const st = a.students;
    // Already a known subgroup?
    let placed = false;
    for (const [, gm] of years) {
      for (const [, tg] of gm) {
        if (tg.subgroups.has(st) || tg.name === st) {
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (placed) continue;

    // Subgroup pattern Group-label
    const m = st.match(/^(.+)-([^-]+)$/);
    if (m && [...years.values()].some((gm) => gm.has(m[1]!))) {
      const group = m[1]!;
      const year = yearKeyFromNlClass(group);
      ensureGroup(year, group).subgroups.add(st);
      continue;
    }

    // Year-only (e.g. "1" / "P1") — no group yet
    if (/^P?\d+$/i.test(st)) {
      ensureYear(st.toUpperCase().replace(/^p/, "P"));
      continue;
    }

    // Group label (P1A / 1A)
    const year = yearKeyFromNlClass(st);
    ensureGroup(year, st);
  }

  return { years, subgroupNames };
}

function writeStudents(doc: FetDocument, tree: StudentTree, perUnit: number): void {
  for (const [yearName, groups] of tree.years) {
    const groupFields = [...groups.values()].map((g) => {
      const subs = [...g.subgroups];
      const nStudents = perUnit * (subs.length > 0 ? subs.length : 1);
      const fields: Record<string, unknown> = {
        Name: g.name,
        Long_Name: "",
        Code: "",
        Number_of_Students: String(nStudents),
        Comments: subs.length ? `split: ${subs.join(", ")}` : "",
      };
      if (subs.length === 1) {
        fields.Subgroup = {
          Name: subs[0],
          Long_Name: "",
          Code: "",
          Number_of_Students: String(perUnit),
          Comments: "",
        };
      } else if (subs.length > 1) {
        fields.Subgroup = subs.map((name) => ({
          Name: name,
          Long_Name: "",
          Code: "",
          Number_of_Students: String(perUnit),
          Comments: "",
        }));
      }
      return fields;
    });

    const nUnits =
      groupFields.length > 0
        ? groupFields.reduce((acc, g) => {
            const subs = g.Subgroup;
            if (Array.isArray(subs)) return acc + subs.length;
            if (subs) return acc + 1;
            return acc + 1;
          }, 0)
        : 1;

    const fields: Record<string, unknown> = {
      Name: yearName,
      Long_Name: "",
      Code: "",
      Number_of_Students: String(perUnit * nUnits),
      Comments: "",
      Number_of_Categories: "0",
      First_Category_Is_Permanent: "false",
      Separator: " ",
    };
    if (groupFields.length === 1) fields.Group = groupFields[0]!;
    else if (groupFields.length > 1) fields.Group = groupFields;
    doc.upsertEntity("students", fields);
  }
}

function findAssignmentActivityIds(
  mappingRows: Array<{ assignment: NlAssignment; activityIds: number[]; split: number[] }>,
  a: NlAssignment,
): number[] | undefined {
  const row = mappingRows.find(
    (r) =>
      r.assignment.teacher === a.teacher &&
      r.assignment.subject === a.subject &&
      r.assignment.students === a.students,
  );
  return row?.activityIds;
}

/**
 * Pair parallel subgroup activities for SameStartingTime when durations align component-wise.
 */
function addParallelSameStarting(
  doc: FetDocument,
  intent: NlIntent,
  mappingRows: Array<{ assignment: NlAssignment; activityIds: number[]; split: number[] }>,
  parallelPairs: NlBuildMapping["parallelPairs"],
  assumptions: string[],
  gaps: NlGap[],
): void {
  for (const split of intent.classSplits) {
    if (split.parallel === false) continue;
    if (split.subgroups.length < 2) continue;

    // Collect assignments per subgroup of this group
    const byHalf: Array<{ short: string; fet: string; rows: typeof mappingRows }> = [];
    for (const short of split.subgroups) {
      const fet = fetSubgroupName(split.group, short);
      const rows = mappingRows.filter((r) => r.assignment.students === fet);
      byHalf.push({ short, fet, rows });
    }

    // Pair first two halves that both have activities (typical 2-way split)
    for (let i = 0; i < byHalf.length; i++) {
      for (let j = i + 1; j < byHalf.length; j++) {
        const A = byHalf[i]!;
        const B = byHalf[j]!;
        if (A.rows.length === 0 || B.rows.length === 0) {
          gaps.push({
            code: "parallel_missing_activity",
            message: `Split parallelo ${split.group}: manca attività su ${A.rows.length ? B.fet : A.fet}`,
            ask: `Aggiungi incarico (materia + ore) per il sottogruppo senza attività in ${split.group}, altrimenti non posso allineare SameStartingTime.`,
            about: { group: split.group },
          });
          continue;
        }
        // Pair each A row with each B row that shares comparable total hours / same subject family
        for (const ra of A.rows) {
          for (const rb of B.rows) {
            const n = Math.min(ra.activityIds.length, rb.activityIds.length);
            if (n < 1) continue;
            const idsA = ra.activityIds.slice(0, n);
            const idsB = rb.activityIds.slice(0, n);
            // Pair component-wise: SameStartingTime for each pair (or one constraint with all?)
            // FET ConstraintActivitiesSameStartingTime takes a list — all listed share same start.
            // For split components we want component i of A with component i of B.
            // So emit n constraints each with 2 activity ids.
            for (let k = 0; k < n; k++) {
              const pair = [idsA[k]!, idsB[k]!];
              doc.addConstraint("ConstraintActivitiesSameStartingTime", {
                Weight_Percentage: "100",
                Number_of_Activities: "2",
                Activity_Id: pair.map(String),
                Active: "true",
                Comments: `parallel split ${split.group}: ${A.short}↔${B.short} #${k + 1}`,
              });
            }
            parallelPairs.push({
              group: split.group,
              activityIdsA: idsA,
              activityIdsB: idsB,
              constraint: "ConstraintActivitiesSameStartingTime",
            });
            if (ra.activityIds.length !== rb.activityIds.length) {
              gaps.push({
                code: "parallel_hours_mismatch",
                message: `Ore/componenti diversi tra ${A.fet} (${ra.assignment.hoursPerWeek}h) e ${B.fet} (${rb.assignment.hoursPerWeek}h): allineo solo ${n} componenti`,
                ask: `Vuoi pareggiare le ore di ${ra.assignment.teacher} e ${rb.assignment.teacher} su ${split.group}, o lasciare ${n} slot in parallelo e il resto indipendente?`,
                about: { group: split.group },
              });
            }
            assumptions.push(
              `ConstraintActivitiesSameStartingTime: ${n} coppie ${A.fet}↔${B.fet} (classe spezzata in parallelo).`,
            );
          }
        }
      }
    }
  }
}

export function buildDocumentFromNlIntent(
  intent: NlIntent,
  calendar: ReturnType<typeof mergeCalendar>,
  options: { parallelSameStartingTime?: boolean } = {},
  extraAssumptions: string[] = [],
  priorGaps: NlGap[] = [],
): { doc: FetDocument; mapping: NlBuildMapping; gaps: NlGap[] } {
  const gaps = [...priorGaps];
  const assumptions = [
    ...extraAssumptions,
    `Mode=${calendar.mode}; giorni=${calendar.days.join(",")}; ore/giorno=${calendar.hours.join(",")}`,
    `Classi IT tipo P1A → Year P1 + Group P1A; sottogruppi → Subgroup P1A-<label> (nomi univoci).`,
    `Split settimanale non dichiarato → pattern default; MinDaysBetweenActivities (MinDays=${calendar.minDays}, weight=${calendar.minDaysWeight}%).`,
    `BasicCompulsoryTime/Space a peso 100%.`,
    `Nessuna aula generata se non dichiarata nel testo.`,
  ];

  const comments = [
    calendar.comments?.trim() || intent.comments?.trim() || "",
    "Generato da linguaggio naturale (MCP fet_nl_build).",
  ]
    .filter(Boolean)
    .join("\n");

  const doc = FetDocument.create({
    mode: calendar.mode,
    institutionName: intent.institutionName ?? calendar.institutionName,
    comments,
    days: calendar.days,
    hours: calendar.hours,
  });

  const tree = buildStudentTree(intent);
  const teachers = new Map<string, number>();
  const subjects = new Set<string>();
  const tags = new Set<string>();

  for (const row of intent.assignments) {
    teachers.set(row.teacher, (teachers.get(row.teacher) ?? 0) + row.hoursPerWeek);
    subjects.add(row.subject);
    for (const t of row.tags ?? []) tags.add(t);
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

  writeStudents(doc, tree, calendar.defaultNumberOfStudents);

  let nextId = 1;
  let nextGroupId = 1;
  const activityIds: number[] = [];
  const splitGroups: NlBuildMapping["splitGroups"] = [];
  const mappingRows: Array<{ assignment: NlAssignment; activityIds: number[]; split: number[] }> =
    [];

  for (const row of intent.assignments) {
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

    mappingRows.push({ assignment: row, activityIds: idsForGroup, split: [...split] });

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

  const parallelPairs: NlBuildMapping["parallelPairs"] = [];
  if (options.parallelSameStartingTime !== false) {
    addParallelSameStarting(doc, intent, mappingRows, parallelPairs, assumptions, gaps);
  }

  applyNlConstraints(doc, intent.constraints ?? [], assumptions, gaps);

  const years = [...tree.years.keys()].sort((a, b) => a.localeCompare(b, "it"));
  const groups: string[] = [];
  const subgroups: string[] = [];
  for (const [, gm] of tree.years) {
    for (const [g, tg] of gm) {
      groups.push(g);
      subgroups.push(...tg.subgroups);
    }
  }

  return {
    doc,
    gaps,
    mapping: {
      teachers: [...teachers.keys()].sort((a, b) => a.localeCompare(b, "it")),
      subjects: [...subjects].sort((a, b) => a.localeCompare(b, "it")),
      years,
      groups: groups.sort((a, b) => a.localeCompare(b, "it")),
      subgroups: [...new Set(subgroups)].sort((a, b) => a.localeCompare(b, "it")),
      activityIds,
      splitGroups,
      parallelPairs,
      assumptions,
      subgroupNames: tree.subgroupNames,
    },
  };
}

/**
 * Apply NL constraint specs onto a document (build or patch).
 * Skips duplicate BasicCompulsory*; normalizes fields via phrase templates.
 */
export function applyNlConstraints(
  doc: FetDocument,
  specs: NlConstraintSpec[],
  assumptions: string[],
  gaps: NlGap[],
): string[] {
  const applied: string[] = [];
  for (const spec of specs) {
    const tpl = getPhraseTemplate(spec.type);
    if (!tpl) {
      gaps.push({
        code: "unknown_constraint_type",
        message: `Tipo vincolo sconosciuto: ${spec.type}`,
        ask: "Usa un tipo del catalogo FET (fet_constraint_catalog / fet_nl_phrase_catalog).",
        about: { type: spec.type },
      });
      continue;
    }
    if (
      (spec.type === "ConstraintBasicCompulsoryTime" ||
        spec.type === "ConstraintBasicCompulsorySpace") &&
      doc.listConstraints({ type: spec.type }).length > 0
    ) {
      assumptions.push(`Skip duplicate ${spec.type} (già presente).`);
      continue;
    }
    const fields = tpl.fromStructured(spec.fields ?? {});
    if (spec.italian && !fields.Comments) {
      fields.Comments = String(spec.italian).slice(0, 200);
    }
    try {
      doc.addConstraint(spec.type, fields);
      applied.push(`${spec.type}${tpl.status === "stub" ? " (stub fields)" : ""}`);
      assumptions.push(`Vincolo aggiunto: ${spec.type}`);
    } catch (e) {
      gaps.push({
        code: "constraint_add_failed",
        message: e instanceof Error ? e.message : String(e),
        ask: `Verifica i campi per ${spec.type}.`,
        about: { type: spec.type },
      });
    }
  }
  return applied;
}

export function generateFetFromNl(
  text: string | undefined,
  intentPartial: Partial<NlIntent> | undefined,
  options: NlBuildOptions = {},
): { result: NlBuildResult; doc: FetDocument; parse: NlParseResult } {
  const parse = mergeNlInputs(text, intentPartial);
  const calendar = mergeCalendar(parse.intent.calendar, options.calendar);

  if (options.strictGaps && parse.gaps.length > 0) {
    const empty = FetDocument.create({
      mode: calendar.mode,
      institutionName: parse.intent.institutionName ?? calendar.institutionName,
      days: calendar.days,
      hours: calendar.hours,
    });
    return {
      doc: empty,
      parse,
      result: {
        intent: parse.intent,
        gaps: parse.gaps,
        warnings: parse.warnings,
        notes: parse.notes,
        mapping: {
          teachers: [],
          subjects: [],
          years: [],
          groups: [],
          subgroups: [],
          activityIds: [],
          splitGroups: [],
          parallelPairs: [],
          assumptions: ["Build skipped: strictGaps=true and gaps present."],
          subgroupNames: {},
        },
        summary: empty.summarize(),
      },
    };
  }

  if (parse.intent.assignments.length === 0) {
    const empty = FetDocument.create({
      mode: calendar.mode,
      institutionName: parse.intent.institutionName ?? calendar.institutionName,
      days: calendar.days,
      hours: calendar.hours,
      comments: "Nessun incarico valido da generare (fet_nl_build).",
    });
    return {
      doc: empty,
      parse,
      result: {
        intent: parse.intent,
        gaps: parse.gaps,
        warnings: parse.warnings,
        notes: parse.notes,
        mapping: {
          teachers: [],
          subjects: [],
          years: [],
          groups: [],
          subgroups: [],
          activityIds: [],
          splitGroups: [],
          parallelPairs: [],
          assumptions: ["Nessuna attività generata."],
          subgroupNames: {},
        },
        summary: empty.summarize(),
      },
    };
  }

  const { doc, mapping, gaps } = buildDocumentFromNlIntent(
    parse.intent,
    calendar,
    { parallelSameStartingTime: options.parallelSameStartingTime },
    [],
    [...parse.gaps],
  );

  return {
    doc,
    parse,
    result: {
      intent: parse.intent,
      gaps,
      warnings: parse.warnings,
      notes: parse.notes,
      mapping,
      summary: doc.summarize(),
    },
  };
}

export { findAssignmentActivityIds };
