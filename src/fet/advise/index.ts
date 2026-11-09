/**
 * Intelligent FET constraint advisor.
 * Proposes catalog constraints from document + optional intent text; optional apply into workspace.
 * Does NOT generate the timetable — FET (fet-cl) does.
 */

import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.js";
import { FetDocument } from "../document.js";
import { resolveUnder } from "../paths.js";
import { getDocument, makeDocId, putDocument, touchDocument } from "../workspace.js";
import { applyAdviseSuggestions } from "./apply.js";
import { runAdviseHeuristics } from "./heuristics.js";
import { getAdviseSession, makeAdviseId, putAdviseSession } from "./store.js";
import type { AdviseApplyResult, AdviseConfidence, AdviseResult } from "./types.js";

export * from "./types.js";
export { runAdviseHeuristics } from "./heuristics.js";
export { applyAdviseSuggestions } from "./apply.js";
export { getAdviseSession } from "./store.js";

function resolveInputFile(inputFile: string): string {
  if (path.isAbsolute(inputFile)) return path.normalize(inputFile);
  const fromInput = path.join(PATHS.dataInput, inputFile);
  const fromExamples = path.join(PATHS.examples, inputFile);
  if (fs.existsSync(fromInput)) return fromInput;
  if (fs.existsSync(fromExamples)) return fromExamples;
  return path.resolve(inputFile);
}

function loadDoc(opts: {
  documentId?: string;
  inputFile?: string;
}): { doc: FetDocument; documentId?: string; inputFile?: string } {
  if (opts.documentId) {
    const entry = getDocument(opts.documentId);
    return {
      doc: entry.doc,
      documentId: entry.id,
      inputFile: entry.doc.sourcePath,
    };
  }
  if (opts.inputFile) {
    const file = resolveInputFile(opts.inputFile);
    const doc = FetDocument.loadFile(file);
    return { doc, inputFile: file };
  }
  throw new Error("Provide documentId or inputFile for fet_advise.");
}

export function adviseTimetable(opts: {
  documentId?: string;
  inputFile?: string;
  text?: string;
  limit?: number;
  minConfidence?: AdviseConfidence;
  /** If true (default) and only inputFile given, put doc in workspace for later apply. */
  openInWorkspace?: boolean;
}): AdviseResult {
  const loaded = loadDoc(opts);
  let documentId = loaded.documentId;
  const doc = loaded.doc;

  if (!documentId && opts.openInWorkspace !== false) {
    documentId = makeDocId(
      loaded.inputFile ? path.basename(loaded.inputFile, ".fet") : "advise",
    );
    putDocument(documentId, doc);
  }

  const { suggestions: raw, intentHints } = runAdviseHeuristics(doc, opts.text);
  const min = opts.minConfidence;
  const rank = { high: 3, medium: 2, low: 1 } as const;
  let suggestions = min ? raw.filter((s) => rank[s.confidence] >= rank[min]) : raw;
  const limit = opts.limit ?? 25;
  suggestions = suggestions.slice(0, limit);

  const adviseId = makeAdviseId();
  putAdviseSession({
    adviseId,
    documentId,
    inputFile: loaded.inputFile,
    createdAt: new Date().toISOString(),
    suggestions,
  });

  const summary = doc.summarize();
  const high = suggestions.filter((s) => s.confidence === "high").length;
  const summaryIt =
    suggestions.length === 0
      ? "Nessun vincolo aggiuntivo evidente: il documento sembra già coperto per i pattern scuola IT più comuni."
      : `Trovati ${suggestions.length} suggerimenti (${high} ad alta confidenza). L’advisor propone; FET genera ancora l’orario.`;

  const sumTypes = (m: Record<string, number> | undefined) =>
    Object.values(m ?? {}).reduce((a, b) => a + b, 0);

  return {
    ok: true,
    adviseId,
    documentId,
    inputFile: loaded.inputFile,
    suggestions,
    summaryIt,
    noticeIt:
      "Questi sono consigli su vincoli FET da aggiungere. Non sono l’orario generato: dopo aver applicato (fet_advise_apply) usa fet_generate.",
    analyzed: {
      activities: summary.counts.activities ?? 0,
      teachers: summary.counts.teachers ?? 0,
      subjects: summary.counts.subjects ?? 0,
      rooms: summary.counts.rooms ?? 0,
      timeConstraints: sumTypes(summary.timeConstraintsByType),
      spaceConstraints: sumTypes(summary.spaceConstraintsByType),
      intentHints,
    },
  };
}

export function adviseApply(opts: {
  adviseId: string;
  documentId?: string;
  suggestionIds?: string[];
  allHighConfidence?: boolean;
  minConfidence?: AdviseConfidence;
  savePath?: string;
}): AdviseApplyResult & { saved?: string } {
  const session = getAdviseSession(opts.adviseId);
  const documentId = opts.documentId ?? session.documentId;
  if (!documentId) {
    throw new Error(
      "documentId mancante: riapri il .fet con fet_document_open / fet_advise (che apre in workspace) e riprova.",
    );
  }
  const entry = getDocument(documentId);
  const result = applyAdviseSuggestions(entry.doc, opts.adviseId, {
    suggestionIds: opts.suggestionIds,
    allHighConfidence: opts.allHighConfidence,
    minConfidence: opts.minConfidence,
    documentId,
  });
  touchDocument(documentId);

  let saved: string | undefined;
  if (opts.savePath) {
    const dest = path.isAbsolute(opts.savePath)
      ? path.normalize(opts.savePath)
      : resolveUnder(PATHS.examples, opts.savePath);
    entry.doc.saveFile(dest);
    saved = dest;
  }

  return { ...result, saved };
}
