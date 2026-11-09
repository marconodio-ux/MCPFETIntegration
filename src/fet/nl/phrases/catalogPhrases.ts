/**
 * Phrase catalog: schema-driven live NL for all 358 constraint types +
 * hand-tuned overlay for common school sample types.
 */

import { loadConstraintCatalog } from "../../catalog.js";
import { asString } from "./helpers.js";
import { SAMPLE_LIVE_TEMPLATES } from "./sampleLive.js";
import { buildAllSchemaLiveTemplates } from "./schemaLive.js";
import {
  PRIORITY_SAMPLE_TYPES,
  type PhraseCatalogSummary,
  type PhraseTemplate,
} from "./types.js";

let cached: Map<string, PhraseTemplate> | null = null;
let cachedList: PhraseTemplate[] | null = null;

function buildCatalog(): Map<string, PhraseTemplate> {
  const cat = loadConstraintCatalog();
  const map = new Map<string, PhraseTemplate>();
  for (const live of buildAllSchemaLiveTemplates(cat.types)) {
    map.set(live.type, live);
  }
  // Hand-tuned Orario sample phrases win over generic schema live.
  for (const live of SAMPLE_LIVE_TEMPLATES) {
    const prev = map.get(live.type);
    map.set(live.type, {
      ...live,
      family: live.family ?? prev?.family,
      mode: live.mode ?? prev?.mode,
      descriptionIt: live.descriptionIt || prev?.descriptionIt || live.type,
    });
  }
  return map;
}

export function getPhraseMap(): Map<string, PhraseTemplate> {
  if (!cached) cached = buildCatalog();
  return cached;
}

export function listPhraseTemplates(filter?: {
  status?: "live" | "stub";
  kind?: "time" | "space" | "generation_option";
  q?: string;
  sampleOnly?: boolean;
}): PhraseTemplate[] {
  if (!cachedList) cachedList = [...getPhraseMap().values()];
  const q = filter?.q?.toLowerCase();
  return cachedList.filter((t) => {
    if (filter?.status && t.status !== filter.status) return false;
    if (filter?.kind && t.kind !== filter.kind) return false;
    if (filter?.sampleOnly && !(PRIORITY_SAMPLE_TYPES as readonly string[]).includes(t.type)) {
      return false;
    }
    if (q) {
      const hay = `${t.type} ${t.descriptionIt} ${t.family ?? ""} ${t.examplesIt.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function getPhraseTemplate(type: string): PhraseTemplate | undefined {
  return getPhraseMap().get(type);
}

export function phraseCatalogSummary(): PhraseCatalogSummary {
  const all = listPhraseTemplates();
  const live = all.filter((t) => t.status === "live");
  const sampleTypes = [...PRIORITY_SAMPLE_TYPES];
  const sampleMissing = sampleTypes.filter((t) => getPhraseTemplate(t)?.status !== "live");
  return {
    total: all.length,
    live: live.length,
    stub: all.length - live.length,
    sampleTypes,
    sampleLive: sampleTypes.length - sampleMissing.length,
    sampleMissing,
  };
}

/**
 * Try all live parsers (sample-first), return best match.
 */
export function parseConstraintPhrase(text: string): {
  type: string;
  fields: Record<string, unknown>;
  confidence: number;
  notes?: string[];
  status: "live" | "stub";
} | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Explicit type prefix: "ConstraintX: ..." or "tipo ConstraintX ..."
  const explicit = trimmed.match(
    /^(?:tipo\s+)?(Constraint[A-Za-z0-9_]+|GroupActivitiesInInitialOrder)\s*[:\-–]\s*([\s\S]+)$/i,
  );
  if (explicit) {
    const type = explicit[1]!;
    const rest = explicit[2]!;
    const tpl = getPhraseTemplate(type);
    if (tpl) {
      const parsed = tpl.parseIt(`${type}: ${rest}`) ?? tpl.parseIt(trimmed) ?? tpl.parseIt(rest);
      if (parsed) {
        return {
          type,
          fields: parsed.fields,
          confidence: Math.max(parsed.confidence, 0.9),
          notes: parsed.notes,
          status: tpl.status,
        };
      }
      const fields = tpl.fromStructured(parseLooseKv(rest));
      return {
        type,
        fields,
        confidence: 0.55,
        status: tpl.status,
        notes: ["Parsed via structured/KV fallback."],
      };
    }
  }

  // Bracket anchor: ... [ConstraintX]: ...
  const bracket = trimmed.match(/\[(Constraint[A-Za-z0-9_]+|GroupActivitiesInInitialOrder)\]/i);
  if (bracket) {
    const type = bracket[1]!;
    const tpl = getPhraseTemplate(type);
    if (tpl) {
      const parsed = tpl.parseIt(trimmed);
      if (parsed) {
        return {
          type,
          fields: parsed.fields,
          confidence: parsed.confidence,
          notes: parsed.notes,
          status: tpl.status,
        };
      }
    }
  }

  let best: {
    type: string;
    fields: Record<string, unknown>;
    confidence: number;
    notes?: string[];
    status: "live" | "stub";
  } | null = null;

  // Prefer hand-tuned sample live templates first (natural Italian), then the rest.
  const sampleSet = new Set<string>(PRIORITY_SAMPLE_TYPES as readonly string[]);
  const liveAll = listPhraseTemplates({ status: "live" });
  const liveFirst = [
    ...liveAll.filter((t) => sampleSet.has(t.type)),
    ...liveAll.filter((t) => !sampleSet.has(t.type)),
  ];
  for (const tpl of liveFirst) {
    const parsed = tpl.parseIt(trimmed);
    if (!parsed) continue;
    if (!best || parsed.confidence > best.confidence) {
      best = {
        type: tpl.type,
        fields: parsed.fields,
        confidence: parsed.confidence,
        notes: parsed.notes,
        status: tpl.status,
      };
    }
  }
  return best && best.confidence >= 0.35 ? best : null;
}

function parseLooseKv(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const part of text.split(/[;,\n]+/)) {
    const m = part.match(/^\s*([A-Za-z_][\w]*)\s*[=:]\s*(.+?)\s*$/);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  if (!Object.keys(out).length && text.trim()) {
    out.Comments = text.trim();
  }
  return out;
}

export function describeConstraintInstance(
  type: string,
  fields: Record<string, unknown>,
): { italian: string; status: "live" | "stub"; descriptionIt: string } {
  const tpl = getPhraseTemplate(type);
  if (!tpl) {
    return {
      italian: `Vincolo sconosciuto ${type}: ${asString(JSON.stringify(fields)).slice(0, 200)}`,
      status: "stub",
      descriptionIt: type,
    };
  }
  return {
    italian: tpl.describe(fields),
    status: tpl.status,
    descriptionIt: tpl.descriptionIt,
  };
}

/** Reset cache (tests). */
export function resetPhraseCatalogCache(): void {
  cached = null;
  cachedList = null;
}
