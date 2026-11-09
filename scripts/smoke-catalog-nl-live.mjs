/**
 * MFI-11 smoke: every constraint-catalog type is live and round-trips
 * Italian example → parseIt → describe → fromStructured fields.
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
const { loadConstraintCatalog } = await load("fet/catalog.js", "fet/catalog.ts");

const cat = loadConstraintCatalog();
const summary = nl.phraseCatalogSummary();
const report = {
  ok: true,
  errors: [],
  catalogTotal: cat.types.length,
  phraseSummary: summary,
  failed: [],
  modeCaveats: [],
  checked: 0,
};

function fail(msg, type) {
  report.ok = false;
  report.errors.push(msg);
  if (type) report.failed.push({ type, error: msg });
}

if (summary.total !== 358) fail(`Expected 358 phrase templates, got ${summary.total}`);
if (summary.live !== summary.total) {
  fail(`Expected all live, got live=${summary.live} stub=${summary.stub}`);
}
if (summary.sampleMissing.length) {
  fail(`Orario sample missing live: ${summary.sampleMissing.join(", ")}`);
}

for (const info of cat.types) {
  const tpl = nl.getPhraseTemplate(info.type);
  report.checked++;
  if (!tpl) {
    fail(`Missing template ${info.type}`, info.type);
    continue;
  }
  if (tpl.status !== "live") {
    fail(`${info.type} status=${tpl.status}`, info.type);
    continue;
  }
  if (!tpl.examplesIt?.length) {
    fail(`${info.type} has no examplesIt`, info.type);
    continue;
  }

  const example = tpl.examplesIt[0];
  const parsed = tpl.parseIt(example);
  if (!parsed?.fields) {
    // global parser with explicit / bracket forms
    const global = nl.parseConstraintPhrase(example);
    if (!global?.fields || global.type !== info.type) {
      fail(`${info.type} parseIt failed on example`, info.type);
      continue;
    }
  } else {
    const italian = tpl.describe(parsed.fields);
    if (!italian || italian.length < 8) {
      fail(`${info.type} describe too short`, info.type);
      continue;
    }
    const structured = tpl.fromStructured(parsed.fields);
    if (!structured || structured.Weight_Percentage == null) {
      fail(`${info.type} fromStructured missing weight`, info.type);
      continue;
    }
  }

  // Also ensure global parse with type-prefixed example works
  const prefixed = `${info.type}: ${example.includes(":") ? example.split(/:(.+)/s)[1] : example}`;
  const g = nl.parseConstraintPhrase(prefixed);
  if (!g || g.type !== info.type) {
    fail(`${info.type} global parseConstraintPhrase mismatch (got ${g?.type})`, info.type);
    continue;
  }
  if (g.status !== "live") fail(`${info.type} global status not live`, info.type);

  if (info.mode && info.mode !== "tutti") {
    report.modeCaveats.push({ type: info.type, mode: info.mode });
  }
}

// Spot-check Orario natural examples still parse via global matcher
for (const type of summary.sampleTypes) {
  const tpl = nl.getPhraseTemplate(type);
  const example = tpl.examplesIt[0];
  const g = nl.parseConstraintPhrase(example);
  if (!g) fail(`Orario example failed global parse: ${type}`, type);
}

const outDir = path.join(root, "examples", "real");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "catalog-nl-live.summary.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

console.log(
  JSON.stringify(
    {
      ok: report.ok,
      live: summary.live,
      total: summary.total,
      stub: summary.stub,
      failed: report.failed.length,
      modeCaveats: report.modeCaveats.length,
      summaryPath: outPath,
      errors: report.errors.slice(0, 20),
    },
    null,
    2,
  ),
);

if (!report.ok) process.exit(1);
