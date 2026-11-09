/**
 * Smoke MFI-5: static heuristics on conflicting .fet + FET log parser on sample-logs.
 * Optional: run fet-cl if available.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule(relBuild, relSrc) {
  const buildPath = path.join(root, "build", ...relBuild);
  const srcPath = path.join(root, "src", ...relSrc);
  if (fs.existsSync(buildPath)) return import(pathToFileURL(buildPath).href);
  return import(pathToFileURL(srcPath).href);
}

const { diagnoseTimetable, blockersFromFetArtifacts, collectFetLogArtifacts, runStaticHeuristics } =
  await loadModule(["fet", "diagnose", "index.js"], ["fet", "diagnose", "index.ts"]);
const { FetDocument } = await loadModule(["fet", "document.js"], ["fet", "document.ts"]);

const conflictFet = path.join(root, "examples", "diagnose", "teacher-unavailable-conflict.fet");
const sampleLogsDir = path.join(root, "examples", "diagnose", "sample-logs");

if (!fs.existsSync(conflictFet)) {
  console.error("Missing conflict example:", conflictFet);
  process.exit(1);
}

const doc = FetDocument.loadFile(conflictFet);
const staticBlockers = runStaticHeuristics(doc);
const staticCodes = new Set(staticBlockers.map((b) => b.code));

const needStatic = ["teacher_fully_unavailable", "teacher_hours_overflow"];
const missingStatic = needStatic.filter((c) => !staticCodes.has(c));

const art = collectFetLogArtifacts(sampleLogsDir);
const logBlockers = blockersFromFetArtifacts(art);
const logCodes = new Set(logBlockers.map((b) => b.code));
const needLog = ["fet_no_allowed_slot", "fet_precompute_failed"];
const missingLog = needLog.filter((c) => !logCodes.has(c));

const full = await diagnoseTimetable({
  inputFile: conflictFet,
  outputDir: sampleLogsDir,
  runFet: false,
  includeStatic: true,
});

const report = {
  ok: missingStatic.length === 0 && missingLog.length === 0 && full.blockers.some((b) => b.severity === "error"),
  conflictFet,
  sampleLogsDir,
  staticCodes: [...staticCodes],
  missingStatic,
  logCodes: [...logCodes],
  missingLog,
  logsInspected: art.pathsFound,
  fullSummaryIt: full.summaryIt,
  fullErrorTitles: full.blockers.filter((b) => b.severity === "error").map((b) => b.titleIt),
  fetClAvailable: full.fetClAvailable,
  limitsCount: full.limits.length,
};

// Optional live fet-cl (does not fail smoke if missing)
if (full.fetClAvailable) {
  try {
    const live = await diagnoseTimetable({
      inputFile: conflictFet,
      runFet: true,
      timeLimitSeconds: 3,
      includeStatic: true,
      language: "en_US",
    });
    report.liveFet = {
      ranFet: live.ranFet,
      fetOutcome: live.fetOutcome,
      exitCode: live.exitCode,
      errorCodes: live.blockers.filter((b) => b.severity === "error").map((b) => b.code),
      logsInspected: live.logsInspected,
    };
  } catch (e) {
    report.liveFet = { error: e instanceof Error ? e.message : String(e) };
  }
} else {
  report.liveFet = { skipped: true, reason: "fet-cl not found (static+sample-logs smoke only)" };
}

if (!report.ok) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(report, null, 2));
