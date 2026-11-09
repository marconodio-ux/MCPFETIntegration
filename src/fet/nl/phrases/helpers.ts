/** Shared helpers for NL phrase describe/parse. */

export function asString(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter(Boolean).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function asBool(v: unknown, fallback = true): boolean {
  if (v == null) return fallback;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "sì" || s === "si") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return fallback;
}

export function asBoolStr(v: unknown, fallback = true): string {
  return asBool(v, fallback) ? "true" : "false";
}

export function asNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function asStringList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter(Boolean);
  if (typeof v === "object") return [];
  const s = asString(v);
  if (!s) return [];
  return s.split(/[,;|/]+/).map((x) => x.trim()).filter(Boolean);
}

export function activityIdsOf(fields: Record<string, unknown>): string[] {
  const raw = fields.Activity_Id ?? fields.Activity_Ids;
  if (Array.isArray(raw)) return raw.map((x) => asString(x)).filter(Boolean);
  if (raw != null && raw !== "") return [asString(raw)];
  return [];
}

export type DayHour = { Day: string; Hour: string };

export function dayHourList(
  fields: Record<string, unknown>,
  key: string,
): DayHour[] {
  const raw = fields[key];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: DayHour[] = [];
  for (const item of list) {
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const day = asString(o.Day);
      const hour = asString(o.Hour);
      if (day || hour) out.push({ Day: day, Hour: hour });
    }
  }
  return out;
}

export function formatDayHours(slots: DayHour[], max = 8): string {
  if (!slots.length) return "(nessuno)";
  const parts = slots.slice(0, max).map((s) => `${s.Day} ${s.Hour}`.trim());
  if (slots.length > max) parts.push(`…(+${slots.length - max})`);
  return parts.join("; ");
}

export function parseDayHourPairs(text: string): DayHour[] {
  const out: DayHour[] = [];
  // "Lunedì 1^A ORA", "martedì / 3^a ora", "Venerdì ore 6 e 7"
  const re =
    /(lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica|monday|tuesday|wednesday|thursday|friday)[^\d\n]{0,20}?(\d+\s*\^?\s*[Aa]?\s*ORA|\d{1,2}:\d{2}|\d+\^A\s*ORA)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const day = capitalizeDay(m[1]!);
    const hour = normalizeHourToken(m[2]!);
    out.push({ Day: day, Hour: hour });
  }
  // Also: "Venerdì: 6^A ORA, 7^A ORA"
  const block =
    /(lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica)\s*[:\-–]\s*([^\n.;]+)/gi;
  let b: RegExpExecArray | null;
  while ((b = block.exec(text))) {
    const day = capitalizeDay(b[1]!);
    const hours = b[2]!.match(/\d+\s*\^?\s*[Aa]?\s*ORA|\d{1,2}:\d{2}/gi) ?? [];
    for (const h of hours) {
      const hour = normalizeHourToken(h);
      if (!out.some((x) => x.Day === day && x.Hour === hour)) {
        out.push({ Day: day, Hour: hour });
      }
    }
  }
  return out;
}

export function capitalizeDay(raw: string): string {
  const map: Record<string, string> = {
    lunedì: "Lunedì",
    martedì: "Martedì",
    mercoledì: "Mercoledì",
    giovedì: "Giovedì",
    venerdì: "Venerdì",
    sabato: "Sabato",
    domenica: "Domenica",
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
  };
  const low = raw.trim().toLowerCase();
  return map[low] ?? raw.trim();
}

export function normalizeHourToken(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  const m = s.match(/(\d+)\s*\^?\s*[Aa]?\s*ORA/i);
  if (m) return `${m[1]}^A ORA`;
  return s;
}

export function weightOf(fields: Record<string, unknown>, fallback = "100"): string {
  return asString(fields.Weight_Percentage ?? fields.weight ?? fallback, fallback);
}

export function activeLabel(fields: Record<string, unknown>): string {
  const active = asBool(fields.Active, true);
  if (active) return "";
  return " [inattivo/Active=false — tipicamente artefatto di soluzione bloccata]";
}

export function baseFields(
  input: Record<string, unknown>,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    Weight_Percentage: weightOf(input),
    Active: asBoolStr(input.Active ?? true),
    Comments: asString(input.Comments ?? ""),
    ...extras,
  };
}

export function genericDescribe(
  type: string,
  descriptionIt: string,
  fields: Record<string, unknown>,
): string {
  const keys = Object.keys(fields).filter(
    (k) => !["Weight_Percentage", "Active", "Comments"].includes(k),
  );
  const bits = keys.slice(0, 8).map((k) => `${k}=${asString(fields[k]).slice(0, 80)}`);
  const w = weightOf(fields);
  return `${descriptionIt || type} (peso ${w}%)${activeLabel(fields)}${bits.length ? `: ${bits.join("; ")}` : ""}`;
}

export function idsFromText(text: string): string[] {
  const ids: string[] = [];
  const re = /\b(?:attività|activity|id)\s*[#:=]?\s*(\d+)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) ids.push(m[1]!);
  // bare lists: "attività 1, 12" or "id 80 e 127"
  const list = text.match(/(?:attività|activity_?ids?|ids?)\s*[:=]?\s*([\d\s,e]+)/i);
  if (list) {
    for (const n of list[1]!.match(/\d+/g) ?? []) {
      if (!ids.includes(n)) ids.push(n);
    }
  }
  return ids;
}
