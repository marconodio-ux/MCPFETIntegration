/**
 * Structured teacher-assignment model used by text→.fet generation (MFI-4).
 */

export interface CalendarDefaults {
  /** Day names in FET order (default: Italian Lun–Ven). */
  days?: string[];
  /** Hour slot names (default: 08:00…13:00). */
  hours?: string[];
  institutionName?: string;
  comments?: string;
  mode?: "Official" | "Mornings_Afternoons" | "Block_Planning" | "Terms";
  /** Default students count when class size is unknown. */
  defaultNumberOfStudents?: number;
  /**
   * Weight for ConstraintMinDaysBetweenActivities on splits (default 95).
   * Use 100 for hard, lower for soft.
   */
  minDaysWeight?: number;
  /** MinDays value (default 1). */
  minDays?: number;
  /** Consecutive_If_Same_Day for MinDays constraints (default true). */
  consecutiveIfSameDay?: boolean;
}

/** One teaching assignment: teacher + subject + class + weekly hours (+ optional split). */
export interface AssignmentRow {
  teacher: string;
  subject: string;
  /** Class / group label as it should appear in FET Students (e.g. "1A"). */
  students: string;
  hoursPerWeek: number;
  /** Explicit split durations summing to hoursPerWeek; if omitted, a default pattern is used. */
  split?: number[];
  /** Optional activity tags (e.g. lab). */
  tags?: string[];
  /** Source line / note for Comments. */
  source?: string;
}

export interface Ambiguity {
  code: string;
  message: string;
  line?: number;
  raw?: string;
  /** Suggested clarifying question for the user. */
  ask: string;
}

export interface ParseWarning {
  code: string;
  message: string;
  line?: number;
  raw?: string;
}

export interface ParseResult {
  assignments: AssignmentRow[];
  ambiguities: Ambiguity[];
  warnings: ParseWarning[];
  /** Non-assignment header hints scraped from text (institution, days…). */
  calendarHints: Partial<CalendarDefaults>;
}

export interface BuildOptions {
  calendar?: CalendarDefaults;
  /** If true, refuse to build when ambiguities.length > 0 (default false: build best-effort). */
  strictAmbiguities?: boolean;
  documentId?: string;
  /** Optional absolute or workspace-relative save path. */
  savePath?: string;
}

export interface BuildResult {
  assignments: AssignmentRow[];
  ambiguities: Ambiguity[];
  warnings: ParseWarning[];
  mapping: {
    teachers: string[];
    subjects: string[];
    classes: string[];
    activityIds: number[];
    splitGroups: Array<{ activityGroupId: number; activityIds: number[]; split: number[] }>;
    assumptions: string[];
  };
  summary: unknown;
  documentId?: string;
  savedPath?: string;
}
