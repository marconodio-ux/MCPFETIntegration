import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  diagnoseTimetable,
  resolveDiagnoseInputPath,
  resolveOptionalOutputDir,
} from "../fet/diagnose/index.js";
import { readJob } from "../fet/jobStore.js";
import { safeJobId } from "../fet/paths.js";
import { getDocument } from "../fet/workspace.js";

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

export function registerDiagnoseTools(server: McpServer): void {
  server.registerTool(
    "fet_diagnose",
    {
      description:
        "Diagnose why FET timetable generation struggles or fails. Combines static conflict heuristics on a .fet / workspace document with optional fet-cl run and parsing of logs/ (errors.txt, difficult_activities.txt, result.txt). Returns Italian-friendly blockers with suggested fixes and catalog constraint types. When FET only says «Impossible», documents limits and points to max-placed / initial-order clues.",
      inputSchema: z.object({
        documentId: z
          .string()
          .optional()
          .describe("Workspace document id (fet_document_open / fet_from_assignments)."),
        inputFile: z
          .string()
          .optional()
          .describe("Absolute .fet path, or relative to data/input or examples/."),
        jobId: z
          .string()
          .optional()
          .describe("Existing generation job: reuse its inputFile/outputDir/logs."),
        outputDir: z
          .string()
          .optional()
          .describe("Directory containing FET logs/ (absolute or under data/output)."),
        runFet: z
          .boolean()
          .optional()
          .describe(
            "If true, run fet-cl (short timeLimit) then parse logs. Default false — static + existing logs only.",
          ),
        timeLimitSeconds: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Time limit when runFet=true (default 5)."),
        includeStatic: z
          .boolean()
          .optional()
          .describe("Run static heuristics on the .fet (default true)."),
        language: z.string().optional().describe("fet-cl --language when runFet (default en_US)."),
      }),
    },
    async (args) => {
      try {
        let inputFile = args.inputFile;
        let outputDir = args.outputDir ? resolveOptionalOutputDir(args.outputDir) : undefined;
        let documentId = args.documentId;
        let doc;
        let jobId = args.jobId;

        if (args.jobId) {
          const job = readJob(safeJobId(args.jobId));
          if (!job) return errorText(`Unknown jobId: ${args.jobId}`);
          jobId = job.jobId;
          if (!inputFile && job.inputFile) inputFile = job.inputFile;
          if (!outputDir && job.outputDir) outputDir = job.outputDir;
        }

        if (args.documentId) {
          const entry = getDocument(args.documentId);
          doc = entry.doc;
          documentId = entry.id;
          if (!inputFile && entry.doc.sourcePath) inputFile = entry.doc.sourcePath;
        }

        if (!doc && !inputFile && !outputDir) {
          return errorText(
            "Provide documentId, inputFile, jobId, and/or outputDir (with FET logs).",
          );
        }

        if (inputFile) inputFile = resolveDiagnoseInputPath(inputFile);

        // If we have a workspace doc that is dirty / unsaved and no file, diagnose the in-memory doc.
        const result = await diagnoseTimetable({
          documentId,
          inputFile,
          doc,
          jobId,
          outputDir,
          runFet: args.runFet === true,
          timeLimitSeconds: args.timeLimitSeconds,
          includeStatic: args.includeStatic,
          language: args.language,
        });

        return text({
          ...result,
          tip:
            result.blockers.length > 0
              ? "Usa constraintTypes + fet_constraint_list/update per allentare i vincoli; poi fet_generate."
              : "Se la generazione fallisce ancora, rilancia con runFet=true (serve fet-cl) o passa jobId/outputDir con logs/.",
          relatedTools: ["fet_constraint_catalog", "fet_constraint_list", "fet_generate", "fet_export"],
        });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

/** Shared helper for fet_generate diagnoseOnFail attachment. */
export { diagnoseAfterGenerate } from "../fet/diagnose/index.js";

export function diagnoseTipPath(inputFile?: string): string | undefined {
  if (!inputFile) return undefined;
  return path.basename(inputFile);
}
