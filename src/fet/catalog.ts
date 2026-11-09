import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FET_VERSION, PROJECT_ROOT } from "../config.js";

export type ConstraintKind = "time" | "space" | "generation_option";

export interface ConstraintSchemaHint {
  fields: string[];
  containers: string[];
  allTags: string[];
  note?: string;
}

export interface ConstraintTypeInfo {
  type: string;
  kind: ConstraintKind;
  descriptionIt?: string;
  mode?: string;
  family?: string;
  schema: ConstraintSchemaHint;
}

export interface ConstraintCatalog {
  fetVersion: string;
  generatedFrom: string[];
  counts: {
    time: number;
    space: number;
    generationOptions: number;
    total: number;
  };
  types: ConstraintTypeInfo[];
}

let cached: ConstraintCatalog | null = null;
let byType: Map<string, ConstraintTypeInfo> | null = null;

function resolveCatalogPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "catalog", "constraint-catalog.json"),
    path.join(PROJECT_ROOT, "src", "fet", "catalog", "constraint-catalog.json"),
    path.join(PROJECT_ROOT, "build", "fet", "catalog", "constraint-catalog.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `constraint-catalog.json not found. Run: node scripts/generate-constraint-catalog.mjs (looked in ${candidates.join(", ")})`,
  );
}

export function loadConstraintCatalog(): ConstraintCatalog {
  if (cached) return cached;
  const raw = JSON.parse(fs.readFileSync(resolveCatalogPath(), "utf8")) as ConstraintCatalog;
  cached = raw;
  byType = new Map(raw.types.map((t) => [t.type, t]));
  return raw;
}

export function getConstraintType(type: string): ConstraintTypeInfo | undefined {
  loadConstraintCatalog();
  return byType!.get(type);
}

export function listConstraintTypes(filter?: {
  kind?: ConstraintKind;
  mode?: string;
  q?: string;
}): ConstraintTypeInfo[] {
  const cat = loadConstraintCatalog();
  const q = filter?.q?.toLowerCase();
  return cat.types.filter((t) => {
    if (filter?.kind && t.kind !== filter.kind) return false;
    if (filter?.mode && t.mode && t.mode !== filter.mode && t.mode !== "tutti") return false;
    if (q) {
      const hay = `${t.type} ${t.descriptionIt ?? ""} ${t.family ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function catalogCounts() {
  return loadConstraintCatalog().counts;
}

export function expectedFetVersion(): string {
  return loadConstraintCatalog().fetVersion || FET_VERSION;
}

/** Entity kinds exposed via meta-tools (model structures, not the 357 constraints). */
export const ENTITY_KINDS = [
  "days",
  "hours",
  "real_days",
  "real_hours",
  "subjects",
  "activity_tags",
  "teachers",
  "students",
  "activities",
  "buildings",
  "rooms",
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ENTITY_LIST_TAGS: Record<EntityKind, { listTag: string; itemTag: string; countTag?: string }> = {
  days: { listTag: "Days_List", itemTag: "Day", countTag: "Number_of_Days" },
  hours: { listTag: "Hours_List", itemTag: "Hour", countTag: "Number_of_Hours" },
  real_days: { listTag: "Real_Days_List", itemTag: "Real_Day", countTag: "Number_of_Real_Days" },
  real_hours: { listTag: "Real_Hours_List", itemTag: "Real_Hour", countTag: "Number_of_Real_Hours" },
  subjects: { listTag: "Subjects_List", itemTag: "Subject" },
  activity_tags: { listTag: "Activity_Tags_List", itemTag: "Activity_Tag" },
  teachers: { listTag: "Teachers_List", itemTag: "Teacher" },
  students: { listTag: "Students_List", itemTag: "Year" },
  activities: { listTag: "Activities_List", itemTag: "Activity" },
  buildings: { listTag: "Buildings_List", itemTag: "Building" },
  rooms: { listTag: "Rooms_List", itemTag: "Room" },
};

export function isEntityKind(value: string): value is EntityKind {
  return (ENTITY_KINDS as readonly string[]).includes(value);
}
