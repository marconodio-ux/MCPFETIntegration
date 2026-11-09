import fs from "node:fs";
import path from "node:path";
import { PATHS, resolveFetClPath } from "../../config.js";
import { FetDocument } from "../document.js";
import { resolveUnder } from "../paths.js";
import { runFetGenerate } from "../runner.js";
import { runStaticHeuristics } from "./heuristics.js";
import {
  blockersFromFetArtifacts,
  collectFetLogArtifacts,
  DIAGNOSE_LIMITS_IT,
  inferFetOutcome,
} from "./parseFetLogs.js";
import type { DiagnoseBlocker, DiagnoseResult, FetOutcome } from "./types.js";

export interface DiagnoseOptions {
  documentId?: string;
  /** Absolute path or under data/input / examples. */
  inputFile?: string;
  /** Workspace FetDocument if already loaded. */
  doc?: FetDocument;
  jobId?: string;
  outputDir?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  /** Run fet-cl (short time limit) then parse logs. */
  runFet?: boolean;
  timeLimitSeconds?: number;
  includeStatic?: boolean;
  language?: string;
}

function resolveInputFile(inputFile: string): string {
  if (path.isAbsolute(inputFile)) return path.normalize(inputFile);
  const fromInput = path.join(PATHS.dataInput, inputFile);
  if (fs.existsSync(fromInput)) return fromInput;
  const fromExamples = path.join(PATHS.examples, inputFile);
  if (fs.existsSync(fromExamples)) return fromExamples;
  return path.resolve(inputFile);
}

function fetClLooksAvailable(): boolean {
  const fetCl = resolveFetClPath();
  if (path.isAbsolute(fetCl) || fetCl.includes(path.sep)) {
    return fs.existsSync(fetCl);
  }
  return false;
}

function severityRank(s: DiagnoseBlocker["severity"]): number {
  return s === "error" ? 0 : s === "warning" ? 1 : 2;
}

function mergeBlockers(lists: DiagnoseBlocker[][]): DiagnoseBlocker[] {
  const all = lists.flat().sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const seen = new Set<string>();
  return all.filter((b) => {
    const key = `${b.code}|${b.titleIt}|${(b.activityIds ?? []).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSummaryIt(
  blockers: DiagnoseBlocker[],
  outcome: FetOutcome,
  ranFet: boolean,
): string {
  const errors = blockers.filter((b) => b.severity === "error");
  if (errors.length === 0) {
    if (outcome === "succeeded") {
      return "Nessun blocker rilevato: generazione riuscita (o modello staticamente coerente).";
    }
    if (ranFet && (outcome === "time_exceeded" || outcome === "unknown")) {
      return "Nessun conflitto duro evidente; la generazione non ha concluso con successo — vedi limiti e log.";
    }
    return "Nessun blocker evidente dalle euristiche/log disponibili.";
  }
  const top = errors.slice(0, 3).map((b) => b.titleIt);
  return `Trovati ${errors.length} blocker: ${top.join("; ")}${errors.length > 3 ? "…" : ""}.`;
}

/**
 * Diagnose why timetable generation struggles/fails.
 * Combines static heuristics on the .fet with optional fet-cl logs.
 */
export async function diagnoseTimetable(opts: DiagnoseOptions): Promise<DiagnoseResult> {
  const includeStatic = opts.includeStatic !== false;
  let inputFile = opts.inputFile ? resolveInputFile(opts.inputFile) : opts.doc?.sourcePath;
  let doc = opts.doc;
  let ranFet = false;
  let exitCode = opts.exitCode;
  let stdout = opts.stdout;
  let stderr = opts.stderr;
  let outputDir = opts.outputDir;
  let fetOutcome: FetOutcome = "skipped";

  if (!doc && inputFile) {
    if (!fs.existsSync(inputFile)) {
      throw new Error(`File .fet non trovato: ${inputFile}`);
    }
    doc = FetDocument.loadFile(inputFile);
  }
  if (!inputFile && doc?.sourcePath) inputFile = doc.sourcePath;

  const staticBlockers = includeStatic && doc ? runStaticHeuristics(doc) : [];

  const fetAvailable = fetClLooksAvailable();

  if (opts.runFet) {
    if (!inputFile) {
      throw new Error("runFet richiede inputFile o un documento salvato su disco.");
    }
    if (!fetAvailable) {
      fetOutcome = "skipped";
    } else {
      const result = await runFetGenerate({
        inputFile,
        jobId: opts.jobId,
        outputDir,
        timeLimitSeconds: opts.timeLimitSeconds ?? 5,
        language: opts.language ?? "en_US",
        wait: true,
      });
      ranFet = true;
      exitCode = result.job.exitCode ?? null;
      stdout = result.stdout;
      stderr = result.stderr;
      outputDir = result.job.outputDir ?? outputDir;
    }
  }

  const artifacts = collectFetLogArtifacts(outputDir, { stdout, stderr });
  if (ranFet || artifacts.pathsFound.length || stdout || stderr) {
    fetOutcome = inferFetOutcome(artifacts, exitCode);
  } else if (!opts.runFet) {
    fetOutcome = "skipped";
  }

  const logBlockers = blockersFromFetArtifacts(artifacts);
  const blockers = mergeBlockers([staticBlockers, logBlockers]);
  const errors = blockers.filter((b) => b.severity === "error");

  // If generation succeeded and no static errors, ok=true
  const ok =
    errors.length === 0 &&
    (fetOutcome === "succeeded" || fetOutcome === "skipped" || fetOutcome === "unknown");

  return {
    ok,
    inputFile,
    documentId: opts.documentId,
    jobId: opts.jobId,
    fetClAvailable: fetAvailable,
    ranFet,
    fetOutcome,
    exitCode,
    blockers,
    limits: DIAGNOSE_LIMITS_IT,
    logsInspected: artifacts.pathsFound,
    summaryIt: buildSummaryIt(blockers, fetOutcome, ranFet),
  };
}

/** Attach diagnosis after a failed (or finished) generate run. */
export async function diagnoseAfterGenerate(args: {
  inputFile: string;
  outputDir?: string;
  jobId?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  includeStatic?: boolean;
}): Promise<DiagnoseResult> {
  return diagnoseTimetable({
    inputFile: args.inputFile,
    outputDir: args.outputDir,
    jobId: args.jobId,
    stdout: args.stdout,
    stderr: args.stderr,
    exitCode: args.exitCode,
    runFet: false,
    includeStatic: args.includeStatic !== false,
  });
}

export function resolveDiagnoseInputPath(inputFile: string): string {
  return resolveInputFile(inputFile);
}

export function resolveOptionalOutputDir(outputDir?: string): string | undefined {
  if (!outputDir) return undefined;
  return path.isAbsolute(outputDir) ? path.normalize(outputDir) : resolveUnder(PATHS.dataOutput, outputDir);
}
