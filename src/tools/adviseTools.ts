import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { adviseApply, adviseTimetable } from "../fet/advise/index.js";

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

export function registerAdviseTools(server: McpServer): void {
  server.registerTool(
    "fet_advise",
    {
      description:
        "Intelligent FET constraint advisor: analyze a workspace document / .fet (and optional Italian intent text) and return ranked suggestions for constraints the user may not know by name (MinDays, SameStartingTime for parallel labs, PreferredRoom for LAB, BreakTimes, MaxHoursDaily, NotAvailable, Consecutive, …). Each suggestion has catalog type, fieldsDraft, Italian rationale, and confidence. Heuristics follow common IT school practice and map only to real catalog types. IMPORTANT: the advisor proposes constraints — FET (fet_generate) still produces the timetable. Use fet_advise_apply to write accepted suggestions. Do not open private real-institute files unless the user explicitly provides a path.",
      inputSchema: z.object({
        documentId: z
          .string()
          .optional()
          .describe("Workspace document id (fet_document_open / fet_nl_build)."),
        inputFile: z
          .string()
          .optional()
          .describe("Absolute .fet path, or relative to data/input or examples/."),
        text: z
          .string()
          .optional()
          .describe(
            "Optional Italian/school description that may mention labs, pauses, max hours, unavailability — boosts matching heuristics.",
          ),
        limit: z.number().int().positive().max(100).optional().describe("Max suggestions (default 25)."),
        minConfidence: z
          .enum(["high", "medium", "low"])
          .optional()
          .describe("Filter: only suggestions at this confidence or above."),
        openInWorkspace: z
          .boolean()
          .optional()
          .describe(
            "If true (default) and only inputFile is given, open the .fet into a workspace documentId so fet_advise_apply can mutate it.",
          ),
      }),
    },
    async (args) => {
      try {
        if (!args.documentId && !args.inputFile) {
          return errorText("Provide documentId and/or inputFile.");
        }
        const result = adviseTimetable(args);
        return text(result);
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_advise_apply",
    {
      description:
        "Apply accepted fet_advise suggestions into the workspace document: pass suggestionIds, or omit ids to apply all high-confidence suggestions. May auto-create missing rooms referenced by PreferredRoom drafts. Returns applied/skipped lists. Does NOT run the FET solver — call fet_document_save then fet_generate afterwards.",
      inputSchema: z.object({
        adviseId: z.string().describe("adviseId returned by fet_advise."),
        documentId: z
          .string()
          .optional()
          .describe("Workspace document (default: the one opened by fet_advise)."),
        suggestionIds: z
          .array(z.string())
          .optional()
          .describe("Specific suggestion ids to apply. If omitted, applies all high-confidence."),
        allHighConfidence: z
          .boolean()
          .optional()
          .describe(
            "When suggestionIds omitted: if true (default) apply confidence=high only; if false apply all (or use minConfidence).",
          ),
        minConfidence: z
          .enum(["high", "medium", "low"])
          .optional()
          .describe("When suggestionIds omitted: minimum confidence floor."),
        savePath: z
          .string()
          .optional()
          .describe("Optional path to save the .fet after apply (absolute or under examples/)."),
      }),
    },
    async (args) => {
      try {
        const result = adviseApply(args);
        return text(result);
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
