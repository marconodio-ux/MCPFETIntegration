/** Diagnostic finding for a blocking or suspicious timetable element. */
export interface DiagnoseBlocker {
  /** Stable machine code (e.g. teacher_no_slot, mindays_overflow). */
  code: string;
  severity: "error" | "warning" | "info";
  /** Short Italian title for the user. */
  titleIt: string;
  /** Italian explanation of what blocks generation. */
  detailIt: string;
  /** Italian suggestion on how to fix it. */
  suggestedFixIt: string;
  /** Related FET catalog constraint type tags when known. */
  constraintTypes?: string[];
  /** Related entities (teacher/class/room names, etc.). */
  entities?: Array<{ kind: string; name?: string; id?: string | number }>;
  activityIds?: number[];
  source: "static" | "fet_log" | "fet_stdout" | "fet_result" | "fet_difficult";
  /** Raw evidence snippet (log line, heuristic numbers). */
  evidence?: string;
  confidence: "high" | "medium" | "low";
}

export interface FetLogArtifacts {
  outputDir?: string;
  resultTxt?: string;
  errorsTxt?: string;
  warningsTxt?: string;
  difficultActivitiesTxt?: string;
  initialOrderTxt?: string;
  maxPlacedTxt?: string;
  stdout?: string;
  stderr?: string;
  pathsFound: string[];
}

export type FetOutcome =
  | "succeeded"
  | "failed"
  | "impossible"
  | "precompute_failed"
  | "structure_failed"
  | "time_exceeded"
  | "interrupted"
  | "skipped"
  | "unknown";

export interface DiagnoseResult {
  ok: boolean;
  inputFile?: string;
  documentId?: string;
  jobId?: string;
  fetClAvailable: boolean;
  ranFet: boolean;
  fetOutcome: FetOutcome;
  exitCode?: number | null;
  blockers: DiagnoseBlocker[];
  /** Honest limits when FET only reports a generic Impossible. */
  limits: string[];
  logsInspected: string[];
  summaryIt: string;
}
