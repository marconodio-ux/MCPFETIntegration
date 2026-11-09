import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.js";
import { ensureDataDirs, safeJobId } from "./paths.js";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "unknown";

export interface JobRecord {
  jobId: string;
  status: JobStatus;
  inputFile?: string;
  outputDir?: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  command?: string;
  error?: string;
  pid?: number;
}

function jobFile(jobId: string): string {
  return path.join(PATHS.dataJobs, `${safeJobId(jobId)}.json`);
}

export function writeJob(record: JobRecord): JobRecord {
  ensureDataDirs();
  const id = safeJobId(record.jobId);
  const next = { ...record, jobId: id };
  fs.writeFileSync(jobFile(id), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function readJob(jobId: string): JobRecord | null {
  ensureDataDirs();
  const file = jobFile(jobId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as JobRecord;
}

export function listJobs(): JobRecord[] {
  ensureDataDirs();
  return fs
    .readdirSync(PATHS.dataJobs)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(PATHS.dataJobs, f), "utf8")) as JobRecord;
      } catch {
        return null;
      }
    })
    .filter((j): j is JobRecord => j !== null)
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}
