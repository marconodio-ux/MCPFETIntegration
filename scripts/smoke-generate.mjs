/**
 * Smoke: from-assignments sample → real fet-cl generate (or diagnose if unavailable).
 * Requires FET_CL_PATH or vendor/bin/fet-7.12.0/fet-cl.exe.
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

const { generateFetFromAssignments } = await loadModule(
  ["fet", "assignments", "index.js"],
  ["fet", "assignments", "index.ts"],
);
const { resolveFetClPath } = await loadModule(["config.js"], ["config.ts"]);
const { runFetGenerate } = await loadModule(["fet", "runner.js"], ["fet", "runner.ts"]);
const { diagnoseTimetable } = await loadModule(
  ["fet", "diagnose", "index.js"],
  ["fet", "diagnose", "index.ts"],
);

const textPath = path.join(root, "examples", "from-assignments", "sample-incarichi.txt");
const outFet = path.join(root, "data", "input", "smoke-from-assignments.fet");
const outDir = path.join(root, "data", "output", "smoke-generate");

fs.mkdirSync(path.dirname(outFet), { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const text = fs.readFileSync(textPath, "utf8");
const { doc, result } = generateFetFromAssignments(text);
doc.saveFile(outFet);

const fetCl = resolveFetClPath();
const fetExists =
  path.isAbsolute(fetCl) || fetCl.includes(path.sep) ? fs.existsSync(fetCl) : false;

const report = {
  ok: false,
  fromAssignments: {
    saved: outFet,
    teachers: result.mapping.teachers.length,
    activities: result.mapping.activityIds.length,
    ambiguities: result.ambiguities.length,
    warnings: result.warnings.length,
  },
  fetClPath: fetCl,
  fetClExists: fetExists,
};

if (!fetExists) {
  report.generate = { skipped: true, reason: "fet-cl not found" };
  const diag = await diagnoseTimetable({
    inputFile: outFet,
    runFet: false,
    includeStatic: true,
  });
  report.diagnose = {
    ranFet: diag.ranFet,
    summaryIt: diag.summaryIt,
    blockerCodes: diag.blockers.map((b) => b.code),
  };
  report.ok = report.fromAssignments.activities > 0;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

try {
  const run = await runFetGenerate({
    inputFile: outFet,
    outputDir: outDir,
    jobId: "smoke-generate",
    timeLimitSeconds: 60,
    wait: true,
    language: "en_US",
    htmlLevel: 1,
  });
  report.generate = {
    status: run.job.status,
    exitCode: run.job.exitCode,
    outputDir: run.job.outputDir,
    command: run.job.command,
    stderrTail: (run.stderr || "").slice(-800),
  };

  const genOk = run.job.status === "succeeded" || run.job.status === "completed";
  if (!genOk) {
    const diag = await diagnoseTimetable({
      inputFile: outFet,
      outputDir: outDir,
      runFet: false,
      includeStatic: true,
    });
    report.diagnoseOnFail = {
      summaryIt: diag.summaryIt,
      blockerCodes: diag.blockers.map((b) => b.code),
      logsInspected: diag.logsInspected,
    };
  } else {
    report.timetableArtifacts = fs
      .readdirSync(outDir, { withFileTypes: true })
      .slice(0, 20)
      .map((d) => (d.isDirectory() ? `${d.name}/` : d.name));
  }

  report.ok = genOk || Boolean(report.diagnoseOnFail);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
} catch (e) {
  report.generate = { error: e instanceof Error ? e.message : String(e) };
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
