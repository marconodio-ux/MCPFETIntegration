/**
 * Apply accepted advise suggestions onto a workspace FetDocument.
 */

import type { FetDocument } from "../document.js";
import { getConstraintType } from "../catalog.js";
import { getAdviseSession } from "./store.js";
import type { AdviseApplyResult, AdviseConfidence, AdviseSuggestion } from "./types.js";

const CONF_RANK: Record<AdviseConfidence, number> = { high: 3, medium: 2, low: 1 };

function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

function ensureRoom(doc: FetDocument, name: string): boolean {
  const exists = doc.listEntities("rooms").some((r) => asString(r.fields.Name) === name);
  if (exists) return false;
  doc.upsertEntity("rooms", {
    Name: name,
    Building: "",
    Capacity: "30",
    Comments: "advise:auto-created for PreferredRoom",
  });
  return true;
}

function suggestionReady(s: AdviseSuggestion): string | null {
  if (!getConstraintType(s.type)) return `Tipo non in catalogo: ${s.type}`;
  if (s.type === "ConstraintTeacherNotAvailableTimes") {
    const teacher = asString(s.fieldsDraft.Teacher);
    if (!teacher) return "Teacher mancante nei fieldsDraft";
    const n = Number(s.fieldsDraft.Number_of_Not_Available_Times ?? 0);
    if (!n || n < 1) return "Nessuno slot Not_Available_Time compilato";
  }
  if (s.type === "ConstraintSubjectPreferredRoom") {
    if (!asString(s.fieldsDraft.Subject) || !asString(s.fieldsDraft.Room)) {
      return "Subject/Room mancanti";
    }
  }
  if (s.type === "ConstraintActivitiesSameStartingTime") {
    const ids = s.fieldsDraft.Activity_Id;
    const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
    if (list.length < 2) return "Servono almeno 2 Activity_Id";
  }
  if (s.type === "ConstraintMinDaysBetweenActivities") {
    const ids = s.fieldsDraft.Activity_Id;
    const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
    if (list.length < 2) return "Servono almeno 2 Activity_Id";
  }
  return null;
}

function selectSuggestions(
  all: AdviseSuggestion[],
  opts: {
    suggestionIds?: string[];
    allHighConfidence?: boolean;
    minConfidence?: AdviseConfidence;
  },
): { selected: AdviseSuggestion[]; unknownIds: string[] } {
  if (opts.suggestionIds && opts.suggestionIds.length > 0) {
    const want = new Set(opts.suggestionIds);
    const selected = all.filter((s) => want.has(s.id));
    const unknownIds = opts.suggestionIds.filter((id) => !all.some((s) => s.id === id));
    return { selected, unknownIds };
  }
  // No ids: apply all high-confidence by default (or minConfidence floor).
  const floor: AdviseConfidence =
    opts.minConfidence ?? (opts.allHighConfidence === false ? "low" : "high");
  const selected = all.filter((s) => CONF_RANK[s.confidence] >= CONF_RANK[floor]);
  return { selected, unknownIds: [] };
}

/**
 * Apply suggestions from an advise session onto doc.
 */
export function applyAdviseSuggestions(
  doc: FetDocument,
  adviseId: string,
  opts: {
    suggestionIds?: string[];
    allHighConfidence?: boolean;
    minConfidence?: AdviseConfidence;
    documentId: string;
  },
): AdviseApplyResult {
  const session = getAdviseSession(adviseId);
  const { selected, unknownIds } = selectSuggestions(session.suggestions, opts);

  const applied: AdviseApplyResult["applied"] = [];
  const skipped: AdviseApplyResult["skipped"] = [];
  const createdEntities: AdviseApplyResult["createdEntities"] = [];

  for (const id of unknownIds) {
    skipped.push({ id, reason: "id sconosciuto in questa sessione advise" });
  }

  for (const s of selected) {
    const notReady = suggestionReady(s);
    if (notReady) {
      skipped.push({ id: s.id, reason: notReady });
      continue;
    }
    try {
      if (s.createsEntities) {
        for (const ent of s.createsEntities) {
          if (ent.kind === "rooms") {
            if (ensureRoom(doc, ent.name)) {
              createdEntities.push({ kind: "rooms", name: ent.name });
            }
          }
        }
      }
      if (s.type === "ConstraintSubjectPreferredRoom") {
        const room = asString(s.fieldsDraft.Room);
        if (room && ensureRoom(doc, room)) {
          createdEntities.push({ kind: "rooms", name: room });
        }
      }
      const result = doc.addConstraint(s.type, { ...s.fieldsDraft });
      applied.push({ id: s.id, type: s.type, index: result.index });
    } catch (e) {
      skipped.push({
        id: s.id,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const summaryIt =
    applied.length === 0
      ? `Nessun suggerimento applicato${skipped.length ? ` (${skipped.length} saltati)` : ""}.`
      : `Applicati ${applied.length} vincoli consigliati${skipped.length ? `, ${skipped.length} saltati` : ""}. Il file è pronto per fet_generate — l’advisor non genera l’orario.`;

  return {
    ok: true,
    adviseId,
    documentId: opts.documentId,
    applied,
    skipped,
    createdEntities,
    summaryIt,
    noticeIt:
      "I vincoli sono stati scritti nel documento workspace. Usa fet_document_save e poi fet_generate: è FET che produce l’orario.",
  };
}
