import { FetDocument } from "./document.js";

export interface FetSummary {
  path: string;
  bytes: number;
  institutionName?: string;
  comments?: string;
  mode?: string;
  version?: string;
  days?: string[];
  hours?: string[];
  teachersCount?: number;
  studentsYearsCount?: number;
  subjectsCount?: number;
  activitiesCount?: number;
  roomsCount?: number;
  buildingsCount?: number;
  activityTagsCount?: number;
  timeConstraintsCount?: number;
  spaceConstraintsCount?: number;
  timeConstraintsByType?: Record<string, number>;
  spaceConstraintsByType?: Record<string, number>;
  generationOptions?: number;
}

/**
 * Structured .fet XML summary using the round-trip document model.
 */
export function summarizeFetFile(filePath: string): FetSummary {
  const doc = FetDocument.loadFile(filePath);
  const summary = doc.summarize();
  const days = doc.listEntities("days").map((d) => String((d.fields as { Name?: string }).Name ?? ""));
  const hours = doc.listEntities("hours").map((h) => String((h.fields as { Name?: string }).Name ?? ""));
  const raw = doc.toXml();
  return {
    path: filePath,
    bytes: Buffer.byteLength(raw, "utf8"),
    institutionName: summary.institutionName,
    comments: summary.comments,
    mode: summary.mode,
    version: summary.version,
    days,
    hours,
    teachersCount: summary.counts.teachers,
    studentsYearsCount: summary.counts.students,
    subjectsCount: summary.counts.subjects,
    activitiesCount: summary.counts.activities,
    roomsCount: summary.counts.rooms,
    buildingsCount: summary.counts.buildings,
    activityTagsCount: summary.counts.activity_tags,
    timeConstraintsCount: Object.values(summary.timeConstraintsByType).reduce((a, b) => a + b, 0),
    spaceConstraintsCount: Object.values(summary.spaceConstraintsByType).reduce((a, b) => a + b, 0),
    timeConstraintsByType: summary.timeConstraintsByType,
    spaceConstraintsByType: summary.spaceConstraintsByType,
    generationOptions: summary.generationOptions,
  };
}
