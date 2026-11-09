import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { PATHS } from "../config.js";
import { FetDocument } from "../fet/document.js";
import {
  generateFetFromNl,
  applyNlPatchToDocument,
  parseNlText,
  extractFromDocument,
  describeConstraintInstance,
  listPhraseTemplates,
  phraseCatalogSummary,
  parseConstraintPhrase,
  PRIORITY_SAMPLE_TYPES,
  type CalendarDefaults,
  type NlIntent,
} from "../fet/nl/index.js";
import { ensureDataDirs, resolveUnder } from "../fet/paths.js";
import { getDocument, makeDocId, putDocument, touchDocument } from "../fet/workspace.js";

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

const assignmentSchema = z.object({
  teacher: z.string(),
  subject: z.string(),
  students: z.string().describe("FET students-set name: Year, Group, or Subgroup (e.g. P1A-meccanica)"),
  hoursPerWeek: z.number().positive(),
  split: z.array(z.number().positive()).optional(),
  tags: z.array(z.string()).optional(),
  source: z.string().optional(),
  key: z.string().optional(),
});

const classSplitSchema = z.object({
  group: z.string().describe("Class/group label, e.g. P1A"),
  year: z.string().optional(),
  subgroups: z.array(z.string()).min(2),
  parallel: z.boolean().optional(),
  source: z.string().optional(),
});

const patchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_assignment"), assignment: assignmentSchema }),
  z.object({
    op: z.literal("change_assignment"),
    match: z.object({
      teacher: z.string().optional(),
      subject: z.string().optional(),
      students: z.string().optional(),
      key: z.string().optional(),
      activityIds: z.array(z.number()).optional(),
    }),
    set: z.object({
      teacher: z.string().optional(),
      subject: z.string().optional(),
      students: z.string().optional(),
      hoursPerWeek: z.number().positive().optional(),
      split: z.array(z.number().positive()).optional(),
      tags: z.array(z.string()).optional(),
    }),
  }),
  z.object({
    op: z.literal("remove_assignment"),
    match: z.object({
      teacher: z.string().optional(),
      subject: z.string().optional(),
      students: z.string().optional(),
      key: z.string().optional(),
      activityIds: z.array(z.number()).optional(),
    }),
  }),
  z.object({ op: z.literal("add_class_split"), split: classSplitSchema }),
  z.object({
    op: z.literal("add_constraint"),
    type: z.string(),
    fields: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal("remove_constraint"),
    type: z.string(),
    match: z
      .object({
        commentsIncludes: z.string().optional(),
        activityIds: z.array(z.number()).optional(),
      })
      .optional(),
  }),
]);

const constraintSpecSchema = z.object({
  type: z.string().describe("FET constraint type, e.g. ConstraintTeacherNotAvailableTimes"),
  fields: z.record(z.string(), z.unknown()),
  italian: z.string().optional(),
  source: z.string().optional(),
});

const intentSchema = z
  .object({
    institutionName: z.string().optional(),
    comments: z.string().optional(),
    calendar: calendarSchema,
    assignments: z.array(assignmentSchema).optional(),
    classSplits: z.array(classSplitSchema).optional(),
    constraints: z.array(constraintSpecSchema).optional(),
    patches: z.array(patchOpSchema).optional(),
  })
  .optional();

export function registerNlTools(server: McpServer): void {
  server.registerTool(
    "fet_nl_parse",
    {
      description:
        "Parse free-form Italian timetable prose (or structured intent JSON) into assignments, class splits (subgroups), and clarifying gaps. Does not write a .fet. Use before fet_nl_build when you want to inspect mapping/gaps. This MCP is NOT ChatGPT — the LLM client asks the user using returned gaps.ask.",
      inputSchema: z.object({
        text: z
          .string()
          .optional()
          .describe(
            "Italian natural language: incarichi, classi spezzate, ore. Chat greetings are stripped.",
          ),
        intent: intentSchema.describe("Optional structured intent from the LLM client."),
      }),
    },
    async ({ text: inputText, intent }) => {
      try {
        const parsed = inputText?.trim()
          ? parseNlText(inputText)
          : intent
            ? parseNlText(JSON.stringify(intent))
            : parseNlText("");
        // If both, merge via generate path's merge — simple: prefer text then overlay intent assignments
        let result = parsed;
        if (inputText?.trim() && intent) {
          const { mergeNlInputs } = await import("../fet/nl/parseNl.js");
          result = mergeNlInputs(inputText, intent as Partial<NlIntent>);
        }
        return text({
          ...result,
          tip: "When gaps is non-empty, ask the user using gaps[].ask; then call fet_nl_build (optionally with filled intent).",
        });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_nl_build",
    {
      description:
        "Build a FET Official workspace .fet from Italian natural-language assignments + constraints (and/or structured intent). Maps Year→Group→Subgroup for split classes, teachers/subjects/activities, MinDays on weekly splits, and SameStartingTime for parallel halves. Returns documentId, mapping, and gaps (clarifying questions) — does not pretend to be the chat LLM.",
      inputSchema: z.object({
        text: z
          .string()
          .optional()
          .describe("Free-form Italian description of the timetable / incarichi / class splits."),
        intent: intentSchema.describe(
          "Structured intent the LLM already extracted; merged with text when both are set.",
        ),
        calendar: calendarSchema,
        documentId: z.string().optional(),
        savePath: z.string().optional().describe("If set, save .fet (absolute or under data/input)."),
        strictGaps: z
          .boolean()
          .optional()
          .describe("If true, do not build when gaps exist (default false = best-effort)."),
        parallelSameStartingTime: z
          .boolean()
          .optional()
          .describe("Default true: align parallel subgroup activities with SameStartingTime."),
      }),
    },
    async (args) => {
      try {
        ensureDataDirs();
        if (!(args.text && args.text.trim()) && !args.intent) {
          return errorText("Provide text and/or intent.");
        }
        const generated = generateFetFromNl(args.text, args.intent as Partial<NlIntent> | undefined, {
          calendar: args.calendar as CalendarDefaults | undefined,
          strictGaps: args.strictGaps,
          parallelSameStartingTime: args.parallelSameStartingTime,
        });

        const id = makeDocId(args.documentId ?? "from-nl");
        putDocument(id, generated.doc);
        touchDocument(id);

        let savedPath: string | undefined;
        if (args.savePath) {
          const dest = path.isAbsolute(args.savePath)
            ? path.normalize(args.savePath)
            : resolveUnder(PATHS.dataInput, args.savePath);
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
          intent: generated.result.intent,
          gaps: generated.result.gaps,
          warnings: generated.result.warnings,
          notes: generated.result.notes,
          tip:
            generated.result.gaps.length > 0
              ? "gaps non vuoti: fai domande all’utente (gaps[].ask), poi fet_nl_patch o rifai fet_nl_build con intent completato. Poi fet_generate / fet_diagnose."
              : savedPath
                ? "Pronto: fet_generate o raffina con fet_nl_patch / fet_entity_* / fet_constraint_*."
                : "Documento in workspace; fet_document_save oppure passa savePath. Poi fet_generate.",
        });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_nl_patch",
    {
      description:
        "Apply conversational Italian modifications (or structured patches) to an existing workspace document: add/change/remove assignments & constraints, add class splits/subgroups. End state remains a .fet suitable for fet_generate / fet_diagnose.",
      inputSchema: z.object({
        documentId: z.string().describe("Workspace document id from fet_nl_build / fet_document_open."),
        text: z
          .string()
          .optional()
          .describe("Italian patch prose: «aggiungi…», «cambia X a N ore», «rimuovi attività di Y», nuovi split."),
        intent: intentSchema,
        patches: z.array(patchOpSchema).optional().describe("Explicit patch ops (merged with intent.patches)."),
        savePath: z.string().optional(),
      }),
    },
    async (args) => {
      try {
        const entry = getDocument(args.documentId);
        const intent: Partial<NlIntent> = {
          ...(args.intent as Partial<NlIntent> | undefined),
          patches: [
            ...((args.intent as Partial<NlIntent> | undefined)?.patches ?? []),
            ...((args.patches as NlIntent["patches"]) ?? []),
          ],
        };
        const result = applyNlPatchToDocument(entry.doc, args.text, intent, {});
        touchDocument(args.documentId);

        let savedPath: string | undefined;
        if (args.savePath) {
          const dest = path.isAbsolute(args.savePath)
            ? path.normalize(args.savePath)
            : resolveUnder(PATHS.dataInput, args.savePath);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          savedPath = entry.doc.saveFile(dest);
        }

        result.documentId = args.documentId;
        result.savedPath = savedPath;

        return text({
          documentId: args.documentId,
          savedPath,
          applied: result.applied,
          skipped: result.skipped,
          summary: result.summary,
          mapping: result.mapping,
          gaps: result.gaps,
          warnings: result.warnings,
          notes: result.notes,
          tip: "Verifica con fet_document_summary; poi fet_generate / fet_diagnose. Per rebuild completo preferisci fet_nl_build.",
        });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_nl_extract",
    {
      description:
        "Open a workspace document or .fet path and extract entities + every constraint instance into structured JSON and Italian descriptions. Reports phrase coverage (all 358 catalog types are live; common school types use hand-tuned overlays). Use before descriptive rebuild/patch. Handles Active=false preferred-time locks as solution artifacts. Prefer synthetic examples unless the user names a path.",
      inputSchema: z.object({
        documentId: z.string().optional().describe("Workspace document id."),
        filePath: z
          .string()
          .optional()
          .describe("Absolute .fet path, or relative to data/input or examples/."),
        includeConstraintFields: z
          .boolean()
          .optional()
          .describe("If false, omit full fields in each constraint (lighter). Default true."),
        limitConstraints: z.number().int().positive().max(2000).optional(),
      }),
    },
    async ({ documentId, filePath, includeConstraintFields, limitConstraints }) => {
      try {
        let doc: FetDocument;
        if (documentId) {
          doc = getDocument(documentId).doc;
        } else if (filePath) {
          let src = filePath;
          if (!path.isAbsolute(src)) {
            const fromInput = path.join(PATHS.dataInput, src);
            const fromExamples = path.join(PATHS.examples, src);
            if (fs.existsSync(fromInput)) src = fromInput;
            else if (fs.existsSync(fromExamples)) src = fromExamples;
            else src = path.resolve(src);
          }
          doc = FetDocument.loadFile(src);
        } else {
          return errorText("Provide documentId or filePath.");
        }

        const extracted = extractFromDocument(doc);
        const limit = limitConstraints ?? extracted.constraints.length;
        const constraints = extracted.constraints.slice(0, limit).map((c) => {
          if (includeConstraintFields === false) {
            const { fields: _f, ...rest } = c;
            return rest;
          }
          return c;
        });

        return text({
          meta: extracted.meta,
          entities: extracted.entities,
          days: extracted.days,
          hours: extracted.hours,
          teachers: extracted.teachers,
          subjects: extracted.subjects,
          rooms: extracted.rooms,
          studentsTree: extracted.studentsTree,
          classSplits: extracted.classSplits,
          assignmentCount: extracted.assignments.length,
          assignmentsSample: extracted.assignments.slice(0, 20),
          constraintsByType: extracted.constraintsByType,
          constraints,
          italianDigest: extracted.italianDigest,
          coverage: extracted.coverage,
          notes: extracted.notes,
          tip: extracted.coverage.allPresentTypesLive
            ? "Coverage OK: usa italianDigest / constraints come intent.constraints o fet_nl_patch."
            : "Alcuni tipi presenti non sono live — vedi coverage.sampleTypesMissingLive / notes.",
        });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_describe_constraints",
    {
      description:
        "Describe FET constraints in Italian from a workspace document, .fet file, or inline {type,fields}. Uses live phrase templates for all 358 catalog types (common school types keep hand-tuned overlays).",
      inputSchema: z.object({
        documentId: z.string().optional(),
        filePath: z.string().optional(),
        type: z.string().optional().describe("Filter by constraint type."),
        constraints: z
          .array(
            z.object({
              type: z.string(),
              fields: z.record(z.string(), z.unknown()),
            }),
          )
          .optional()
          .describe("Inline constraints to describe (no document needed)."),
        limit: z.number().int().positive().max(500).optional(),
      }),
    },
    async (args) => {
      try {
        const out: Array<{
          type: string;
          italian: string;
          phraseStatus: "live" | "stub";
          descriptionIt: string;
          index?: number;
        }> = [];

        if (args.constraints?.length) {
          for (const c of args.constraints.slice(0, args.limit ?? 500)) {
            const d = describeConstraintInstance(c.type, c.fields);
            out.push({
              type: c.type,
              italian: d.italian,
              phraseStatus: d.status,
              descriptionIt: d.descriptionIt,
            });
          }
        } else {
          let doc: FetDocument;
          if (args.documentId) doc = getDocument(args.documentId).doc;
          else if (args.filePath) {
            let src = args.filePath;
            if (!path.isAbsolute(src)) {
              const fromInput = path.join(PATHS.dataInput, src);
              const fromExamples = path.join(PATHS.examples, src);
              if (fs.existsSync(fromInput)) src = fromInput;
              else if (fs.existsSync(fromExamples)) src = fromExamples;
              else src = path.resolve(src);
            }
            doc = FetDocument.loadFile(src);
          } else {
            return errorText("Provide documentId, filePath, or constraints[].");
          }
          const list = doc.listConstraints(args.type ? { type: args.type } : undefined);
          for (const c of list.slice(0, args.limit ?? 200)) {
            const d = describeConstraintInstance(c.type, c.fields);
            out.push({
              type: c.type,
              index: c.index,
              italian: d.italian,
              phraseStatus: d.status,
              descriptionIt: d.descriptionIt,
            });
          }
        }

        return text({
          count: out.length,
          descriptions: out,
          sampleTypes: [...PRIORITY_SAMPLE_TYPES],
          tip: "Per reverse path completo usa fet_nl_extract.",
        });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_nl_phrase_catalog",
    {
      description:
        "List NL phrase templates for the 358 FET constraint types (all live: schema-driven + priority overlays). Optionally parse one Italian phrase into type+fields.",
      inputSchema: z.object({
        status: z.enum(["live", "stub"]).optional(),
        kind: z.enum(["time", "space", "generation_option"]).optional(),
        q: z.string().optional(),
        sampleOnly: z.boolean().optional(),
        parseText: z
          .string()
          .optional()
          .describe("If set, also run parseConstraintPhrase on this Italian text."),
        limit: z.number().int().positive().max(400).optional(),
      }),
    },
    async (args) => {
      try {
        const summary = phraseCatalogSummary();
        const templates = listPhraseTemplates({
          status: args.status,
          kind: args.kind,
          q: args.q,
          sampleOnly: args.sampleOnly,
        })
          .slice(0, args.limit ?? 50)
          .map((t) => ({
            type: t.type,
            kind: t.kind,
            status: t.status,
            descriptionIt: t.descriptionIt,
            family: t.family,
            examplesIt: t.examplesIt.slice(0, 2),
          }));

        let parsed = null;
        if (args.parseText?.trim()) {
          parsed = parseConstraintPhrase(args.parseText);
        }

        return text({
          summary,
          templates,
          parsed,
          tip:
            summary.live === summary.total && summary.sampleMissing.length === 0
              ? `Catalogo ${summary.live}/${summary.total} live; overlay hand-tuned sui tipi scuola comuni.`
              : summary.sampleMissing.length
                ? `Sample types missing live: ${summary.sampleMissing.join(", ")}`
                : `Live ${summary.live}/${summary.total}, stub ${summary.stub}.`,
        });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
