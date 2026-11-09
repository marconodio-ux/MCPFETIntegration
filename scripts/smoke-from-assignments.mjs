/**
 * Smoke: parse sample incarichi → build .fet → reload + summarize.
 * Run: node --import tsx scripts/smoke-from-assignments.mjs
 * Or after build: node scripts/smoke-from-assignments.mjs (uses build/ if present)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildEntry = path.join(root, "build", "fet", "assignments", "index.js");
const srcEntry = path.join(root, "src", "fet", "assignments", "index.ts");

async function loadApi() {
  if (fs.existsSync(buildEntry)) {
    return import(pathToFileURL(buildEntry).href);
  }
  return import(pathToFileURL(srcEntry).href);
}

const { generateFetFromAssignments } = await loadApi();
const { FetDocument } = await (async () => {
  const p = fs.existsSync(path.join(root, "build", "fet", "document.js"))
    ? path.join(root, "build", "fet", "document.js")
    : path.join(root, "src", "fet", "document.ts");
  return import(pathToFileURL(p).href);
})();

const textPath = path.join(root, "examples", "from-assignments", "sample-incarichi.txt");
const outPath = path.join(root, "examples", "from-assignments", "sample-from-assignments.fet");
const text = fs.readFileSync(textPath, "utf8");

const { doc, result } = generateFetFromAssignments(text);
doc.saveFile(outPath);

const reloaded = FetDocument.loadFile(outPath);
const summary = reloaded.summarize();

const report = {
  ok: true,
  saved: outPath,
  ambiguities: result.ambiguities,
  warnings: result.warnings,
  mapping: {
    teachers: result.mapping.teachers,
    subjects: result.mapping.subjects,
    classes: result.mapping.classes,
    activities: result.mapping.activityIds.length,
    splitGroups: result.mapping.splitGroups.length,
  },
  summary,
  reloadedCounts: summary.counts,
};

if (!summary.counts.teachers || !summary.counts.activities) {
  report.ok = false;
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(report, null, 2));
