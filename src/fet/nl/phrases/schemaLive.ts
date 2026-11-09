/**
 * Schema-driven live NL for every FET constraint type in constraint-catalog.json.
 * Generates Italian example ↔ parseIt ↔ describe ↔ fromStructured from XML field schemas.
 * Hand-tuned Orario sample templates (sampleLive.ts) overlay these for higher quality.
 */

import type { ConstraintTypeInfo } from "../../catalog.js";
import type { PhraseParseResult, PhraseTemplate } from "./types.js";
import {
  activeLabel,
  asBool,
  asBoolStr,
  asString,
  asStringList,
  baseFields,
  capitalizeDay,
  formatDayHours,
  normalizeHourToken,
  parseDayHourPairs,
  weightOf,
  type DayHour,
} from "./helpers.js";

const META = new Set(["Weight_Percentage", "Active", "Comments"]);
const NESTED_CHILD = new Set(["Day", "Hour", "int"]);

const DAY_HOUR_CONTAINERS = new Set([
  "Break_Time",
  "Not_Available_Time",
  "Preferred_Time_Slot",
  "Preferred_Starting_Time",
  "Selected_Time_Slot",
  "Selected_Time_Slot_in_First_Set",
  "Selected_Time_Slot_in_Second_Set",
  "First_Time_Slot",
  "Second_Time_Slot",
  "Exception_Time_Slot",
]);

const BOOL_FIELDS = new Set([
  "Allow_Afternoon_Morning_Afternoon_Morning_Exception",
  "Allow_Empty_Afternoons",
  "Allow_Empty_Days",
  "Allow_Empty_Mornings",
  "Allow_Empty_Slots",
  "Allow_Empty_Terms",
  "Allow_One_Day_Exception_of_Plus_One",
  "Circular",
  "Consecutive_If_Same_Day",
  "Permanently_Locked",
  "Keep_Same_Room_In_A_Building",
]);

const IT_FIELD_LABEL: Record<string, string> = {
  Teacher: "docente",
  Students: "studenti",
  Subject: "materia",
  Room: "aula",
  Building: "edificio",
  Activity_Id: "attività",
  Activity_Tag: "chiave attività",
  First_Activity_Id: "prima attività",
  Second_Activity_Id: "seconda attività",
  Third_Activity_Id: "terza attività",
  First_Activity_Tag: "prima chiave",
  Second_Activity_Tag: "seconda chiave",
  Preferred_Room: "aule preferite",
  Real_Room: "aula reale",
  Max_Gaps: "buchi max",
  MinGaps: "buchi min",
  MaxGaps: "buchi max",
  MinDays: "giorni min",
  MaxDays: "giorni max",
  Maximum_Hours_Daily: "ore max/giorno",
  Minimum_Hours_Daily: "ore min/giorno",
  Maximum_Hours_Continuously: "ore max consecutive",
  Max_Days_Per_Week: "giorni max/settimana",
  Minimum_Days_Per_Week: "giorni min/settimana",
  Interval_Start_Hour: "ora inizio intervallo",
  Interval_End_Hour: "ora fine intervallo",
  Interval_Start_Day: "giorno inizio intervallo",
  Interval_End_Day: "giorno fine intervallo",
  Duration: "durata",
  Component_Number: "componente",
};

const DEMO_SLOT: DayHour = { Day: "Lunedì", Hour: "1^A ORA" };
const DEMO_SLOT_B: DayHour = { Day: "Martedì", Hour: "2^A ORA" };

function isCountField(name: string): boolean {
  return /^Number_of_/.test(name);
}

function demoScalar(field: string): string {
  switch (field) {
    case "Teacher":
      return "Rossi";
    case "Students":
      return "3A";
    case "Subject":
      return "Matematica";
    case "Room":
    case "Real_Room":
      return "Aula1";
    case "Building":
      return "PlessoA";
    case "Activity_Tag":
    case "First_Activity_Tag":
      return "Lab";
    case "Second_Activity_Tag":
      return "Teoria";
    case "Activity_Id":
    case "First_Activity_Id":
      return "10";
    case "Second_Activity_Id":
      return "11";
    case "Third_Activity_Id":
      return "12";
    case "Preferred_Room":
      return "Aula1";
    case "Interval_Start_Hour":
      return "1^A ORA";
    case "Interval_End_Hour":
      return "4^A ORA";
    case "Interval_Start_Day":
      return "Lunedì";
    case "Interval_End_Day":
      return "Venerdì";
    case "Component_Number":
      return "1";
    case "Duration":
      return "2";
    default:
      if (BOOL_FIELDS.has(field)) return "true";
      if (/Min|Minimum/.test(field)) return "1";
      if (/Max|Maximum/.test(field)) return "2";
      if (/Hour|Day|Gap|Span|Term|Occup|Tag|Room|Building|Activity|Resting|Beginning/i.test(field)) {
        return "2";
      }
      return "1";
  }
}

function listItemField(countField: string): string | null {
  // Number_of_X → X (singular heuristics used by FET XML)
  const map: Record<string, string> = {
    Number_of_Activities: "Activity_Id",
    Number_of_Activity_Tags: "Activity_Tag",
    Number_of_Preferred_Rooms: "Preferred_Room",
    Number_of_Break_Times: "Break_Time",
    Number_of_Not_Available_Times: "Not_Available_Time",
    Number_of_Preferred_Starting_Times: "Preferred_Starting_Time",
    Number_of_Preferred_Time_Slots: "Preferred_Time_Slot",
    Number_of_Selected_Time_Slots: "Selected_Time_Slot",
    Number_of_Selected_Time_Slots_in_First_Set: "Selected_Time_Slot_in_First_Set",
    Number_of_Selected_Time_Slots_in_Second_Set: "Selected_Time_Slot_in_Second_Set",
    Number_of_Exception_Time_Slots: "Exception_Time_Slot",
    Number_of_Selected_Sets_of_Time_Slots: "Selected_Set_of_Time_Slots",
  };
  if (map[countField]) return map[countField];
  const rest = countField.replace(/^Number_of_/, "");
  // Preferred_Rooms → Preferred_Room already mapped; generic strip trailing s
  if (rest.endsWith("ies")) return rest.slice(0, -3) + "y";
  if (rest.endsWith("s")) return rest.slice(0, -1);
  return rest;
}

function buildDemoFields(info: ConstraintTypeInfo): Record<string, unknown> {
  const fields = info.schema.fields.filter((f) => !META.has(f) && !NESTED_CHILD.has(f));
  const containers = new Set(info.schema.containers ?? []);
  const out: Record<string, unknown> = {};
  const handled = new Set<string>();

  // Activity id sets (nested)
  if (containers.has("First_Activities_Ids_Set") || fields.includes("First_Activities_Ids_Set")) {
    out.First_Activities_Ids_Set = {
      Number_of_Activities: "2",
      Activity_Id: ["10", "11"],
    };
    handled.add("First_Activities_Ids_Set");
  }
  if (containers.has("Second_Activities_Ids_Set") || fields.includes("Second_Activities_Ids_Set")) {
    out.Second_Activities_Ids_Set = {
      Number_of_Activities: "2",
      Activity_Id: ["20", "21"],
    };
    handled.add("Second_Activities_Ids_Set");
  }

  // Selected sets of time slots (nested)
  if (
    containers.has("Selected_Set_of_Time_Slots") ||
    fields.includes("Selected_Set_of_Time_Slots")
  ) {
    out.Selected_Set_of_Time_Slots = [
      {
        Number_of_Selected_Time_Slots: "1",
        Selected_Time_Slot: [DEMO_SLOT],
      },
      {
        Number_of_Selected_Time_Slots: "1",
        Selected_Time_Slot: [DEMO_SLOT_B],
      },
    ];
    out.Number_of_Selected_Sets_of_Time_Slots = "2";
    handled.add("Selected_Set_of_Time_Slots");
    handled.add("Number_of_Selected_Sets_of_Time_Slots");
    handled.add("Number_of_Selected_Time_Slots");
    handled.add("Selected_Time_Slot");
  }

  for (const f of fields) {
    if (handled.has(f)) continue;
    if (isCountField(f)) {
      const item = listItemField(f);
      if (!item || handled.has(item)) {
        // count filled when list is built
        continue;
      }
      if (DAY_HOUR_CONTAINERS.has(item) || containers.has(item)) {
        const slots = [DEMO_SLOT, DEMO_SLOT_B];
        out[item] = slots;
        out[f] = String(slots.length);
        handled.add(item);
        handled.add(f);
        continue;
      }
      if (item === "Activity_Id") {
        const ids = ["10", "11"];
        out.Activity_Id = ids;
        out[f] = String(ids.length);
        handled.add("Activity_Id");
        handled.add(f);
        continue;
      }
      if (item === "Activity_Tag") {
        const tags = ["Lab", "Teoria"];
        out.Activity_Tag = tags;
        out[f] = String(tags.length);
        handled.add("Activity_Tag");
        handled.add(f);
        continue;
      }
      if (item === "Preferred_Room") {
        const rooms = ["Aula1", "Aula2"];
        out.Preferred_Room = rooms;
        out[f] = String(rooms.length);
        handled.add("Preferred_Room");
        handled.add(f);
        continue;
      }
      // generic count left for later if item appears alone
      continue;
    }

    if (DAY_HOUR_CONTAINERS.has(f) || containers.has(f)) {
      if (handled.has(f)) continue;
      const slots = [DEMO_SLOT];
      out[f] = slots;
      const countName = [...fields].find(
        (c) => isCountField(c) && listItemField(c) === f,
      );
      if (countName) {
        out[countName] = String(slots.length);
        handled.add(countName);
      }
      handled.add(f);
      continue;
    }

    if (f === "Activity_Id" && !handled.has(f)) {
      // single Activity_Id (no Number_of_Activities)
      if (!fields.includes("Number_of_Activities")) {
        out.Activity_Id = "10";
        handled.add(f);
        continue;
      }
    }

    if (f === "Preferred_Room" && !handled.has(f)) {
      out.Preferred_Room = ["Aula1"];
      if (fields.includes("Number_of_Preferred_Rooms")) {
        out.Number_of_Preferred_Rooms = "1";
        handled.add("Number_of_Preferred_Rooms");
      }
      handled.add(f);
      continue;
    }

    if (!handled.has(f)) {
      out[f] = demoScalar(f);
      handled.add(f);
    }
  }

  // Fill any remaining count fields from their lists
  for (const f of fields) {
    if (!isCountField(f) || out[f] != null) continue;
    const item = listItemField(f);
    if (!item) {
      out[f] = "0";
      continue;
    }
    const raw = out[item];
    if (Array.isArray(raw)) out[f] = String(raw.length);
    else if (raw != null && raw !== "") out[f] = "1";
    else out[f] = "0";
  }

  return baseFields({}, out);
}

function formatFieldValue(v: unknown): string {
  if (Array.isArray(v)) {
    if (
      v.length &&
      typeof v[0] === "object" &&
      v[0] &&
      ("Day" in (v[0] as object) || "Hour" in (v[0] as object))
    ) {
      return formatDayHours(v as DayHour[]);
    }
    return v.map((x) => formatFieldValue(x)).join(",");
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.Activity_Id) {
      const ids = asStringList(o.Activity_Id);
      return `[${ids.join(",")}]`;
    }
    if (o.Selected_Time_Slot) {
      return formatDayHours(
        Array.isArray(o.Selected_Time_Slot)
          ? (o.Selected_Time_Slot as DayHour[])
          : [o.Selected_Time_Slot as DayHour],
      );
    }
    return JSON.stringify(v);
  }
  return asString(v);
}

function serializeExtras(fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).filter((k) => !META.has(k));
  return keys.map((k) => `${k}=${formatFieldValue(fields[k])}`).join("; ");
}

function modeCaveat(mode?: string): string | undefined {
  if (!mode || mode === "tutti") return undefined;
  if (mode === "MA") {
    return "Mode FET: MA (mattina/pomeriggio) — validazione completa richiede modalità mornings/afternoons.";
  }
  if (/Terms/i.test(mode)) {
    return "Mode FET: Terms — validazione completa richiede modalità a trimestri/periodi.";
  }
  return `Mode FET: ${mode} — rare mode caveat; NL field-faithful anyway.`;
}

function parseKvSegment(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // split on ; but keep commas inside values
  for (const part of text.split(/;/)) {
    const m = part.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1]!;
    let raw = m[2]!.trim();
    if (/^peso\s+/i.test(key)) continue;
    const peso = text.match(/peso\s+(\d+)\s*%/i);
    if (peso) out.Weight_Percentage = peso[1];

    if (DAY_HOUR_CONTAINERS.has(key) || /Time_Slot|Break_Time|Not_Available/.test(key)) {
      const slots = parseDayHourPairs(raw);
      if (slots.length) {
        out[key] = slots;
        continue;
      }
      // "Lunedì/1^A ORA, Martedì/2^A ORA"
      const alt: DayHour[] = [];
      for (const bit of raw.split(/[,|]+/)) {
        const dm = bit.match(
          /(lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica)\s*[\/ ]\s*(.+)/i,
        );
        if (dm) {
          alt.push({ Day: capitalizeDay(dm[1]!), Hour: normalizeHourToken(dm[2]!) });
        }
      }
      if (alt.length) {
        out[key] = alt;
        continue;
      }
    }

    if (/^\[.*\]$/.test(raw)) {
      raw = raw.slice(1, -1);
      out[key] = raw.split(/[,|]/).map((x) => x.trim()).filter(Boolean);
      continue;
    }
    if (key === "Activity_Id" || key === "Activity_Tag" || key === "Preferred_Room") {
      if (raw.includes(",")) {
        out[key] = raw.split(/[,|]/).map((x) => x.trim()).filter(Boolean);
        continue;
      }
    }
    if (BOOL_FIELDS.has(key)) {
      out[key] = asBoolStr(raw);
      continue;
    }
    out[key] = raw;
  }
  const peso = text.match(/peso\s+(\d+)\s*%/i);
  if (peso) out.Weight_Percentage = peso[1];
  if (/inattiv|active\s*=\s*false/i.test(text)) out.Active = "false";
  return out;
}

function normalizeFromSchema(
  info: ConstraintTypeInfo,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const known = new Set(info.schema.fields);
  const containers = new Set(info.schema.containers ?? []);
  const extras: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(input)) {
    if (META.has(k) || k === "weight" || k === "type") continue;
    if (known.size === 0 || known.has(k) || containers.has(k) || !/^[a-z]/.test(k)) {
      extras[k] = v;
    }
  }

  // aliases
  if (input.teacher && extras.Teacher == null) extras.Teacher = input.teacher;
  if (input.subject && extras.Subject == null) extras.Subject = input.subject;
  if (input.room && extras.Room == null) extras.Room = input.room;
  if (input.students && extras.Students == null) extras.Students = input.students;
  if (input.building && extras.Building == null) extras.Building = input.building;

  // sync counts from lists
  for (const f of info.schema.fields) {
    if (!isCountField(f)) continue;
    const item = listItemField(f);
    if (!item) continue;
    const raw = extras[item] ?? input[item];
    if (Array.isArray(raw)) extras[f] = String(raw.length);
    else if (raw != null && raw !== "" && extras[f] == null) extras[f] = "1";
  }

  // day-hour containers from slots/times aliases
  for (const c of containers) {
    if (DAY_HOUR_CONTAINERS.has(c) && extras[c] == null) {
      const slots = parseDayHourPairs(asString(input.slots ?? input.times ?? ""));
      if (slots.length) {
        extras[c] = slots;
        const countName = info.schema.fields.find(
          (x) => isCountField(x) && listItemField(x) === c,
        );
        if (countName) extras[countName] = String(slots.length);
      }
    }
  }

  // bool normalize
  for (const f of info.schema.fields) {
    if (BOOL_FIELDS.has(f) && extras[f] != null) {
      extras[f] = asBoolStr(extras[f]);
    }
  }

  // Selected_Set demo repair if count present but empty
  if (
    known.has("Selected_Set_of_Time_Slots") &&
    extras.Selected_Set_of_Time_Slots == null &&
    extras.Number_of_Selected_Sets_of_Time_Slots != null
  ) {
    extras.Selected_Set_of_Time_Slots = [
      {
        Number_of_Selected_Time_Slots: "1",
        Selected_Time_Slot: [DEMO_SLOT],
      },
    ];
    extras.Number_of_Selected_Sets_of_Time_Slots = "1";
  }

  return baseFields(input, extras);
}

function matchesTypeAnchor(text: string, info: ConstraintTypeInfo): boolean {
  if (new RegExp(`\\b${info.type}\\b`, "i").test(text)) return true;
  // bracket form [ConstraintX]
  if (text.includes(`[${info.type}]`)) return true;
  const desc = (info.descriptionIt ?? "").trim();
  if (desc.length >= 12) {
    const escaped = desc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(escaped, "i").test(text) && /vincolo|constraint|imposta|aggiungi/i.test(text)) {
      return true;
    }
  }
  return false;
}

export function makeSchemaLive(info: ConstraintTypeInfo): PhraseTemplate {
  const demo = buildDemoFields(info);
  const desc = info.descriptionIt ?? info.type;
  const extras = serializeExtras(demo);
  const caveat = modeCaveat(info.mode);
  const example = `Vincolo «${desc}» [${info.type}]: ${extras}; peso ${weightOf(demo)}%.`;
  const examplesIt = [
    example,
    `${info.type}: ${extras}`,
  ];
  if (caveat) examplesIt.push(`(${caveat})`);

  return {
    type: info.type,
    kind: info.kind,
    status: "live",
    descriptionIt: desc,
    family: info.family,
    mode: info.mode,
    examplesIt,
    describe: (fields) => {
      const bits = Object.keys(fields)
        .filter((k) => !META.has(k))
        .slice(0, 12)
        .map((k) => {
          const label = IT_FIELD_LABEL[k] ?? k;
          return `${label}=${formatFieldValue(fields[k])}`;
        });
      const modeNote =
        info.mode && info.mode !== "tutti" ? ` [mode ${info.mode}]` : "";
      return `${desc}${modeNote} (peso ${weightOf(fields)}%)${activeLabel(fields)}${
        bits.length ? `: ${bits.join("; ")}` : ""
      }`;
    },
    parseIt: (text) => {
      if (!matchesTypeAnchor(text, info)) return null;
      const after = text.includes(":") ? text.split(/:(.+)/s)[1] ?? text : text;
      const parsed = parseKvSegment(after);
      // merge demo defaults for missing required-looking fields so round-trip has shape
      const merged = normalizeFromSchema(info, { ...demo, ...parsed, ...pickMeta(parsed) });
      // Prefer explicitly parsed values over demo
      const preferred = normalizeFromSchema(info, { ...parsed });
      const fields = Object.keys(preferred).length > 3 ? preferred : merged;
      // If user provided KV, trust preferred even if sparse — fill counts
      const finalFields =
        Object.keys(parsed).filter((k) => !META.has(k)).length > 0
          ? normalizeFromSchema(info, { ...demo, ...parsed })
          : fields;
      const notes: string[] = [];
      if (caveat) notes.push(caveat);
      return {
        fields: finalFields,
        confidence: new RegExp(`\\b${info.type}\\b`, "i").test(text) ? 0.95 : 0.8,
        notes: notes.length ? notes : undefined,
      } satisfies PhraseParseResult;
    },
    fromStructured: (input) => normalizeFromSchema(info, input),
  };
}

function pickMeta(parsed: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (parsed.Weight_Percentage != null) out.Weight_Percentage = parsed.Weight_Percentage;
  if (parsed.Active != null) out.Active = parsed.Active;
  if (parsed.Comments != null) out.Comments = parsed.Comments;
  return out;
}

/** Build live templates for every catalog type (before sample overlay). */
export function buildAllSchemaLiveTemplates(
  types: ConstraintTypeInfo[],
): PhraseTemplate[] {
  return types.map(makeSchemaLive);
}
