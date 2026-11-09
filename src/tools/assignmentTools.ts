import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { PATHS } from "../config.js";
import {
  generateFetFromAssignments,
  parseAssignmentsText,
  type AssignmentRow,
  type CalendarDefaults,
} from "../fet/assignments/index.js";
import { ensureDataDirs, resolveUnder } from "../fet/paths.js";
import { makeDocId, putDocument, touchDocument } from "../fet/workspace.js";

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

const calendarSchema = z
  .object({
    days: z.array(z.string()).optional(),
    hours: z.array(z.string()).optional(),
    institutionName: z.string().optional(),
    comments: z.string().optional(),
    mode: z.enum(["Official", "Mornings_Afternoons", "Block_Planning", "Terms"]).optional(),
    defaultNumberOfStudents: z.number().int().nonnegative().optional(),
    minDaysWeight: z.number().min(0).max(100).optional(),
    minDays: z.number().int().positive().optional(),
    consecutiveIfSameDay: z.boolean().optional(),
  })
  .optional();

const assignmentRowSchema = z.object({
  teacher: z.string(),
  subject: z.string(),
  students: z.string(),
  hoursPerWeek: z.number().positive(),
  split: z.array(z.number().positive()).optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
});

export function registerAssignmentTools(server: McpServer): void {
  server.registerTool(
    "fet_parse_assignments",
    {
      description:
        "Parse Italian/plain-text teacher workloads (or JSON assignments) into structured rows without writing a .fet. Returns ambiguities that should be asked when unclear.",
      inputSchema: z.object({
        text: z
          .string()
          .optional()
          .describe(
            "Plain-text lines like: Rossi Mario: Matematica — 1A — 5 ore (2+2+1). Or a JSON string.",
          ),
        assignments: z
          .array(assignmentRowSchema)
          .optional()
          .describe("Optional structured rows instead of (or in addition to) text."),
      }),
    },
    async ({ text: inputText, assignments }) => {
      try {
        const parts: AssignmentRow[] = [];
        const ambiguities = [];
        const warnings = [];
        let calendarHints = {};

        if (inputText && inputText.trim()) {
          const parsed = parseAssignmentsText(inputText);
          parts.push(...parsed.assignments);
          ambiguities.push(...parsed.ambiguities);
          warnings.push(...parsed.warnings);
          calendarHints = parsed.calendarHints;
        }
        if (assignments?.length) {
          parts.push(...assignments);
        }
        return text({
          count: parts.length,
          assignments: parts,
          ambiguities,
          warnings,
          calendarHints,
          tip: "When ambiguities is non-empty, ask the user before generating; then call fet_from_assignments.",
        });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_from_assignments",
    {
      description:
        "Generate a valid Official (default) FET workspace .fet from Italian/plain-text teacher assignment descriptions (or structured JSON). Creates teachers, subjects, Year→Group students, split Activities, and MinDaysBetweenActivities. Returns documentId + mapping + ambiguities.",
      inputSchema: z.object({
        text: z
          .string()
          .optional()
          .describe(
            "Assignment sheet text (IT/plain). Headers like Istituto:/Giorni:/Ore: are optional calendar hints.",
          ),
        assignments: z
          .array(assignmentRowSchema)
          .optional()
          .describe("Structured assignments; merged with rows parsed from text."),
        calendar: calendarSchema.describe("Optional school calendar defaults (days/hours/institution)."),
        documentId: z.string().optional(),
        savePath: z
          .string()
          .optional()
          .describe("If set, save .fet (absolute or under data/input)."),
        strictAmbiguities: z
          .boolean()
          .optional()
          .describe("If true, do not build when parse ambiguities exist (default false = best-effort)."),
      }),
    },
    async (args) => {
      try {
        ensureDataDirs();
        const calendar = (args.calendar ?? undefined) as CalendarDefaults | undefined;

        let input: string | AssignmentRow[];
        if (args.assignments?.length && !(args.text && args.text.trim())) {
          input = args.assignments as AssignmentRow[];
        } else if (args.text && args.text.trim()) {
          // Prefer text parse; append extra structured rows afterward
          const generated = generateFetFromAssignments(args.text, {
            calendar,
            strictAmbiguities: args.strictAmbiguities,
          });
          if (args.assignments?.length) {
            // Rebuild including extras
            const merged: AssignmentRow[] = [
              ...generated.result.assignments,
              ...(args.assignments as AssignmentRow[]),
            ];
            const rebuilt = generateFetFromAssignments(merged, {
              calendar,
              strictAmbiguities: args.strictAmbiguities,
            });
            rebuilt.result.ambiguities = [
              ...generated.result.ambiguities,
              ...rebuilt.result.ambiguities,
            ];
            rebuilt.result.warnings = [...generated.result.warnings, ...rebuilt.result.warnings];
            return finalize(rebuilt, args.documentId, args.savePath);
          }
          return finalize(generated, args.documentId, args.savePath);
        } else if (args.assignments?.length) {
          input = args.assignments as AssignmentRow[];
        } else {
          return errorText("Provide text and/or assignments.");
        }

        const generated = generateFetFromAssignments(input, {
          calendar,
          strictAmbiguities: args.strictAmbiguities,
        });
        return finalize(generated, args.documentId, args.savePath);
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

function finalize(
  generated: ReturnType<typeof generateFetFromAssignments>,
  documentId: string | undefined,
  savePath: string | undefined,
) {
  const id = makeDocId(documentId ?? "from-assignments");
  putDocument(id, generated.doc);
  touchDocument(id);

  let savedPath: string | undefined;
  if (savePath) {
    const dest = path.isAbsolute(savePath) ? path.normalize(savePath) : resolveUnder(PATHS.dataInput, savePath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    savedPath = generated.doc.saveFile(dest);
  }

  generated.result.documentId = id;
  generated.result.savedPath = savedPath;

  return text({
    documentId: id,
    savedPath,
    summary: generated.result.summary,
    mapping: generated.result.mapping,
    assignments: generated.result.assignments,
    ambiguities: generated.result.ambiguities,
    warnings: generated.result.warnings,
    tip: savedPath
      ? "Open with fet_document_summary / edit via fet_entity_* / fet_constraint_*, then fet_generate."
      : "Document is in the workspace; call fet_document_save to write a .fet, or pass savePath next time.",
  });
}
