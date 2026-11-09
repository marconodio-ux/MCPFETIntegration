/**
 * NL phrase templates for FET constraint types (MFI-11).
 * All 358 catalog types are "live" (schema-driven); Orario sample types
 * keep hand-tuned Italian overlays in sampleLive.ts.
 */

import type { ConstraintKind } from "../../catalog.js";

export type PhraseStatus = "live" | "stub";

export interface PhraseParseResult {
  fields: Record<string, unknown>;
  /** 0–1 heuristic confidence */
  confidence: number;
  notes?: string[];
}

export interface PhraseTemplate {
  type: string;
  kind: ConstraintKind;
  status: PhraseStatus;
  descriptionIt: string;
  family?: string;
  mode?: string;
  /** Example Italian phrases (for LLM / docs). */
  examplesIt: string[];
  /** Human Italian description from FET fields. */
  describe(fields: Record<string, unknown>): string;
  /**
   * Parse free-form Italian into constraint fields.
   * Stubs return null (structured `fields` / catalog tools still work).
   */
  parseIt(text: string): PhraseParseResult | null;
  /** Normalize structured input (LLM JSON) into FET fields. */
  fromStructured(input: Record<string, unknown>): Record<string, unknown>;
}

export interface PhraseCatalogSummary {
  total: number;
  live: number;
  stub: number;
  sampleTypes: string[];
  sampleLive: number;
  sampleMissing: string[];
}

/** Priority constraint types with hand-tuned overlays — must stay 100% live. */
export const PRIORITY_SAMPLE_TYPES = [
  "ConstraintBasicCompulsoryTime",
  "ConstraintBreakTimes",
  "ConstraintActivitiesSameStartingTime",
  "ConstraintStudentsSetNotAvailableTimes",
  "ConstraintTeacherNotAvailableTimes",
  "ConstraintMinDaysBetweenActivities",
  "ConstraintTeachersMaxHoursDaily",
  "ConstraintTwoActivitiesConsecutive",
  "ConstraintActivityPreferredStartingTime",
  "ConstraintActivityPreferredStartingTimes",
  "ConstraintTeacherMaxHoursDaily",
  "ConstraintBasicCompulsorySpace",
  "ConstraintSubjectPreferredRoom",
  "ConstraintSubjectPreferredRooms",
  "ConstraintRoomNotAvailableTimes",
  "ConstraintActivityPreferredRoom",
] as const;

export type PrioritySampleType = (typeof PRIORITY_SAMPLE_TYPES)[number];
