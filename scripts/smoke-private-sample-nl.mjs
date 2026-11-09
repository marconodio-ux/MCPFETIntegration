/**
 * Local-only smoke: private institute .fet outside the git repo →
 * extract → describe → rebuild/patch one instance per present type.
 * Never reads paths inside the published repository tree.
 *
 * Discovery:
 *   1) MCPFET_PRIVATE_FET = absolute path to a .fet, or
 *   2) MCPFET_PRIVATE_DIR = folder containing one or more .fet (picks first non-roundtrip)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function load(relBuild, relSrc) {
  const b = path.join(root, "build", relBuild);
  const s = path.join(root, "src", relSrc);
  return import(pathToFileURL(fs.existsSync(b) ? b : s).href);
}

const nl = await load("fet/nl/index.js", "fet/nl/index.ts");
const { FetDocument } = await load("fet/document.js", "fet/document.ts");
const config = await load("config.js", "config.ts");

function pickFetInDir(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const named = process.env.MCPFET_PRIVATE_FET?.trim();
  if (named) {
    const p = path.isAbsolute(named) ? named : path.join(dir, named);
    if (fs.existsSync(p)) return p;
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.fet$/i.test(f) && !/roundtrip/i.test(f))
    .sort();
  return files.length ? path.join(dir, files[0]) : null;
}

const envFet = process.env.MCPFET_PRIVATE_FET?.trim();
const samplePath = (() => {
  if (envFet && path.isAbsolute(envFet) && fs.existsSync(envFet)) return envFet;
  const dirs = [process.env.MCPFET_PRIVATE_DIR?.trim()].filter(Boolean);
  for (const dir of dirs) {
    const hit = pickFetInDir(dir);
    if (hit) return hit;
  }
  return null;
})();
const outDir = samplePath
  ? path.dirname(samplePath)
  : process.env.MCPFET_PRIVATE_DIR?.trim() || root;
const outFet = path.join(outDir, "private-sample-nl-roundtrip.fet");
const outSummary = path.join(outDir, "private-sample-nl-roundtrip.summary.json");

if (!samplePath || !fs.existsSync(samplePath)) {
  console.warn(
    "Skip smoke:private-sample — no local-only sample found.",
    "Set MCPFET_PRIVATE_DIR (folder outside the repo) and/or MCPFET_PRIVATE_FET.",
  );
  process.exit(0);
}

const doc = FetDocument.loadFile(samplePath);
const extracted = nl.extractFromDocument(doc);

const report = {
  ok: true,
  errors: [],
  samplePath,
  meta: extracted.meta,
  entities: extracted.entities,
  constraintsByType: extracted.constraintsByType,
  coverage: extracted.coverage,
  notes: extracted.notes,
  phraseCatalog: extracted.coverage.phraseCatalog,
  describeSpotChecks: [],
  parseSpotChecks: [],
  roundTrip: {},
  generate: null,
};

function fail(msg) {
  report.ok = false;
  report.errors.push(msg);
}

// 1) Sample types 100% live
if (extracted.coverage.sampleTypesMissingLive.length) {
  fail(`Sample types not live: ${extracted.coverage.sampleTypesMissingLive.join(", ")}`);
}
if (!extracted.coverage.allPresentTypesLive) {
  fail("Not all present constraint types have live phrase handlers");
}
if (extracted.coverage.phraseCatalog.total < 350) {
  fail(`Expected ~358 catalog phrases, got ${extracted.coverage.phraseCatalog.total}`);
}

// 2) Describe every type present
for (const type of extracted.coverage.typesPresent) {
  const inst = extracted.constraints.find((c) => c.type === type);
  if (!inst) {
    fail(`No instance for type ${type}`);
    continue;
  }
  if (inst.phraseStatus !== "live") fail(`Describe not live for ${type}`);
  if (!inst.italian || inst.italian.length < 8) fail(`Empty italian for ${type}`);
  report.describeSpotChecks.push({ type, italian: inst.italian.slice(0, 160), status: inst.phraseStatus });
}

// 3) Parse Italian examples for each sample type (use template examples + digest)
const templates = nl.listPhraseTemplates({ sampleOnly: true, status: "live" });
for (const tpl of templates) {
  const example = tpl.examplesIt[0];
  const parsed = nl.parseConstraintPhrase(example);
  report.parseSpotChecks.push({
    type: tpl.type,
    example: example.slice(0, 100),
    parsedType: parsed?.type ?? null,
    confidence: parsed?.confidence ?? 0,
  });
  // Soft check: prefer matching type; some examples may collide — require some parse
  if (!parsed) {
    // try describe→reparse via italian from first instance
    const inst = extracted.constraints.find((c) => c.type === tpl.type);
    const again = inst ? nl.parseConstraintPhrase(inst.italian) : null;
    if (!again) fail(`Could not parse NL for ${tpl.type}`);
  }
}

// 4) Round-trip subset: open → extract → patch descriptive phrases for ALL types onto a copy
//    Keep entities; replace constraints for types with 1 synthetic from Italian where possible,
//    else re-add one extracted instance via fromStructured.
const work = FetDocument.loadFile(samplePath);
const beforeSummary = work.summarize();

// Remove ALL constraints then re-add BasicCompulsory + one of each type from NL/extract
for (const kind of ["time", "space", "generation_option"]) {
  let list = work.listConstraints({ kind });
  while (list.length) {
    work.removeConstraint(kind, list.length - 1);
    list = work.listConstraints({ kind });
  }
}

const rebuildNotes = [];
const types = extracted.coverage.typesPresent;
const specs = [];

for (const type of types) {
  const tpl = nl.getPhraseTemplate(type);
  const inst = extracted.constraints.find((c) => c.type === type);
  if (!tpl || !inst) {
    fail(`Missing template/instance for ${type}`);
    continue;
  }

  // Prefer Italian example → parse; fallback to structured fields from extract
  let fields = null;
  let via = "extract-fields";
  for (const ex of tpl.examplesIt) {
    const p = nl.parseConstraintPhrase(ex);
    if (p && p.type === type && p.confidence >= 0.45) {
      fields = p.fields;
      via = "example-parse";
      break;
    }
  }
  if (!fields) {
    const p2 = nl.parseConstraintPhrase(inst.italian);
    if (p2 && p2.type === type) {
      fields = p2.fields;
      via = "italian-parse";
    }
  }
  if (!fields) {
    fields = tpl.fromStructured(inst.fields);
    via = "fromStructured";
  }

  // Solution locks: keep Active=false preferred starting times as inactive when re-adding from extract
  if (type === "ConstraintActivityPreferredStartingTime" && inst.solutionLockArtifact) {
    fields = { ...fields, Active: "false", Permanently_Locked: "true" };
    via += "+inactive-lock";
  }

  specs.push({ type, fields, italian: inst.italian, source: `smoke:${via}` });
  rebuildNotes.push({ type, via });
}

const assumptions = [];
const gaps = [];
const applied = nl.applyNlConstraints(work, specs, assumptions, gaps);
if (gaps.length) {
  fail(`applyNlConstraints gaps: ${JSON.stringify(gaps)}`);
}

const after = work.summarize();
work.saveFile(outFet);

// Coherence: entities unchanged counts; each type present at least once
for (const key of ["teachers", "subjects", "activities", "rooms", "students", "days", "hours"]) {
  if ((after.counts[key] ?? 0) !== (beforeSummary.counts[key] ?? 0)) {
    fail(`Entity count drift for ${key}: ${beforeSummary.counts[key]} → ${after.counts[key]}`);
  }
}
for (const type of types) {
  const n =
    (after.timeConstraintsByType[type] ?? 0) + (after.spaceConstraintsByType[type] ?? 0);
  if (n < 1) fail(`Round-trip missing type ${type}`);
}

const reExtract = nl.extractFromDocument(work);
if (!reExtract.coverage.allPresentTypesLive) {
  fail("Re-extract coverage not fully live");
}

report.roundTrip = {
  saved: outFet,
  appliedCount: applied.length,
  rebuildNotes,
  beforeConstraintTypes: Object.keys(beforeSummary.timeConstraintsByType).length +
    Object.keys(beforeSummary.spaceConstraintsByType).length,
  afterTime: after.timeConstraintsByType,
  afterSpace: after.spaceConstraintsByType,
  entityCounts: after.counts,
  reExtractTypes: reExtract.coverage.typesPresent,
};

// 5) Optional fet-cl probe (short time limit) — inactive locks should not block start
const fetCl = config.resolveFetClPath();
const fetClExists =
  fs.existsSync(fetCl) ||
  fs.existsSync(path.join(config.PATHS.vendorBin, "fet-cl.exe"));
if (fetClExists) {
  try {
    const { runFetGenerate } = await load("fet/runner.js", "fet/runner.ts");
    // Use original sample with a short limit — just prove parse/start; do not require full solve
    const gen = await runFetGenerate({
      inputFile: samplePath,
      jobId: "smoke-private-sample",
      timeLimitSeconds: 5,
      wait: true,
      htmlLevel: 0,
    });
    report.generate = {
      attempted: true,
      status: gen.job.status,
      exitCode: gen.job.exitCode,
      note: "Short time-limit probe on original sample; full solve not required for smoke.",
    };
  } catch (e) {
    report.generate = {
      attempted: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }
} else {
  report.generate = { attempted: false, reason: "fet-cl not found" };
}

fs.writeFileSync(outSummary, JSON.stringify(report, null, 2), "utf8");

if (!report.ok) {
  console.error("SMOKE FAIL", report.errors);
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log("SMOKE OK private-sample NL coverage");
console.log(
  JSON.stringify(
    {
      entities: report.entities,
      types: report.coverage.typesPresent.length,
      phraseCatalog: report.phraseCatalog,
      roundTripSaved: outFet,
      generate: report.generate,
    },
    null,
    2,
  ),
);
