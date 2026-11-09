/**
 * Smoke: Antonio NL example → parse gaps + build coherent .fet from completed text.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load(relBuild, relSrc) {
  const b = path.join(root, "build", relBuild);
  const s = path.join(root, "src", relSrc);
  return import(pathToFileURL(fs.existsSync(b) ? b : s).href);
}

const nl = await load("fet/nl/index.js", "fet/nl/index.ts");
const { FetDocument } = await load("fet/document.js", "fet/document.ts");

const rawPath = path.join(root, "examples", "from-nl", "antonio-orario.txt");
const completePath = path.join(root, "examples", "from-nl", "antonio-orario-completo.txt");
const outPath = path.join(root, "examples", "from-nl", "antonio-from-nl.fet");
const summaryPath = path.join(root, "examples", "from-nl", "antonio-from-nl.summary.json");

const raw = fs.readFileSync(rawPath, "utf8");
const complete = fs.readFileSync(completePath, "utf8");

const rawParse = nl.parseNlText(raw);
const { doc, result } = nl.generateFetFromNl(complete, undefined, {
  parallelSameStartingTime: true,
});
doc.saveFile(outPath);

const reloaded = FetDocument.loadFile(outPath);
const summary = reloaded.summarize();

const years = reloaded.listEntities("students");
const subgroupNames = [];
for (const y of years) {
  const gRaw = y.fields.Group;
  const gList = Array.isArray(gRaw) ? gRaw : gRaw ? [gRaw] : [];
  for (const g of gList) {
    const sRaw = g.Subgroup;
    const sList = Array.isArray(sRaw) ? sRaw : sRaw ? [sRaw] : [];
    for (const s of sList) subgroupNames.push(String(s.Name));
  }
}

const activities = reloaded.listEntities("activities").map((e) => ({
  id: e.fields.Id,
  teacher: e.fields.Teacher,
  subject: e.fields.Subject,
  students: e.fields.Students,
  duration: e.fields.Duration,
  groupId: e.fields.Activity_Group_Id,
}));

const report = {
  ok: true,
  rawGaps: rawParse.gaps.map((g) => ({ code: g.code, ask: g.ask })),
  saved: outPath,
  mapping: result.mapping,
  gaps: result.gaps.map((g) => ({ code: g.code, ask: g.ask })),
  warnings: result.warnings,
  summary,
  subgroupNames,
  activitySample: activities.slice(0, 12),
  teachers: result.mapping.teachers,
  parallelPairs: result.mapping.parallelPairs.length,
  timeConstraints: summary.timeConstraintsByType,
};

const needSubs = ["P1A-meccanica", "P1A-elettro"];
for (const s of needSubs) {
  if (!subgroupNames.includes(s)) {
    report.ok = false;
    report.error = `Missing subgroup ${s}; got ${subgroupNames.join(", ")}`;
  }
}
if (!summary.counts.teachers || summary.counts.teachers < 3) {
  report.ok = false;
  report.error = `Expected ≥3 teachers, got ${summary.counts.teachers}`;
}
if (!summary.counts.activities || summary.counts.activities < 3) {
  report.ok = false;
  report.error = `Expected activities, got ${summary.counts.activities}`;
}
if (!(summary.timeConstraintsByType?.ConstraintActivitiesSameStartingTime > 0)) {
  report.ok = false;
  report.error = "Expected ConstraintActivitiesSameStartingTime for parallel split";
}
if (!(summary.timeConstraintsByType?.ConstraintMinDaysBetweenActivities > 0)) {
  report.ok = false;
  report.error = "Expected ConstraintMinDaysBetweenActivities on weekly splits";
}

// Raw example should surface clarifying gaps (product contract)
const rawCodes = new Set(rawParse.gaps.map((g) => g.code));
if (![...rawCodes].some((c) => /year_without_section|split_teacher_incomplete|missing_hours/.test(c))) {
  report.ok = false;
  report.error = `Raw Antonio text should yield clarifying gaps; got ${[...rawCodes].join(",") || "(none)"}`;
}

fs.writeFileSync(summaryPath, JSON.stringify(report, null, 2), "utf8");

if (!report.ok) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
