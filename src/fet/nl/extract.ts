/**
 * Extract a .fet / FetDocument into structured entities + Italian constraint descriptions.
 */

import type { FetDocument } from "../document.js";
import {
  describeConstraintInstance,
  getPhraseTemplate,
  PRIORITY_SAMPLE_TYPES,
  phraseCatalogSummary,
} from "./phrases/index.js";
import { asBool, asString, activityIdsOf } from "./phrases/helpers.js";
import type { NlAssignment, NlClassSplit, NlConstraintSpec } from "./types.js";

export interface ExtractedEntityCounts {
  days: number;
  hours: number;
  subjects: number;
  teachers: number;
  years: number;
  groups: number;
  subgroups: number;
  activities: number;
  buildings: number;
  rooms: number;
}

export interface ExtractedConstraint {
  kind: "time" | "space" | "generation_option";
  index: number;
  type: string;
  fields: Record<string, unknown>;
  italian: string;
  phraseStatus: "live" | "stub";
  active: boolean;
  /** True when PreferredStartingTime lock looks like a previous-solution artifact. */
  solutionLockArtifact?: boolean;
}

export interface ExtractResult {
  meta: {
    version?: string;
    mode?: string;
    institutionName?: string;
    comments?: string;
    path?: string;
  };
  entities: ExtractedEntityCounts;
  days: string[];
  hours: string[];
  teachers: string[];
  subjects: string[];
  rooms: Array<{ name: string; building?: string }>;
  studentsTree: Array<{
    year: string;
    groups: Array<{ name: string; subgroups: string[] }>;
  }>;
  classSplits: NlClassSplit[];
  assignments: NlAssignment[];
  constraints: ExtractedConstraint[];
  constraintsByType: Record<string, number>;
  /** Italian narrative suitable for LLM re-ingestion (may be long — truncated per type). */
  italianDigest: string[];
  coverage: {
    typesPresent: string[];
    sampleTypes: string[];
    sampleTypesCoveredLive: string[];
    sampleTypesMissingLive: string[];
    phraseCatalog: ReturnType<typeof phraseCatalogSummary>;
    allPresentTypesLive: boolean;
  };
  notes: string[];
}

function flattenStudents(doc: FetDocument): ExtractResult["studentsTree"] {
  const tree: ExtractResult["studentsTree"] = [];
  for (const y of doc.listEntities("students")) {
    const year = asString(y.fields.Name);
    const groups: Array<{ name: string; subgroups: string[] }> = [];
    const gRaw = y.fields.Group;
    const gList = Array.isArray(gRaw) ? gRaw : gRaw ? [gRaw] : [];
    for (const g of gList as Record<string, unknown>[]) {
      const name = asString(g.Name);
      const sRaw = g.Subgroup;
      const sList = Array.isArray(sRaw) ? sRaw : sRaw ? [sRaw] : [];
      const subgroups = (sList as Record<string, unknown>[]).map((s) => asString(s.Name));
      groups.push({ name, subgroups });
    }
    tree.push({ year, groups });
  }
  return tree;
}

function classSplitsFromTree(tree: ExtractResult["studentsTree"]): NlClassSplit[] {
  const out: NlClassSplit[] = [];
  for (const y of tree) {
    for (const g of y.groups) {
      if (g.subgroups.length >= 2) {
        const shorts = g.subgroups.map((s) => {
          const prefix = `${g.name}-`;
          return s.startsWith(prefix) ? s.slice(prefix.length) : s;
        });
        out.push({
          group: g.name,
          year: y.year,
          subgroups: shorts,
          parallel: true,
          source: "extract",
        });
      }
    }
  }
  return out;
}

function assignmentsFromActivities(doc: FetDocument): NlAssignment[] {
  /** Collapse split components (same Activity_Group_Id > 0) into one assignment. */
  type Acc = {
    teacher: string;
    subject: string;
    students: string;
    hours: number;
    split: number[];
    ids: number[];
  };
  const byGroup = new Map<string, Acc>();
  const singles: NlAssignment[] = [];

  for (const a of doc.listEntities("activities")) {
    const id = Number(a.fields.Id ?? 0);
    const teacher = Array.isArray(a.fields.Teacher)
      ? asString(a.fields.Teacher[0])
      : asString(a.fields.Teacher);
    const subject = asString(a.fields.Subject);
    const students = Array.isArray(a.fields.Students)
      ? asString(a.fields.Students[0])
      : asString(a.fields.Students);
    const duration = Number(a.fields.Duration ?? 1);
    const gid = Number(a.fields.Activity_Group_Id ?? 0);
    if (gid > 0) {
      const key = `g:${gid}`;
      const acc = byGroup.get(key) ?? {
        teacher,
        subject,
        students,
        hours: 0,
        split: [],
        ids: [],
      };
      acc.hours += duration;
      acc.split.push(duration);
      acc.ids.push(id);
      byGroup.set(key, acc);
    } else {
      singles.push({
        teacher,
        subject,
        students,
        hoursPerWeek: duration,
        split: [duration],
        source: `activity:${id}`,
        key: `a:${id}`,
      });
    }
  }

  const grouped: NlAssignment[] = [...byGroup.values()].map((acc) => ({
    teacher: acc.teacher,
    subject: acc.subject,
    students: acc.students,
    hoursPerWeek: acc.hours,
    split: acc.split,
    source: `activityGroup:${acc.ids.join("+")}`,
    key: `ag:${acc.ids[0]}`,
  }));

  return [...grouped, ...singles];
}

export function extractFromDocument(doc: FetDocument): ExtractResult {
  const summary = doc.summarize();
  const meta = doc.getMeta();
  const studentsTree = flattenStudents(doc);
  const classSplits = classSplitsFromTree(studentsTree);
  const assignments = assignmentsFromActivities(doc);

  let groups = 0;
  let subgroups = 0;
  for (const y of studentsTree) {
    groups += y.groups.length;
    for (const g of y.groups) subgroups += g.subgroups.length;
  }

  const constraints: ExtractedConstraint[] = [];
  const constraintsByType: Record<string, number> = {};
  const italianDigest: string[] = [];
  const perTypeShown = new Map<string, number>();

  for (const c of doc.listConstraints()) {
    const desc = describeConstraintInstance(c.type, c.fields);
    const active = asBool(c.fields.Active, true);
    const permanentlyLocked = asBool(c.fields.Permanently_Locked, false);
    const solutionLockArtifact =
      c.type === "ConstraintActivityPreferredStartingTime" &&
      permanentlyLocked &&
      !active;

    const item: ExtractedConstraint = {
      kind: c.kind,
      index: c.index,
      type: c.type,
      fields: c.fields,
      italian: desc.italian,
      phraseStatus: desc.status,
      active,
      solutionLockArtifact: solutionLockArtifact || undefined,
    };
    constraints.push(item);
    constraintsByType[c.type] = (constraintsByType[c.type] ?? 0) + 1;

    const shown = perTypeShown.get(c.type) ?? 0;
    if (shown < 3) {
      italianDigest.push(desc.italian);
      perTypeShown.set(c.type, shown + 1);
    } else if (shown === 3) {
      italianDigest.push(`… ulteriori istanze di ${c.type} omesse nel digest.`);
      perTypeShown.set(c.type, 4);
    }
  }

  const typesPresent = Object.keys(constraintsByType).sort();
  const sampleTypes = [...PRIORITY_SAMPLE_TYPES];
  const sampleTypesCoveredLive = sampleTypes.filter(
    (t) => getPhraseTemplate(t)?.status === "live",
  );
  const sampleTypesMissingLive = sampleTypes.filter(
    (t) => getPhraseTemplate(t)?.status !== "live",
  );
  const presentMissingLive = typesPresent.filter((t) => getPhraseTemplate(t)?.status !== "live");

  const notes: string[] = [];
  const inactiveLocks = constraints.filter((c) => c.solutionLockArtifact).length;
  if (inactiveLocks > 0) {
    notes.push(
      `${inactiveLocks} ConstraintActivityPreferredStartingTime con Permanently_Locked=true e Active=false (artefatti di soluzione precedente): FET li ignora in generazione; in NL sono descritti come lock inattivi.`,
    );
  }
  if (presentMissingLive.length) {
    notes.push(`Tipi presenti senza handler live: ${presentMissingLive.join(", ")}`);
  } else {
    notes.push("Tutti i tipi di vincolo presenti nel documento hanno phrase handler live.");
  }

  return {
    meta: {
      version: meta.version,
      mode: meta.mode,
      institutionName: meta.institutionName,
      comments: meta.comments,
      path: summary.path,
    },
    entities: {
      days: summary.counts.days ?? 0,
      hours: summary.counts.hours ?? 0,
      subjects: summary.counts.subjects ?? 0,
      teachers: summary.counts.teachers ?? 0,
      years: studentsTree.length,
      groups,
      subgroups,
      activities: summary.counts.activities ?? 0,
      buildings: summary.counts.buildings ?? 0,
      rooms: summary.counts.rooms ?? 0,
    },
    days: doc.listEntities("days").map((d) => asString(d.fields.Name)),
    hours: doc.listEntities("hours").map((h) => asString(h.fields.Name)),
    teachers: doc.listEntities("teachers").map((t) => asString(t.fields.Name)),
    subjects: doc.listEntities("subjects").map((s) => asString(s.fields.Name)),
    rooms: doc.listEntities("rooms").map((r) => ({
      name: asString(r.fields.Name),
      building: r.fields.Building ? asString(r.fields.Building) : undefined,
    })),
    studentsTree,
    classSplits,
    assignments,
    constraints,
    constraintsByType,
    italianDigest,
    coverage: {
      typesPresent,
      sampleTypes,
      sampleTypesCoveredLive,
      sampleTypesMissingLive,
      phraseCatalog: phraseCatalogSummary(),
      allPresentTypesLive: presentMissingLive.length === 0,
    },
    notes,
  };
}

/** Convert extracted constraints to NlConstraintSpec list (for rebuild/patch). */
export function constraintsToNlSpecs(
  constraints: ExtractedConstraint[],
  opts?: { includeInactive?: boolean; types?: string[]; limitPerType?: number },
): NlConstraintSpec[] {
  const includeInactive = opts?.includeInactive ?? true;
  const limit = opts?.limitPerType ?? Infinity;
  const typeFilter = opts?.types ? new Set(opts.types) : null;
  const counts = new Map<string, number>();
  const out: NlConstraintSpec[] = [];
  for (const c of constraints) {
    if (!includeInactive && !c.active) continue;
    if (typeFilter && !typeFilter.has(c.type)) continue;
    const n = counts.get(c.type) ?? 0;
    if (n >= limit) continue;
    counts.set(c.type, n + 1);
    out.push({
      type: c.type,
      fields: c.fields,
      italian: c.italian,
      source: `extract:${c.kind}:${c.index}`,
    });
  }
  return out;
}

/** One-line summary helper for activity id lists in digests. */
export function summarizeActivityIds(fields: Record<string, unknown>): string {
  return activityIdsOf(fields).join(",");
}
