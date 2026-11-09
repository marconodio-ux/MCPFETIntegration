import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.js";

export function ensureDataDirs(): void {
  for (const dir of [PATHS.dataInput, PATHS.dataOutput, PATHS.dataJobs]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function resolveUnder(base: string, relativeOrAbsolute: string): string {
  const resolved = path.isAbsolute(relativeOrAbsolute)
    ? path.normalize(relativeOrAbsolute)
    : path.normalize(path.join(base, relativeOrAbsolute));
  const baseResolved = path.resolve(base);
  if (!resolved.startsWith(baseResolved + path.sep) && resolved !== baseResolved) {
    throw new Error(`Path escapes allowed directory ${base}: ${relativeOrAbsolute}`);
  }
  return resolved;
}

export function safeJobId(raw: string): string {
  const id = raw.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!id) throw new Error("jobId must be non-empty");
  return id.slice(0, 80);
}
