import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PATHS, resolveFetClPath } from "../config.js";
import { writeJob, type JobRecord } from "./jobStore.js";
import { ensureDataDirs, resolveUnder, safeJobId } from "./paths.js";

export interface GenerateOptions {
  inputFile: string;
  outputDir?: string;
  jobId?: string;
  timeLimitSeconds?: number;
  htmlLevel?: number;
  language?: string;
  exportCsv?: boolean;
  wait?: boolean;
  extraArgs?: string[];
}

export interface RunResult {
  job: JobRecord;
  stdout: string;
  stderr: string;
}

function whichExists(candidate: string): boolean {
  if (path.isAbsolute(candidate) || candidate.includes("/") || candidate.includes("\\")) {
    return fs.existsSync(candidate);
  }
  // bare command name — leave resolution to the OS PATH at spawn time
  return true;
}

export function buildFetArgs(opts: GenerateOptions, outputDir: string): string[] {
  const args = [`--inputfile=${opts.inputFile}`, `--outputdir=${outputDir}`];
  if (opts.timeLimitSeconds !== undefined) {
    args.push(`--timelimitseconds=${opts.timeLimitSeconds}`);
  }
  if (opts.htmlLevel !== undefined) {
    args.push(`--htmllevel=${opts.htmlLevel}`);
  }
  if (opts.language) {
    args.push(`--language=${opts.language}`);
  }
  if (opts.exportCsv) {
    args.push("--exportcsv=true");
  }
  if (opts.extraArgs?.length) {
    args.push(...opts.extraArgs);
  }
  return args;
}

/**
 * Run fet-cl. When wait=false, starts the process and returns immediately
 * with status "running" (generation can take minutes/hours).
 */
export async function runFetGenerate(opts: GenerateOptions): Promise<RunResult> {
  ensureDataDirs();
  const fetCl = resolveFetClPath();
  if ((path.isAbsolute(fetCl) || fetCl.includes(path.sep)) && !fs.existsSync(fetCl)) {
    throw new Error(
      `fet-cl not found at "${fetCl}". Build FET from vendor/fet-src or set FET_CL_PATH. See README.md.`,
    );
  }
  if (!whichExists(fetCl)) {
    throw new Error(`fet-cl not available. Set FET_CL_PATH to the fet-cl executable.`);
  }

  const inputFile = path.isAbsolute(opts.inputFile)
    ? path.normalize(opts.inputFile)
    : resolveUnder(PATHS.dataInput, opts.inputFile);

  if (!fs.existsSync(inputFile)) {
    throw new Error(`Input .fet file not found: ${inputFile}`);
  }

  const jobId = safeJobId(opts.jobId ?? `job-${Date.now()}`);
  const outputDir = opts.outputDir
    ? path.isAbsolute(opts.outputDir)
      ? path.normalize(opts.outputDir)
      : resolveUnder(PATHS.dataOutput, opts.outputDir)
    : path.join(PATHS.dataOutput, jobId);
  fs.mkdirSync(outputDir, { recursive: true });

  const args = buildFetArgs({ ...opts, inputFile }, outputDir);
  const command = `${fetCl} ${args.join(" ")}`;
  const startedAt = new Date().toISOString();

  let job = writeJob({
    jobId,
    status: "running",
    inputFile,
    outputDir,
    startedAt,
    command,
  });

  const wait = opts.wait !== false;

  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(fetCl, args, {
      cwd: PROJECT_CWD(outputDir),
      windowsHide: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    job = writeJob({ ...job, pid: child.pid });

    if (!wait) {
      child.unref();
      resolve({ job, stdout, stderr });
      child.on("close", (code) => {
        writeJob({
          ...job,
          status: code === 0 ? "succeeded" : "failed",
          exitCode: code,
          finishedAt: new Date().toISOString(),
          error: code === 0 ? undefined : stderr.slice(-4000) || `exit ${code}`,
        });
      });
      return;
    }

    child.on("error", (err) => {
      const failed = writeJob({
        ...job,
        status: "failed",
        finishedAt: new Date().toISOString(),
        exitCode: null,
        error: err.message,
      });
      reject(Object.assign(err, { job: failed, stdout, stderr }));
    });

    child.on("close", (code) => {
      const ok = code === 0;
      const finished = writeJob({
        ...job,
        status: ok ? "succeeded" : "failed",
        exitCode: code,
        finishedAt: new Date().toISOString(),
        error: ok ? undefined : stderr.slice(-4000) || `fet-cl exited with code ${code}`,
      });
      resolve({ job: finished, stdout, stderr });
    });
  });
}

function PROJECT_CWD(outputDir: string): string {
  return outputDir;
}

export function fetClVersionProbe(): Promise<{ available: boolean; detail: string }> {
  const fetCl = resolveFetClPath();
  if ((path.isAbsolute(fetCl) || fetCl.includes(path.sep)) && !fs.existsSync(fetCl)) {
    return Promise.resolve({
      available: false,
      detail: `Missing executable at ${fetCl}. Run scripts/fetch-fet and build FET, or set FET_CL_PATH.`,
    });
  }

  return new Promise((resolve) => {
    const child = spawn(fetCl, ["--version"], { windowsHide: true });
    let out = "";
    let err = "";
    child.stdout?.on("data", (c: Buffer) => {
      out += c.toString("utf8");
    });
    child.stderr?.on("data", (c: Buffer) => {
      err += c.toString("utf8");
    });
    child.on("error", (e) => {
      resolve({ available: false, detail: e.message });
    });
    child.on("close", (code) => {
      resolve({
        available: code === 0 || out.length > 0 || err.length > 0,
        detail: (out || err || `exit ${code}`).trim(),
      });
    });
  });
}
