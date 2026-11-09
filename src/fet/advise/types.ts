/**
 * Intelligent FET constraint advisor — suggestion + apply contracts.
 * Advisor proposes; FET still generates the timetable.
 */

export type AdviseConfidence = "high" | "medium" | "low";

export interface AdviseSuggestion {
  /** Stable id within an advise session (e.g. mindays-1, sst-2). */
  id: string;
  /** Real FET catalog type tag only (Constraint…). */
  type: string;
  kind: "time" | "space" | "generation_option";
  confidence: AdviseConfidence;
  /** Short Italian title for the LLM / user. */
  titleIt: string;
  /** Why this constraint helps (Italian). */
  rationaleIt: string;
  /** How the timetable improves if applied (Italian). */
  improvesIt: string;
  /** Draft XML fields ready for fet_constraint_add / apply. */
  fieldsDraft: Record<string, unknown>;
  /** Heuristic code (machine). */
  code: string;
  /** Related entities for the LLM. */
  entities?: Array<{ kind: string; name?: string; id?: string | number }>;
  activityIds?: number[];
  /** True when apply also creates missing rooms/subjects referenced in fieldsDraft. */
  createsEntities?: Array<{ kind: "rooms" | "subjects" | "activity_tags"; name: string }>;
  /** Soft warning before apply (e.g. room name guessed). */
  cautionIt?: string;
}

export interface AdviseResult {
  ok: true;
  /** Session id for fet_advise_apply. */
  adviseId: string;
  documentId?: string;
  inputFile?: string;
  /** Ranked suggestions (high → low, then by catalog usefulness). */
  suggestions: AdviseSuggestion[];
  summaryIt: string;
  /** Reminder for LLM clients. */
  noticeIt: string;
  analyzed: {
    activities: number;
    teachers: number;
    subjects: number;
    rooms: number;
    timeConstraints: number;
    spaceConstraints: number;
    intentHints: string[];
  };
}

export interface AdviseApplyResult {
  ok: true;
  adviseId: string;
  documentId: string;
  applied: Array<{ id: string; type: string; index: number }>;
  skipped: Array<{ id: string; reason: string }>;
  createdEntities: Array<{ kind: string; name: string }>;
  summaryIt: string;
  noticeIt: string;
}

export interface AdviseOptions {
  /** Free-form Italian / intent text that may name rooms, breaks, unavailability. */
  text?: string;
  /** Max suggestions to return (default 25). */
  limit?: number;
  /** Only these confidence levels (default all). */
  minConfidence?: AdviseConfidence;
}
