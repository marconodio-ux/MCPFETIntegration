/**
 * Natural-language → FET intent model (MFI-8).
 * The LLM client stays the conversation layer; these structures are what our tools emit/accept.
 */

import type { CalendarDefaults } from "../assignments/types.js";

export type { CalendarDefaults };

/** Clarifying gap returned instead of silent wrong assumptions. */
export interface NlGap {
  code: string;
  message: string;
  /** Suggested clarifying question for the LLM to ask the user. */
  ask: string;
  /** Optional entity hints (teacher / class / subject). */
  about?: Record<string, string>;
  raw?: string;
}

export interface NlWarning {
  code: string;
  message: string;
  raw?: string;
}

/** One teaching assignment targeting a FET students-set name (Year/Group/Subgroup). */
export interface NlAssignment {
  teacher: string;
  subject: string;
  /** Exact FET Students set name (e.g. P1A, P1A-meccanica, P1). */
  students: string;
  hoursPerWeek: number;
  split?: number[];
  tags?: string[];
  source?: string;
  /** Stable key for patch matching (optional). */
  key?: string;
}

/** Class divided into subgroups (e.g. P1A → meccanica | elettro). */
export interface NlClassSplit {
  /** Group label as spoken (e.g. P1A). */
  group: string;
  /** Year key (e.g. P1); inferred from group when omitted. */
  year?: string;
  /** Short subgroup labels (e.g. meccanica, elettro). */
  subgroups: string[];
  /**
   * When true (default), parallel subgroup activities with comparable duration
   * get ConstraintActivitiesSameStartingTime so the class splits in the same slot.
   */
  parallel?: boolean;
  source?: string;
}

export interface NlStudentTree {
  year: string;
  groups: Array<{
    name: string;
    subgroups: string[];
  }>;
}

/** One FET constraint expressed from NL / extract (MFI-9). */
export interface NlConstraintSpec {
  type: string;
  fields: Record<string, unknown>;
  /** Original Italian phrase when available. */
  italian?: string;
  source?: string;
}

export type NlPatchOp =
  | {
      op: "add_assignment";
      assignment: NlAssignment;
    }
  | {
      op: "change_assignment";
      /** Match by teacher+subject+students, or activity key, or activity ids. */
      match: {
        teacher?: string;
        subject?: string;
        students?: string;
        key?: string;
        activityIds?: number[];
      };
      set: Partial<Pick<NlAssignment, "teacher" | "subject" | "students" | "hoursPerWeek" | "split" | "tags">>;
    }
  | {
      op: "remove_assignment";
      match: {
        teacher?: string;
        subject?: string;
        students?: string;
        key?: string;
        activityIds?: number[];
      };
    }
  | {
      op: "add_class_split";
      split: NlClassSplit;
    }
  | {
      op: "add_constraint";
      type: string;
      fields: Record<string, unknown>;
    }
  | {
      op: "remove_constraint";
      type: string;
      /** Optional Comments substring / Activity_Id filter. */
      match?: { commentsIncludes?: string; activityIds?: number[] };
    };

/** Structured intent (from parser and/or LLM client). */
export interface NlIntent {
  institutionName?: string;
  comments?: string;
  calendar?: CalendarDefaults;
  assignments: NlAssignment[];
  classSplits: NlClassSplit[];
  /** Explicit student tree overrides (otherwise derived from assignments + splits). */
  studentsTree?: NlStudentTree[];
  /** Constraints from Italian phrases / structured LLM / extract. */
  constraints?: NlConstraintSpec[];
  patches?: NlPatchOp[];
}

export interface NlParseResult {
  intent: NlIntent;
  gaps: NlGap[];
  warnings: NlWarning[];
  /** Human-readable mapping notes for the LLM. */
  notes: string[];
}

export interface NlBuildOptions {
  calendar?: CalendarDefaults;
  /** If true, skip building when gaps.length > 0 (default false = best-effort). */
  strictGaps?: boolean;
  documentId?: string;
  savePath?: string;
  /**
   * When true (default), emit SameStartingTime for parallel class-split pairs
   * whose component durations align.
   */
  parallelSameStartingTime?: boolean;
  /** Weight for MinDaysBetweenActivities on weekly splits (default 95). */
  minDaysWeight?: number;
}

export interface NlBuildMapping {
  teachers: string[];
  subjects: string[];
  years: string[];
  groups: string[];
  subgroups: string[];
  activityIds: number[];
  splitGroups: Array<{ activityGroupId: number; activityIds: number[]; split: number[] }>;
  parallelPairs: Array<{
    group: string;
    activityIdsA: number[];
    activityIdsB: number[];
    constraint: "ConstraintActivitiesSameStartingTime";
  }>;
  assumptions: string[];
  /** Map short subgroup label → FET unique Subgroup name. */
  subgroupNames: Record<string, string>;
}

export interface NlBuildResult {
  intent: NlIntent;
  gaps: NlGap[];
  warnings: NlWarning[];
  notes: string[];
  mapping: NlBuildMapping;
  summary: unknown;
  documentId?: string;
  savedPath?: string;
}

export interface NlPatchResult extends NlBuildResult {
  applied: string[];
  skipped: string[];
}
