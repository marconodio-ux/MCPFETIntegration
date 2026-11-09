/**
 * Smoke MFI-12: stripped Antonio NL sample → fet_advise suggests
 * SameStartingTime / MinDays / PreferredRoom; apply → valid .fet.
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
const advise = await load("fet/advise/index.js", "fet/advise/index.ts");
const { putDocument, makeDocId } = await load("fet/workspace.js", "fet/workspace.ts");

const completePath = path.join(root, "examples", "from-nl", "antonio-orario-completo.txt");
const outDir = path.join(root, "examples", "advise");
const strippedPath = path.join(outDir, "antonio-stripped-for-advise.fet");
const advisedPath = path.join(outDir, "antonio-advised.fet");
const summaryPath = path.join(outDir, "antonio-advised.summary.json");

fs.mkdirSync(outDir, { recursive: true });

const complete = fs.readFileSync(completePath, "utf8");

// Build WITHOUT parallel SameStartingTime; then strip MinDays → "bare" schedule.
const { doc } = nl.generateFetFromNl(complete, undefined, {
  parallelSameStartingTime: false,
});

function removeConstraintsByType(document, type) {
  // remove from end to keep indices stable
  for (;;) {
    const list = document.listConstraints({ type });
    if (!list.length) break;
    const last = list[list.length - 1];
    document.removeConstraint(last.kind, last.index);
  }
}

removeConstraintsByType(doc, "ConstraintMinDaysBetweenActivities");
removeConstraintsByType(doc, "ConstraintActivitiesSameStartingTime");
// Ensure no rooms / space prefs (already empty on NL build)
removeConstraintsByType(doc, "ConstraintSubjectPreferredRoom");
removeConstraintsByType(doc, "ConstraintSubjectPreferredRooms");
removeConstraintsByType(doc, "ConstraintActivityPreferredRoom");

doc.saveFile(strippedPath);

const documentId = makeDocId("antonio-advise-smoke");
putDocument(documentId, doc);

const intentBoost = `${complete}\nLaboratori in aula dedicata. Max 5 ore al giorno per i docenti.`;

const advice = advise.adviseTimetable({
  documentId,
  text: intentBoost,
  limit: 40,
});

const types = new Set(advice.suggestions.map((s) => s.type));
const codes = new Set(advice.suggestions.map((s) => s.code));

const report = {
  ok: true,
  adviseId: advice.adviseId,
  documentId,
  stripped: strippedPath,
  suggestionCount: advice.suggestions.length,
  types: [...types].sort(),
  codes: [...codes].sort(),
  high: advice.suggestions.filter((s) => s.confidence === "high").map((s) => ({
    id: s.id,
    type: s.type,
    code: s.code,
    titleIt: s.titleIt,
  })),
  summaryIt: advice.summaryIt,
};

const needTypes = [
  "ConstraintMinDaysBetweenActivities",
  "ConstraintActivitiesSameStartingTime",
  "ConstraintSubjectPreferredRoom",
];
for (const t of needTypes) {
  if (!types.has(t)) {
    report.ok = false;
    report.error = `Expected suggestion type ${t}; got ${[...types].join(", ") || "(none)"}`;
  }
}

if (report.ok) {
  const applied = advise.adviseApply({
    adviseId: advice.adviseId,
    documentId,
    allHighConfidence: true,
    savePath: advisedPath,
  });
  report.apply = {
    appliedCount: applied.applied.length,
    skippedCount: applied.skipped.length,
    createdEntities: applied.createdEntities,
    appliedTypes: [...new Set(applied.applied.map((a) => a.type))].sort(),
    skipped: applied.skipped,
    saved: applied.saved,
    summaryIt: applied.summaryIt,
  };

  const reloaded = FetDocument.loadFile(advisedPath);
  const summary = reloaded.summarize();
  report.reload = {
    counts: summary.counts,
    timeConstraintsByType: summary.timeConstraintsByType,
    spaceConstraintsByType: summary.spaceConstraintsByType,
  };

  for (const t of needTypes) {
    const timeN = summary.timeConstraintsByType?.[t] ?? 0;
    const spaceN = summary.spaceConstraintsByType?.[t] ?? 0;
    if (timeN + spaceN < 1) {
      report.ok = false;
      report.error = `After apply, expected ${t} in saved .fet`;
    }
  }

  // Basic compulsory still present → structurally valid-ish
  if (!(summary.timeConstraintsByType?.ConstraintBasicCompulsoryTime >= 1)) {
    report.ok = false;
    report.error = "Missing ConstraintBasicCompulsoryTime after apply";
  }
  if (!(summary.spaceConstraintsByType?.ConstraintBasicCompulsorySpace >= 1)) {
    report.ok = false;
    report.error = "Missing ConstraintBasicCompulsorySpace after apply";
  }
}

fs.writeFileSync(summaryPath, JSON.stringify(report, null, 2), "utf8");

if (!report.ok) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
