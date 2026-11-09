import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** Project root (parent of src/ or build/). */
export const PROJECT_ROOT = path.resolve(here, "..");

export const FET_VERSION = "7.12.0";
export const FET_UPSTREAM_URL = "https://github.com/lalesculiviu/fet";
export const FET_UPSTREAM_COMMIT = "c4f67a7b9a430033133cab602d60d85e90ccbd86";
export const FET_UPSTREAM_TAG_NOTE = "commit message FET-7.12.0 on branch main (2026-10-14)";
export const FET_HOMEPAGE = "https://lalescu.ro/liviu/fet/";
export const FET_LICENSE = "AGPL-3.0-only";

export const PATHS = {
  dataInput: path.join(PROJECT_ROOT, "data", "input"),
  dataOutput: path.join(PROJECT_ROOT, "data", "output"),
  dataJobs: path.join(PROJECT_ROOT, "data", "jobs"),
  examples: path.join(PROJECT_ROOT, "examples"),
  vendorSrc: path.join(PROJECT_ROOT, "vendor", "fet-src", `fet-${FET_VERSION}`),
  vendorArchives: path.join(PROJECT_ROOT, "vendor", "archives"),
  /** Official Windows extract (fet.exe + fet-cl.exe + Qt DLLs). */
  vendorBin: path.join(PROJECT_ROOT, "vendor", "bin", `fet-${FET_VERSION}`),
} as const;

/**
 * Resolve the fet-cl executable.
 * Override with FET_CL_PATH when FET is installed system-wide or extracted under vendor/bin.
 * Without env, prefers the first existing candidate (official Windows package, then local CMake build).
 */
export function resolveFetClPath(): string {
  if (process.env.FET_CL_PATH && process.env.FET_CL_PATH.trim()) {
    return process.env.FET_CL_PATH.trim();
  }
  const candidates = [
    path.join(PATHS.vendorBin, "fet-cl.exe"),
    path.join(PATHS.vendorBin, "fet-cl"),
    path.join(PATHS.vendorSrc, "build", "fet-cl.exe"),
    path.join(PATHS.vendorSrc, "build", "fet-cl"),
    path.join(PATHS.vendorSrc, "fet-cl.exe"),
    path.join(PATHS.vendorSrc, "fet-cl"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Bare name for PATH lookup at spawn time (Unix/dev machines).
  return process.platform === "win32" ? "fet-cl.exe" : "fet-cl";
}

export const SERVER_INFO = {
  name: "mcp-fet-integration",
  version: "0.7.0",
} as const;
