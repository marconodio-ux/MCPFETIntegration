/**
 * Conversational patches on an existing FetDocument workspace (MFI-8).
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
  NlBuildOptions,
  NlClassSplit,
  NlGap,
  NlIntent,
  NlPatchOp,
  NlPatchResult,
} from "./types.js";

function asFields(rec: Record<string, unknown>): Record<string, unknown> {
  return rec;
}

function activityIdOf(fields: Record<string, unknown>): number {
  return Number(fields.Id ?? 0);
}

function activityTeacher(fields: Record<string, unknown>): string {
  const t = fields.Teacher;
  if (Array.isArray(t)) return String(t[0] ?? "");
  return String(t ?? "");
}

function activitySubject(fields: Record<string, unknown>): string {
  return String(fields.Subject ?? "");
}

function activityStudents(fields: Record<string, unknown>): string {
  const s = fields.Students;
  if (Array.isArray(s)) return String(s[0] ?? "");
  return String(s ?? "");
}

function matchActivity(
  fields: Record<string, unknown>,
  match: {
    teacher?: string;
    subject?: string;
    students?: string;
    key?: string;
    activityIds?: number[];
  },
): boolean {
  const id = activityIdOf(fields);
  if (match.activityIds?.length && match.activityIds.includes(id)) return true;
  if (match.key && String(fields.Comments ?? "").includes(match.key)) return true;
  if (match.teacher && activityTeacher(fields).toLowerCase() !== match.teacher.toLowerCase()) {
    return false;
  }
  if (match.subject && activitySubject(fields).toLowerCase() !== match.subject.toLowerCase()) {
    return false;
  }
  if (match.students && activityStudents(fields) !== match.students) return false;
  // If only teacher (or teacher+…) provided without activityIds, require teacher match already done
  return !!(match.teacher || match.subject || match.students || match.key || match.activityIds);
}

function maxActivityId(doc: FetDocument): number {
  let max = 0;
  for (const e of doc.listEntities("activities")) {
    max = Math.max(max, activityIdOf(e.fields));
  }
  return max;
}

function maxActivityGroupId(doc: FetDocument): number {
  let max = 0;
  for (const e of doc.listEntities("activities")) {
    max = Math.max(max, Number(e.fields.Activity_Group_Id ?? 0));
  }
  return max;
}

function ensureTeacher(doc: FetDocument, name: string, addHours: number): void {
  const existing = doc.listEntities("teachers").find((e) => String(e.fields.Name) === name);
  if (!existing) {
    doc.upsertEntity("teachers", {
      Name: name,
      Long_Name: "",
      Code: "",
      Target_Number_of_Hours: String(addHours),
      Qualified_Subjects: {},
      Comments: "",
    });
    return;
  }
  const cur = Number(existing.fields.Target_Number_of_Hours ?? 0);
  doc.upsertEntity(
    "teachers",
    {
      ...asFields(existing.fields),
      Target_Number_of_Hours: String(cur + addHours),
    },
    existing.index,
  );
}

function ensureSubject(doc: FetDocument, name: string): void {
  if (doc.listEntities("subjects").some((e) => String(e.fields.Name) === name)) return;
  doc.upsertEntity("subjects", { Name: name, Long_Name: "", Code: "", Comments: "" });
}

/**
 * Merge a class split into the existing students Year/Group tree.
 */
function ensureClassSplitOnDoc(
  doc: FetDocument,
  split: NlClassSplit,
  defaultStudents: number,
  applied: string[],
): void {
  const yearName = split.year ?? yearKeyFromNlClass(split.group);
  const years = doc.listEntities("students");
  let yearEntry = years.find((e) => String(e.fields.Name) === yearName);
  const fetSubs = split.subgroups.map((s) => fetSubgroupName(split.group, s));

  const subgroupFields = fetSubs.map((name) => ({
    Name: name,
    Long_Name: "",
    Code: "",
    Number_of_Students: String(defaultStudents),
    Comments: "",
  }));

  if (!yearEntry) {
    doc.upsertEntity("students", {
      Name: yearName,
      Long_Name: "",
      Code: "",
      Number_of_Students: String(defaultStudents * fetSubs.length),
      Comments: "",
      Number_of_Categories: "0",
      First_Category_Is_Permanent: "false",
      Separator: " ",
      Group: {
        Name: split.group,
        Long_Name: "",
        Code: "",
        Number_of_Students: String(defaultStudents * fetSubs.length),
        Comments: `split: ${fetSubs.join(", ")}`,
        Subgroup: subgroupFields.length === 1 ? subgroupFields[0]! : subgroupFields,
      },
    });
    applied.push(`students: created Year ${yearName} / Group ${split.group} with ${fetSubs.join(", ")}`);
    return;
  }

  // Merge into existing year
  const fields = { ...asFields(yearEntry.fields) };
  let groups = fields.Group;
  const groupList: Record<string, unknown>[] = Array.isArray(groups)
    ? [...groups]
    : groups
      ? [groups as Record<string, unknown>]
      : [];

  let gIdx = groupList.findIndex((g) => String(g.Name) === split.group);
  if (gIdx < 0) {
    groupList.push({
      Name: split.group,
      Long_Name: "",
      Code: "",
      Number_of_Students: String(defaultStudents * fetSubs.length),
      Comments: `split: ${fetSubs.join(", ")}`,
      Subgroup: subgroupFields.length === 1 ? subgroupFields[0]! : subgroupFields,
    });
    applied.push(`students: added Group ${split.group} under ${yearName}`);
  } else {
    const g = { ...groupList[gIdx]! };
    let subs = g.Subgroup;
    const subList: Record<string, unknown>[] = Array.isArray(subs)
      ? [...subs]
      : subs
        ? [subs as Record<string, unknown>]
        : [];
    for (const sf of subgroupFields) {
      if (!subList.some((s) => String(s.Name) === sf.Name)) {
        subList.push(sf);
        applied.push(`students: added Subgroup ${sf.Name}`);
      }
    }
    g.Subgroup = subList.length === 1 ? subList[0]! : subList;
    g.Number_of_Students = String(defaultStudents * subList.length);
    g.Comments = `split: ${subList.map((s) => s.Name).join(", ")}`;
    groupList[gIdx] = g;
  }

  fields.Group = groupList.length === 1 ? groupList[0]! : groupList;
  fields.Number_of_Students = String(
    groupList.reduce((acc, g) => acc + Number(g.Number_of_Students ?? defaultStudents), 0),
  );
  doc.upsertEntity("students", fields, yearEntry.index);
}

function addAssignmentToDoc(
  doc: FetDocument,
  row: NlAssignment,
  calendar: Required<Pick<CalendarDefaults, "minDaysWeight" | "minDays" | "consecutiveIfSameDay">>,
  applied: string[],
): number[] {
  ensureTeacher(doc, row.teacher, row.hoursPerWeek);
  ensureSubject(doc, row.subject);
  const split = row.split && row.split.length ? row.split : defaultSplitForHours(row.hoursPerWeek);
  const total = splitSum(split);
  const isSplit = split.length > 1;
  let nextId = maxActivityId(doc) + 1;
  let groupId = isSplit ? maxActivityGroupId(doc) + 1 : 0;
  const ids: number[] = [];

  for (const duration of split) {
    const id = nextId++;
    ids.push(id);
    doc.upsertEntity("activities", {
      Teacher: row.teacher,
      Subject: row.subject,
      Students: row.students,
      Duration: String(duration),
      Total_Duration: String(total),
      Id: String(id),
      Activity_Group_Id: String(groupId),
      Active: "true",
      Comments: row.source ? `patch: ${row.source}` : "patch: add_assignment",
    });
  }

  if (isSplit) {
    doc.addConstraint("ConstraintMinDaysBetweenActivities", {
      Weight_Percentage: String(calendar.minDaysWeight),
      Consecutive_If_Same_Day: calendar.consecutiveIfSameDay ? "true" : "false",
      Number_of_Activities: String(ids.length),
      Activity_Id: ids.map(String),
      MinDays: String(calendar.minDays),
      Active: "true",
      Comments: `patch split ${split.join("+")} for ${row.teacher}/${row.subject}/${row.students}`,
    });
  }

  applied.push(
    `add_assignment: ${row.teacher} / ${row.subject} / ${row.students} ${row.hoursPerWeek}h → ids ${ids.join(",")}`,
  );
  return ids;
}

type AssignmentMatch = {
  teacher?: string;
  subject?: string;
  students?: string;
  key?: string;
  activityIds?: number[];
};

function removeMatchingActivities(
  doc: FetDocument,
  match: AssignmentMatch,
  applied: string[],
  skipped: string[],
): number[] {
  const removedIds: number[] = [];
  // Remove from highest index to lowest
  const items = doc.listEntities("activities");
  const toRemove: number[] = [];
  for (const e of items) {
    if (matchActivity(e.fields, match)) {
      toRemove.push(e.index);
      removedIds.push(activityIdOf(e.fields));
    }
  }
  if (toRemove.length === 0) {
    skipped.push(`remove_assignment: no match for ${JSON.stringify(match)}`);
    return removedIds;
  }
  for (const idx of toRemove.sort((a, b) => b - a)) {
    doc.removeEntity("activities", idx);
  }
  // Drop MinDays / SameStarting constraints that reference removed ids
  const constraints = doc.listConstraints({ kind: "time" });
  const dropIdx: number[] = [];
  for (const c of constraints) {
    if (
      c.type !== "ConstraintMinDaysBetweenActivities" &&
      c.type !== "ConstraintActivitiesSameStartingTime" &&
      c.type !== "ConstraintActivitiesNotOverlapping"
    ) {
      continue;
    }
    const raw = c.fields.Activity_Id;
    const ids = (Array.isArray(raw) ? raw : raw != null ? [raw] : []).map(Number);
    if (ids.some((id) => removedIds.includes(id))) {
      dropIdx.push(c.index);
    }
  }
  for (const idx of dropIdx.sort((a, b) => b - a)) {
    doc.removeConstraint("time", idx);
  }
  applied.push(`remove_assignment: removed activity ids ${removedIds.join(",")}`);
  return removedIds;
}

function changeMatchingAssignments(
  doc: FetDocument,
  match: {
    teacher?: string;
    subject?: string;
    students?: string;
    key?: string;
    activityIds?: number[];
  },
  set: Partial<Pick<NlAssignment, "teacher" | "subject" | "students" | "hoursPerWeek" | "split" | "tags">>,
  calendar: Required<Pick<CalendarDefaults, "minDaysWeight" | "minDays" | "consecutiveIfSameDay">>,
  applied: string[],
  skipped: string[],
  gaps: NlGap[],
): void {
  const items = doc.listEntities("activities").filter((e) => matchActivity(e.fields, match));
  if (items.length === 0) {
    skipped.push(`change_assignment: no match for ${JSON.stringify(match)}`);
    return;
  }

  // Group by Activity_Group_Id (or single id)
  const groups = new Map<string, typeof items>();
  for (const e of items) {
    const gid = String(e.fields.Activity_Group_Id ?? "0");
    const key = gid === "0" ? `id:${e.fields.Id}` : `g:${gid}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  for (const [, group] of groups) {
    const sample = group[0]!.fields;
    const teacher = set.teacher ?? activityTeacher(sample);
    const subject = set.subject ?? activitySubject(sample);
    const students = set.students ?? activityStudents(sample);

    if (set.hoursPerWeek != null || set.split) {
      // Rebuild split: remove old, add new
      const ids = group.map((g) => activityIdOf(g.fields));
      removeMatchingActivities(doc, { activityIds: ids }, applied, skipped);
      const hours = set.hoursPerWeek ?? Number(sample.Total_Duration ?? splitSum(group.map((g) => Number(g.fields.Duration))));
      const split = set.split ?? defaultSplitForHours(hours);
      addAssignmentToDoc(
        doc,
        {
          teacher,
          subject,
          students,
          hoursPerWeek: splitSum(split),
          split,
          tags: set.tags,
          source: "change_assignment",
        },
        calendar,
        applied,
      );
      applied.push(`change_assignment: rebuilt ${teacher}/${subject}/${students} → ${split.join("+")}`);
    } else {
      // In-place field updates
      for (const e of group) {
        const fields = { ...asFields(e.fields) };
        if (set.teacher) fields.Teacher = set.teacher;
        if (set.subject) fields.Subject = set.subject;
        if (set.students) fields.Students = set.students;
        if (set.tags) {
          fields.Activity_Tag = set.tags.length === 1 ? set.tags[0]! : [...set.tags];
        }
        ensureTeacher(doc, teacher, 0);
        ensureSubject(doc, subject);
        doc.upsertEntity("activities", fields, e.index);
      }
      applied.push(`change_assignment: updated fields on ids ${group.map((g) => g.fields.Id).join(",")}`);
    }
  }

  if (set.hoursPerWeek == null && set.split == null && !set.teacher && !set.subject && !set.students) {
    gaps.push({
      code: "empty_change",
      message: "change_assignment senza campi in `set`",
      ask: "Specifica cosa cambiare (ore, materia, classe, docente).",
    });
  }
}

/**
 * Apply patch ops (from text and/or structured) onto an existing document.
 * For large structural rebuilds (many new splits), prefer fet_nl_build.
 */
export function applyNlPatchToDocument(
  doc: FetDocument,
  text: string | undefined,
  intentPartial: Partial<NlIntent> | undefined,
  options: NlBuildOptions = {},
): NlPatchResult {
  const parse = mergeNlInputs(text, intentPartial);
  const gaps: NlGap[] = [...parse.gaps];
  const applied: string[] = [];
  const skipped: string[] = [];
  const calendar = {
    ...defaultCalendar(),
    ...parse.intent.calendar,
    ...options.calendar,
  };

  const ops: NlPatchOp[] = [...(parse.intent.patches ?? [])];

  // If text/intent also carried new assignments without explicit patch ops, treat as add
  if (ops.length === 0 && parse.intent.assignments.length > 0) {
    for (const a of parse.intent.assignments) {
      ops.push({ op: "add_assignment", assignment: a });
    }
  }
  for (const s of parse.intent.classSplits) {
    if (!ops.some((o) => o.op === "add_class_split" && o.split.group === s.group)) {
      ops.push({ op: "add_class_split", split: s });
    }
  }
  for (const c of parse.intent.constraints ?? []) {
    if (
      !ops.some(
        (o) =>
          o.op === "add_constraint" &&
          o.type === c.type &&
          JSON.stringify(o.fields) === JSON.stringify(c.fields),
      )
    ) {
      ops.push({ op: "add_constraint", type: c.type, fields: c.fields });
    }
  }

  if (ops.length === 0) {
    gaps.push({
      code: "no_patch_ops",
      message: "Nessuna operazione di patch riconosciuta",
      ask: "Usa «aggiungi/cambia/rimuovi …» oppure passa `patches` / `intent.assignments` / `intent.constraints`.",
    });
  }

  for (const op of ops) {
    switch (op.op) {
      case "add_class_split":
        ensureClassSplitOnDoc(doc, op.split, calendar.defaultNumberOfStudents ?? 20, applied);
        break;
      case "add_assignment":
        addAssignmentToDoc(doc, op.assignment, calendar as Required<Pick<CalendarDefaults, "minDaysWeight" | "minDays" | "consecutiveIfSameDay">>, applied);
        break;
      case "remove_assignment":
        removeMatchingActivities(doc, op.match, applied, skipped);
        break;
      case "change_assignment":
        changeMatchingAssignments(
          doc,
          op.match,
          op.set,
          calendar as Required<Pick<CalendarDefaults, "minDaysWeight" | "minDays" | "consecutiveIfSameDay">>,
          applied,
          skipped,
          gaps,
        );
        break;
      case "add_constraint": {
        const tpl = getPhraseTemplate(op.type);
        const fields = tpl ? tpl.fromStructured(op.fields) : op.fields;
        if (
          (op.type === "ConstraintBasicCompulsoryTime" ||
            op.type === "ConstraintBasicCompulsorySpace") &&
          doc.listConstraints({ type: op.type }).length > 0
        ) {
          skipped.push(`add_constraint skip duplicate ${op.type}`);
          break;
        }
        doc.addConstraint(op.type, fields);
        applied.push(`add_constraint: ${op.type}`);
        break;
      }
      case "remove_constraint": {
        const list = doc.listConstraints();
        const drop: Array<{ kind: "time" | "space" | "generation_option"; index: number }> = [];
        for (const c of list) {
          if (c.type !== op.type) continue;
          if (op.match?.commentsIncludes) {
            if (!String(c.fields.Comments ?? "").includes(op.match.commentsIncludes)) continue;
          }
          if (op.match?.activityIds?.length) {
            const raw = c.fields.Activity_Id;
            const ids = (Array.isArray(raw) ? raw : raw != null ? [raw] : []).map(Number);
            if (!op.match.activityIds.some((id) => ids.includes(id))) continue;
          }
          drop.push({ kind: c.kind, index: c.index });
        }
        for (const d of drop.sort((a, b) => b.index - a.index)) {
          doc.removeConstraint(d.kind, d.index);
        }
        applied.push(`remove_constraint: ${op.type} × ${drop.length}`);
        break;
      }
      default:
        skipped.push(`unknown op: ${JSON.stringify(op)}`);
    }
  }

  // Refresh comments marker
  const meta = doc.getMeta();
  if (!meta.comments.includes("fet_nl_patch")) {
    doc.setMeta({ comments: `${meta.comments}\nAggiornato con fet_nl_patch.`.trim() });
  }

  // Summarize mapping from current doc
  const teachers = doc.listEntities("teachers").map((e) => String(e.fields.Name));
  const subjects = doc.listEntities("subjects").map((e) => String(e.fields.Name));
  const activityIds = doc.listEntities("activities").map((e) => activityIdOf(e.fields));
  const years: string[] = [];
  const groups: string[] = [];
  const subgroups: string[] = [];
  for (const y of doc.listEntities("students")) {
    years.push(String(y.fields.Name));
    const gRaw = y.fields.Group;
    const gList = Array.isArray(gRaw) ? gRaw : gRaw ? [gRaw] : [];
    for (const g of gList as Record<string, unknown>[]) {
      groups.push(String(g.Name));
      const sRaw = g.Subgroup;
      const sList = Array.isArray(sRaw) ? sRaw : sRaw ? [sRaw] : [];
      for (const s of sList as Record<string, unknown>[]) {
        subgroups.push(String(s.Name));
      }
    }
  }

  return {
    intent: parse.intent,
    gaps,
    warnings: parse.warnings,
    notes: parse.notes,
    applied,
    skipped,
    mapping: {
      teachers,
      subjects,
      years,
      groups,
      subgroups,
      activityIds,
      splitGroups: [],
      parallelPairs: [],
      assumptions: [
        "Patch applicata sul documento workspace esistente (non rebuild completo).",
        ...applied.slice(0, 20),
      ],
      subgroupNames: {},
    },
    summary: doc.summarize(),
  };
}
