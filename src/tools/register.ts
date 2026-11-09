import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  FET_HOMEPAGE,
  FET_LICENSE,
  FET_UPSTREAM_COMMIT,
  FET_UPSTREAM_TAG_NOTE,
  FET_UPSTREAM_URL,
  FET_VERSION,
  PATHS,
  resolveFetClPath,
  SERVER_INFO,
} from "../config.js";
import { catalogCounts, loadConstraintCatalog } from "../fet/catalog.js";
import { listJobs, readJob } from "../fet/jobStore.js";
import { summarizeFetFile } from "../fet/parseFet.js";
import { ensureDataDirs, resolveUnder, safeJobId } from "../fet/paths.js";
import { fetClVersionProbe, runFetGenerate } from "../fet/runner.js";
import { listDocuments } from "../fet/workspace.js";
import { registerAdviseTools } from "./adviseTools.js";
import { registerAssignmentTools } from "./assignmentTools.js";
import { diagnoseAfterGenerate, registerDiagnoseTools } from "./diagnoseTools.js";
import { registerModelTools } from "./modelTools.js";
import { registerNlTools } from "./nlTools.js";

function text(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorText(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

export function registerFetTools(server: McpServer): void {
  registerModelTools(server);
  registerAssignmentTools(server);
  registerNlTools(server);
  registerAdviseTools(server);
  registerDiagnoseTools(server);

  server.registerTool(
    "fet_status",
    {
      description:
        "Report MCP server status, configured FET version/upstream pin, catalog coverage, fet-cl availability, workspace docs, and data directories.",
      inputSchema: z.object({}),
    },
    async () => {
      const probe = await fetClVersionProbe();
      let catalog;
      try {
        catalog = { ...catalogCounts(), loaded: true, fetVersion: loadConstraintCatalog().fetVersion };
      } catch (e) {
        catalog = { loaded: false, error: e instanceof Error ? e.message : String(e) };
      }
      return text({
        server: SERVER_INFO,
        fet: {
          expectedVersion: FET_VERSION,
          homepage: FET_HOMEPAGE,
          upstreamUrl: FET_UPSTREAM_URL,
          upstreamCommit: FET_UPSTREAM_COMMIT,
          upstreamNote: FET_UPSTREAM_TAG_NOTE,
          license: FET_LICENSE,
          fetClPath: resolveFetClPath(),
          fetCl: probe,
          vendorSrcPresent: fs.existsSync(PATHS.vendorSrc),
        },
        catalog,
        workspaceDocuments: listDocuments(),
        paths: PATHS,
        jobs: listJobs().slice(0, 10),
      });
    },
  );

  server.registerTool(
    "fet_load_data",
    {
      description:
        "Copy or register a .fet input file into the MCP data/input workspace and return a structured XML summary (also use fet_document_open for editable workspace docs).",
      inputSchema: z.object({
        sourcePath: z
          .string()
          .describe(
            "Absolute path to an existing .fet file, or a path relative to data/input or examples/.",
          ),
        destName: z
          .string()
          .optional()
          .describe("Optional destination filename under data/input (default: basename of source)."),
      }),
    },
    async ({ sourcePath, destName }) => {
      try {
        ensureDataDirs();
        let src = sourcePath;
        if (!path.isAbsolute(src)) {
          const fromInput = path.join(PATHS.dataInput, src);
          const fromExamples = path.join(PATHS.examples, src);
          if (fs.existsSync(fromInput)) src = fromInput;
          else if (fs.existsSync(fromExamples)) src = fromExamples;
          else src = path.resolve(src);
        }
        if (!fs.existsSync(src)) {
          return errorText(`Source file not found: ${sourcePath}`);
        }
        const dest = resolveUnder(PATHS.dataInput, destName ?? path.basename(src));
        fs.copyFileSync(src, dest);
        const summary = summarizeFetFile(dest);
        return text({ loaded: true, dest, summary });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_validate",
    {
      description:
        "Parse and summarize a .fet file (structure/counts via XML model). Does not run the full FET generator.",
      inputSchema: z.object({
        inputFile: z
          .string()
          .describe("Absolute path, or path relative to data/input."),
      }),
    },
    async ({ inputFile }) => {
      try {
        const file = path.isAbsolute(inputFile)
          ? path.normalize(inputFile)
          : resolveUnder(PATHS.dataInput, inputFile);
        return text(summarizeFetFile(file));
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_generate",
    {
      description:
        "Run FET command-line generator (fet-cl) on a .fet input file. Generation may take seconds to hours; use wait=false for long jobs and poll with fet_job_status. On failure (wait=true), attaches fet_diagnose-style blockers when diagnoseOnFail is true (default).",
      inputSchema: z.object({
        inputFile: z
          .string()
          .describe("Absolute path to .fet, or filename under data/input."),
        jobId: z.string().optional().describe("Optional job id for tracking."),
        outputDir: z
          .string()
          .optional()
          .describe("Optional output directory (absolute or under data/output)."),
        timeLimitSeconds: z.number().int().positive().optional(),
        htmlLevel: z.number().int().min(0).max(7).optional(),
        language: z.string().optional().describe("e.g. en_US, it, ro"),
        exportCsv: z.boolean().optional(),
        wait: z
          .boolean()
          .optional()
          .describe("If true (default), wait for fet-cl to finish. If false, start and return job id."),
        diagnoseOnFail: z
          .boolean()
          .optional()
          .describe(
            "If true (default), when wait=true and generation does not succeed, attach Italian blocker diagnosis (static heuristics + FET logs).",
          ),
      }),
    },
    async (args) => {
      try {
        const { diagnoseOnFail, ...genArgs } = args;
        const result = await runFetGenerate(genArgs);
        const payload: Record<string, unknown> = {
          message: result.job.status === "running" ? "Generation started" : "Generation finished",
          job: result.job,
          stdoutTail: result.stdout.slice(-2000),
          stderrTail: result.stderr.slice(-2000),
        };
        const shouldDiagnose =
          diagnoseOnFail !== false &&
          args.wait !== false &&
          result.job.status === "failed";
        if (shouldDiagnose) {
          try {
            payload.diagnosis = await diagnoseAfterGenerate({
              inputFile: result.job.inputFile ?? args.inputFile,
              outputDir: result.job.outputDir,
              jobId: result.job.jobId,
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.job.exitCode ?? null,
            });
          } catch (diagErr) {
            payload.diagnosisError =
              diagErr instanceof Error ? diagErr.message : String(diagErr);
          }
        }
        return text(payload);
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_job_status",
    {
      description: "Get status for one generation job, or list recent jobs if jobId is omitted.",
      inputSchema: z.object({
        jobId: z.string().optional(),
      }),
    },
    async ({ jobId }) => {
      if (!jobId) {
        return text({ jobs: listJobs() });
      }
      const job = readJob(safeJobId(jobId));
      if (!job) return errorText(`Unknown jobId: ${jobId}`);
      return text(job);
    },
  );

  server.registerTool(
    "fet_export",
    {
      description:
        "List or read generation output artifacts under a job output directory (HTML/XML/CSV/logs).",
      inputSchema: z.object({
        jobId: z.string().optional().describe("Job id whose outputDir will be used."),
        outputDir: z.string().optional().describe("Explicit output directory instead of jobId."),
        relativePath: z
          .string()
          .optional()
          .describe("If set, read that file (text) relative to the output directory."),
        maxBytes: z.number().int().positive().max(2_000_000).optional(),
      }),
    },
    async ({ jobId, outputDir, relativePath, maxBytes }) => {
      try {
        let dir = outputDir;
        if (!dir && jobId) {
          const job = readJob(safeJobId(jobId));
          if (!job?.outputDir) return errorText(`No outputDir for job ${jobId}`);
          dir = job.outputDir;
        }
        if (!dir) return errorText("Provide jobId or outputDir.");
        const base = path.isAbsolute(dir) ? path.normalize(dir) : resolveUnder(PATHS.dataOutput, dir);
        if (!fs.existsSync(base)) return errorText(`Output directory not found: ${base}`);

        if (!relativePath) {
          const files: string[] = [];
          const walk = (d: string, prefix = "") => {
            for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
              const rel = path.join(prefix, ent.name);
              if (ent.isDirectory()) walk(path.join(d, ent.name), rel);
              else files.push(rel.replace(/\\/g, "/"));
            }
          };
          walk(base);
          return text({ outputDir: base, fileCount: files.length, files: files.slice(0, 500) });
        }

        const file = resolveUnder(base, relativePath);
        if (!fs.existsSync(file)) return errorText(`File not found: ${relativePath}`);
        const limit = maxBytes ?? 100_000;
        const buf = fs.readFileSync(file);
        const truncated = buf.length > limit;
        const body = buf.subarray(0, limit).toString("utf8");
        return text({
          outputDir: base,
          relativePath,
          bytes: buf.length,
          truncated,
          content: body,
        });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_list_examples",
    {
      description:
        "List bundled synthetic/anonymous sample .fet files under examples/ (skips real-institute and non-example paths). Optional vendor FET examples if fetched.",
      inputSchema: z.object({
        includeVendor: z.boolean().optional().describe("Also scan vendor/fet-src examples (can be large)."),
        limit: z.number().int().positive().max(200).optional(),
      }),
    },
    async ({ includeVendor, limit }) => {
      const max = limit ?? 50;
      const found: string[] = [];
      const skipDir = (name: string) => {
        const n = name.toLowerCase();
        return n === "private" || n === "local-real" || n === "real" || n === ".git";
      };
      const skipFet = (name: string) => /^orario2627/i.test(name);
      const collect = (root: string) => {
        if (!fs.existsSync(root)) return;
        const stack = [root];
        while (stack.length && found.length < max) {
          const dir = stack.pop()!;
          for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
              if (!skipDir(ent.name)) stack.push(full);
            } else if (ent.name.toLowerCase().endsWith(".fet") && !skipFet(ent.name)) {
              found.push(full);
              if (found.length >= max) break;
            }
          }
        }
      };
      collect(PATHS.examples);
      if (includeVendor) {
        collect(path.join(PATHS.vendorSrc, "examples"));
      }
      return text({
        count: found.length,
        files: found.map((f) => path.normalize(f)),
        tip: "Prefer synthetic samples (sample-school.fet, from-nl/, advise/). Do not open private real-institute files. Then edit via fet_entity_*/fet_constraint_* or fet_generate.",
      });
    },
  );
}
