/**
 * Generate src/fet/catalog/constraint-catalog.json from FET 7.12 headers +
 * getXmlDescription bodies (+ optional docs/fet-configurable-features.md metadata).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eng = path.join(root, "vendor", "fet-src", "fet-7.12.0", "src", "engine");

function classNames(file) {
  const text = fs.readFileSync(path.join(eng, file), "utf8");
  const re = /^class (Constraint\w+)\b/gm;
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

function extractSchemas(cppFile, kinds) {
  const text = fs.readFileSync(path.join(eng, cppFile), "utf8");
  const schemas = {};
  for (const kind of kinds) {
    const needle = `${kind}::getXmlDescription`;
    const idx = text.indexOf(needle);
    if (idx < 0) {
      schemas[kind] = { fields: [], containers: [], allTags: [], note: "getXmlDescription not found" };
      continue;
    }
    let end = text.indexOf("::getXmlDescription", idx + needle.length);
    if (end < 0) end = Math.min(text.length, idx + 12000);
    const desc = text.indexOf(`${kind}::getDescription`, idx + needle.length);
    if (desc > idx && desc < end) end = desc;
    const body = text.slice(idx, end);
    const tags = new Set();
    const containers = new Set();
    const tagRe = /<([A-Za-z][A-Za-z0-9_]*)>/g;
    let tm;
    while ((tm = tagRe.exec(body))) {
      const t = tm[1];
      if (t !== kind) tags.add(t);
    }
    const nestRe = /"<([A-Za-z][A-Za-z0-9_]*)>\\n"/g;
    while ((tm = nestRe.exec(body))) {
      if (tm[1] !== kind) containers.add(tm[1]);
    }
    schemas[kind] = {
      fields: [...tags],
      containers: [...containers],
      allTags: [...tags],
    };
  }
  return schemas;
}

const time = classNames("timeconstraint.h");
const space = classNames("spaceconstraint.h");
const timeSchemas = extractSchemas("timeconstraint.cpp", time);
const spaceSchemas = extractSchemas("spaceconstraint.cpp", space);

const catPath = path.join(root, "docs", "fet-configurable-features.md");
const cat = fs.existsSync(catPath) ? fs.readFileSync(catPath, "utf8") : "";
const meta = {};
const rowRe = /^\| `(Constraint[A-Za-z0-9_]+)` \| ([^|]+) \| ([^|]+) \|/gm;
let rm;
while ((rm = rowRe.exec(cat))) {
  meta[rm[1]] = { descriptionIt: rm[2].trim(), mode: rm[3].trim() };
}
let currentFamily = "unknown";
let currentKind = "time";
for (const line of cat.split(/\n/)) {
  if (/^## 4\./.test(line)) currentKind = "time";
  if (/^## 5\./.test(line)) currentKind = "space";
  if (/^### /.test(line)) currentFamily = line.replace(/^###\s+/, "").trim();
  const m = line.match(/^\| `(Constraint[A-Za-z0-9_]+)`/);
  if (m && meta[m[1]]) {
    meta[m[1]].family = currentFamily;
    meta[m[1]].kind = currentKind;
  }
}

const types = [];
for (const t of time) {
  types.push({ type: t, kind: "time", ...(meta[t] || {}), schema: timeSchemas[t] });
}
for (const t of space) {
  types.push({ type: t, kind: "space", ...(meta[t] || {}), schema: spaceSchemas[t] });
}
types.push({
  type: "GroupActivitiesInInitialOrder",
  kind: "generation_option",
  descriptionIt: "ordine iniziale gruppo attività (heuristica)",
  mode: "tutti",
  family: "Timetable generation options",
  schema: {
    fields: ["Number_of_Activities", "Activity_Id", "Active", "Comments"],
    containers: [],
    allTags: ["Number_of_Activities", "Activity_Id", "Active", "Comments"],
  },
});

const outDir = path.join(root, "src", "fet", "catalog");
fs.mkdirSync(outDir, { recursive: true });
const payload = {
  fetVersion: "7.12.0",
  generatedFrom: [
    "vendor/fet-src/fet-7.12.0/src/engine/timeconstraint.h",
    "vendor/fet-src/fet-7.12.0/src/engine/spaceconstraint.h",
    "getXmlDescription in *.cpp",
    "docs/fet-configurable-features.md (labels/mode/family when present)",
  ],
  counts: {
    time: time.length,
    space: space.length,
    generationOptions: 1,
    total: types.length,
  },
  types,
};
fs.writeFileSync(path.join(outDir, "constraint-catalog.json"), JSON.stringify(payload, null, 2));
console.log(
  JSON.stringify(
    {
      written: path.join(outDir, "constraint-catalog.json"),
      time: time.length,
      space: space.length,
      total: types.length,
      withMeta: types.filter((t) => t.descriptionIt).length,
    },
    null,
    2,
  ),
);
