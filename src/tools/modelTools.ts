import fs from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { PATHS } from "../config.js";
import {
  ENTITY_KINDS,
  catalogCounts,
  getConstraintType,
  isEntityKind,
  listConstraintTypes,
  loadConstraintCatalog,
  type ConstraintKind,
  type EntityKind,
} from "../fet/catalog.js";
import { FetDocument } from "../fet/document.js";
import { ensureDataDirs, resolveUnder } from "../fet/paths.js";
import {
  closeDocument,
  getDocument,
  listDocuments,
  makeDocId,
  putDocument,
  touchDocument,
} from "../fet/workspace.js";

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

function resolveInputPath(inputFile: string): string {
  if (path.isAbsolute(inputFile)) return path.normalize(inputFile);
  const fromInput = path.join(PATHS.dataInput, inputFile);
  if (fs.existsSync(fromInput)) return fromInput;
  const fromExamples = path.join(PATHS.examples, inputFile);
  if (fs.existsSync(fromExamples)) return fromExamples;
  return resolveUnder(PATHS.dataInput, inputFile);
}

const entityKindSchema = z.enum(ENTITY_KINDS as unknown as [EntityKind, ...EntityKind[]]);
const constraintKindSchema = z.enum(["time", "space", "generation_option"]);

export function registerModelTools(server: McpServer): void {
  server.registerTool(
    "fet_document_new",
    {
      description:
        "Create a new in-memory FET document (Official by default) with BasicCompulsory time/space constraints. Returns documentId for subsequent entity/constraint tools.",
      inputSchema: z.object({
        documentId: z.string().optional().describe("Optional id; auto-generated if omitted."),
        mode: z
          .enum(["Official", "Mornings_Afternoons", "Block_Planning", "Terms"])
          .optional(),
        institutionName: z.string().optional(),
        comments: z.string().optional(),
        days: z.array(z.string()).optional(),
        hours: z.array(z.string()).optional(),
      }),
    },
    async (args) => {
      try {
        const id = makeDocId(args.documentId);
        const doc = FetDocument.create({
          mode: args.mode,
          institutionName: args.institutionName,
          comments: args.comments,
          days: args.days,
          hours: args.hours,
        });
        putDocument(id, doc);
        return text({ documentId: id, summary: doc.summarize() });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_document_open",
    {
      description:
        "Load a .fet XML file into the workspace (round-trip capable). Optionally copy into data/input.",
      inputSchema: z.object({
        sourcePath: z.string().describe("Absolute path or path under data/input or examples/."),
        documentId: z.string().optional(),
        copyToInput: z
          .boolean()
          .optional()
          .describe("If true, copy the file into data/input before opening."),
      }),
    },
    async ({ sourcePath, documentId, copyToInput }) => {
      try {
        ensureDataDirs();
        let src = resolveInputPath(sourcePath);
        if (!fs.existsSync(src)) return errorText(`Source file not found: ${sourcePath}`);
        if (copyToInput) {
          const dest = resolveUnder(PATHS.dataInput, path.basename(src));
          fs.copyFileSync(src, dest);
          src = dest;
        }
        const id = makeDocId(documentId ?? path.basename(src, path.extname(src)));
        const doc = FetDocument.loadFile(src);
        putDocument(id, doc);
        return text({ documentId: id, path: src, summary: doc.summarize() });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_document_save",
    {
      description: "Serialize a workspace document to a .fet file (UTF-8 with BOM, FET section order preserved).",
      inputSchema: z.object({
        documentId: z.string(),
        destPath: z
          .string()
          .optional()
          .describe("Absolute path or filename under data/input. Defaults to the path the doc was opened from."),
      }),
    },
    async ({ documentId, destPath }) => {
      try {
        ensureDataDirs();
        const entry = getDocument(documentId);
        let dest = destPath;
        if (dest && !path.isAbsolute(dest)) {
          dest = resolveUnder(PATHS.dataInput, dest);
        }
        const saved = entry.doc.saveFile(dest);
        touchDocument(documentId);
        return text({ saved: true, path: saved, summary: entry.doc.summarize() });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_document_list",
    {
      description: "List in-memory FET documents in the MCP workspace.",
      inputSchema: z.object({}),
    },
    async () => text({ documents: listDocuments() }),
  );

  server.registerTool(
    "fet_document_close",
    {
      description: "Drop a document from the workspace (does not delete files).",
      inputSchema: z.object({ documentId: z.string() }),
    },
    async ({ documentId }) => {
      const ok = closeDocument(documentId);
      return ok ? text({ closed: true, documentId }) : errorText(`Unknown documentId: ${documentId}`);
    },
  );

  server.registerTool(
    "fet_document_summary",
    {
      description: "Summarize entity and constraint counts for a workspace document.",
      inputSchema: z.object({ documentId: z.string() }),
    },
    async ({ documentId }) => {
      try {
        return text(getDocument(documentId).doc.summarize());
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_meta_get",
    {
      description: "Get file-level meta: version, Mode, Institution_Name, Comments, Terms fields.",
      inputSchema: z.object({ documentId: z.string() }),
    },
    async ({ documentId }) => {
      try {
        return text(getDocument(documentId).doc.getMeta());
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_meta_set",
    {
      description: "Patch file-level meta (Mode, Institution_Name, Comments, Terms, version attribute).",
      inputSchema: z.object({
        documentId: z.string(),
        version: z.string().optional(),
        mode: z
          .enum(["Official", "Mornings_Afternoons", "Block_Planning", "Terms"])
          .optional(),
        institutionName: z.string().optional(),
        comments: z.string().optional(),
        numberOfTerms: z.number().int().positive().optional(),
        numberOfDaysPerTerm: z.number().int().positive().optional(),
      }),
    },
    async ({ documentId, ...patch }) => {
      try {
        const entry = getDocument(documentId);
        const meta = entry.doc.setMeta(patch);
        touchDocument(documentId);
        return text({ meta });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_entity_kinds",
    {
      description:
        "List supported entity kinds for fet_entity_* tools (days, hours, teachers, students, subjects, rooms, …).",
      inputSchema: z.object({}),
    },
    async () =>
      text({
        kinds: ENTITY_KINDS,
        notes: {
          students: "Year → Group → Subgroup hierarchy; upsert a Year object with nested Group/Subgroup fields.",
          days_hours: "Number_of_* counters are maintained automatically on upsert/remove/set_list.",
        },
      }),
  );

  server.registerTool(
    "fet_entity_list",
    {
      description: "List entities of a kind from a document (JSON fields mirroring FET XML children).",
      inputSchema: z.object({
        documentId: z.string(),
        kind: entityKindSchema,
        limit: z.number().int().positive().max(5000).optional(),
        offset: z.number().int().nonnegative().optional(),
      }),
    },
    async ({ documentId, kind, limit, offset }) => {
      try {
        if (!isEntityKind(kind)) return errorText(`Unknown entity kind: ${kind}`);
        const all = getDocument(documentId).doc.listEntities(kind);
        const start = offset ?? 0;
        const slice = all.slice(start, start + (limit ?? all.length));
        return text({ kind, total: all.length, offset: start, items: slice });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_entity_get",
    {
      description: "Get one entity by kind + index.",
      inputSchema: z.object({
        documentId: z.string(),
        kind: entityKindSchema,
        index: z.number().int().nonnegative(),
      }),
    },
    async ({ documentId, kind, index }) => {
      try {
        return text(getDocument(documentId).doc.getEntity(kind, index));
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_entity_upsert",
    {
      description:
        "Insert or update an entity. fields is a JSON object mirroring XML children (e.g. Subject: {Name, Long_Name, Code, Comments}). Omit index to append.",
      inputSchema: z.object({
        documentId: z.string(),
        kind: entityKindSchema,
        fields: z.record(z.string(), z.unknown()),
        index: z.number().int().nonnegative().optional(),
      }),
    },
    async ({ documentId, kind, fields, index }) => {
      try {
        const entry = getDocument(documentId);
        const result = entry.doc.upsertEntity(kind, fields, index);
        touchDocument(documentId);
        return text(result);
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_entity_remove",
    {
      description: "Remove an entity by kind + index.",
      inputSchema: z.object({
        documentId: z.string(),
        kind: entityKindSchema,
        index: z.number().int().nonnegative(),
      }),
    },
    async ({ documentId, kind, index }) => {
      try {
        const entry = getDocument(documentId);
        const result = entry.doc.removeEntity(kind, index);
        touchDocument(documentId);
        return text(result);
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_entity_set_list",
    {
      description:
        "Replace the entire days/hours/real_days/real_hours list (convenience for week definition).",
      inputSchema: z.object({
        documentId: z.string(),
        kind: z.enum(["days", "hours", "real_days", "real_hours"]),
        names: z.array(
          z.union([
            z.string(),
            z.object({ Name: z.string(), Long_Name: z.string().optional() }),
          ]),
        ),
      }),
    },
    async ({ documentId, kind, names }) => {
      try {
        const entry = getDocument(documentId);
        entry.doc.setNamedList(kind, names);
        touchDocument(documentId);
        return text({ kind, count: names.length, items: entry.doc.listEntities(kind) });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_constraint_catalog",
    {
      description:
        "List all FET constraint types from the 7.12 catalog (275 time + 82 space + 1 generation option). Filter by kind/mode/substring.",
      inputSchema: z.object({
        kind: constraintKindSchema.optional(),
        mode: z.string().optional().describe("e.g. tutti, MA, Terms"),
        q: z.string().optional().describe("Case-insensitive substring on type/description/family"),
        limit: z.number().int().positive().max(500).optional(),
        offset: z.number().int().nonnegative().optional(),
      }),
    },
    async ({ kind, mode, q, limit, offset }) => {
      const all = listConstraintTypes({ kind, mode, q });
      const start = offset ?? 0;
      const max = limit ?? 100;
      const slice = all.slice(start, start + max).map((t) => ({
        type: t.type,
        kind: t.kind,
        mode: t.mode,
        family: t.family,
        descriptionIt: t.descriptionIt,
      }));
      return text({
        counts: catalogCounts(),
        totalMatched: all.length,
        offset: start,
        limit: max,
        types: slice,
      });
    },
  );

  server.registerTool(
    "fet_constraint_schema",
    {
      description:
        "Return XML field/tag hints for one constraint type (extracted from FET getXmlDescription). fields JSON for add/update should mirror these tags; nested containers become objects/arrays.",
      inputSchema: z.object({
        type: z.string().describe("e.g. ConstraintTeacherNotAvailableTimes"),
      }),
    },
    async ({ type }) => {
      const info = getConstraintType(type);
      if (!info) {
        return errorText(
          `Unknown type: ${type}. Catalog has ${loadConstraintCatalog().counts.total} types — use fet_constraint_catalog.`,
        );
      }
      return text({
        type: info.type,
        kind: info.kind,
        mode: info.mode,
        family: info.family,
        descriptionIt: info.descriptionIt,
        schema: info.schema,
        commonFields: info.kind === "generation_option"
          ? ["Active", "Comments"]
          : ["Weight_Percentage", "Active", "Comments"],
        usage: {
          add: "fet_constraint_add with { type, fields }",
          fieldsShape:
            "Flat tags → strings; repeated tags → arrays; nested blocks (e.g. Not_Available_Time) → object or array of objects.",
        },
      });
    },
  );

  server.registerTool(
    "fet_constraint_list",
    {
      description: "List constraints present in a document (optionally filter by kind/type).",
      inputSchema: z.object({
        documentId: z.string(),
        kind: constraintKindSchema.optional(),
        type: z.string().optional(),
        limit: z.number().int().positive().max(5000).optional(),
        offset: z.number().int().nonnegative().optional(),
      }),
    },
    async ({ documentId, kind, type, limit, offset }) => {
      try {
        const all = getDocument(documentId).doc.listConstraints({ kind, type });
        const start = offset ?? 0;
        const slice = all.slice(start, start + (limit ?? all.length));
        return text({ total: all.length, offset: start, items: slice });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_constraint_get",
    {
      description: "Get one constraint by kind + index (index is within that kind’s list).",
      inputSchema: z.object({
        documentId: z.string(),
        kind: constraintKindSchema,
        index: z.number().int().nonnegative(),
      }),
    },
    async ({ documentId, kind, index }) => {
      try {
        return text(getDocument(documentId).doc.getConstraint(kind as ConstraintKind, index));
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_constraint_add",
    {
      description:
        "Append a constraint of any catalog type. fields mirror XML children; Weight_Percentage/Active/Comments default to 100/true/\"\" when omitted (except generation options).",
      inputSchema: z.object({
        documentId: z.string(),
        type: z.string(),
        fields: z.record(z.string(), z.unknown()).default({}),
      }),
    },
    async ({ documentId, type, fields }) => {
      try {
        const entry = getDocument(documentId);
        const result = entry.doc.addConstraint(type, fields ?? {});
        touchDocument(documentId);
        return text(result);
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_constraint_update",
    {
      description:
        "Update constraint fields by kind+index. Default merges into existing fields; set replace=true to overwrite all children.",
      inputSchema: z.object({
        documentId: z.string(),
        kind: constraintKindSchema,
        index: z.number().int().nonnegative(),
        fields: z.record(z.string(), z.unknown()),
        replace: z.boolean().optional(),
      }),
    },
    async ({ documentId, kind, index, fields, replace }) => {
      try {
        const entry = getDocument(documentId);
        const result = entry.doc.updateConstraint(kind as ConstraintKind, index, fields, replace ?? false);
        touchDocument(documentId);
        return text(result);
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "fet_constraint_remove",
    {
      description: "Remove a constraint by kind + index.",
      inputSchema: z.object({
        documentId: z.string(),
        kind: constraintKindSchema,
        index: z.number().int().nonnegative(),
      }),
    },
    async ({ documentId, kind, index }) => {
      try {
        const entry = getDocument(documentId);
        const result = entry.doc.removeConstraint(kind as ConstraintKind, index);
        touchDocument(documentId);
        return text(result);
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
