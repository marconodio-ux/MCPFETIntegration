/**
 * Live NL phrase handlers for common school constraint types (hand-tuned overlay).
 */

import type { PhraseParseResult, PhraseTemplate } from "./types.js";
import {
  activeLabel,
  activityIdsOf,
  asBool,
  asBoolStr,
  asNumber,
  asString,
  asStringList,
  baseFields,
  dayHourList,
  formatDayHours,
  idsFromText,
  parseDayHourPairs,
  weightOf,
} from "./helpers.js";

function stubParse(_text: string): PhraseParseResult | null {
  return null;
}

function live(
  partial: Omit<PhraseTemplate, "status" | "parseIt" | "fromStructured" | "describe"> & {
    describe: PhraseTemplate["describe"];
    parseIt: PhraseTemplate["parseIt"];
    fromStructured?: PhraseTemplate["fromStructured"];
  },
): PhraseTemplate {
  return {
    ...partial,
    status: "live",
    fromStructured:
      partial.fromStructured ??
      ((input) =>
        baseFields(input, {
          ...Object.fromEntries(
            Object.entries(input).filter(
              ([k]) => !["Weight_Percentage", "Active", "Comments", "weight"].includes(k),
            ),
          ),
        })),
  };
}

export const SAMPLE_LIVE_TEMPLATES: PhraseTemplate[] = [
  live({
    type: "ConstraintBasicCompulsoryTime",
    kind: "time",
    descriptionIt: "vincoli temporali obbligatori di base",
    family: "4.1 Obbligatori di base",
    examplesIt: [
      "Attiva i vincoli temporali obbligatori di base al 100%.",
      "Basic compulsory time attivo.",
    ],
    describe: (f) =>
      `Vincoli temporali obbligatori di base (peso ${weightOf(f)}%)${activeLabel(f)}.`,
    parseIt: (text) => {
      if (!/obbligator\w*\s+di\s+base|basic\s*compulsory\s*time|vincoli\s+temporali\s+obbligatori/i.test(text)) {
        return null;
      }
      if (/spazio|space/i.test(text) && !/tempor/i.test(text)) return null;
      return { fields: baseFields({}), confidence: 0.85 };
    },
  }),

  live({
    type: "ConstraintBasicCompulsorySpace",
    kind: "space",
    descriptionIt: "vincoli spaziali obbligatori di base",
    family: "5.1 Obbligatori di base",
    examplesIt: [
      "Attiva i vincoli spaziali obbligatori di base al 100%.",
      "Basic compulsory space attivo.",
    ],
    describe: (f) =>
      `Vincoli spaziali obbligatori di base (peso ${weightOf(f)}%)${activeLabel(f)}.`,
    parseIt: (text) => {
      if (!/obbligator\w*\s+di\s+base|basic\s*compulsory\s*space|vincoli\s+spaziali\s+obbligatori/i.test(text)) {
        return null;
      }
      if (/tempor|time/i.test(text) && !/spaz/i.test(text)) return null;
      return { fields: baseFields({}), confidence: 0.85 };
    },
  }),

  live({
    type: "ConstraintBreakTimes",
    kind: "time",
    descriptionIt: "pause (slot vietati a tutti)",
    family: "4.2 Disponibilità / pause",
    examplesIt: [
      "Pausa: venerdì 6^A e 7^A ORA; lunedì 7^A ORA.",
      "Imposta i break times: Martedì 5^A ORA.",
    ],
    describe: (f) => {
      const slots = dayHourList(f, "Break_Time");
      return `Pause/break per tutti: ${formatDayHours(slots)} (peso ${weightOf(f)}%)${activeLabel(f)}.`;
    },
    parseIt: (text) => {
      if (!/\b(pausa|pause|break\s*times?|fasce\s+di\s+pausa|slot\s+vietati)\b/i.test(text)) return null;
      const slots = parseDayHourPairs(text);
      if (!slots.length) {
        return {
          fields: baseFields({ Number_of_Break_Times: "0", Break_Time: [] }),
          confidence: 0.4,
          notes: ["BreakTimes riconosciuto ma nessuna coppia giorno/ora trovata."],
        };
      }
      return {
        fields: baseFields({
          Number_of_Break_Times: String(slots.length),
          Break_Time: slots,
        }),
        confidence: 0.9,
      };
    },
    fromStructured: (input) => {
      const slots =
        (input.Break_Time as { Day: string; Hour: string }[] | undefined) ??
        parseDayHourPairs(asString(input.slots ?? input.times ?? ""));
      return baseFields(input, {
        Number_of_Break_Times: String(slots.length),
        Break_Time: slots,
      });
    },
  }),

  live({
    type: "ConstraintTeacherNotAvailableTimes",
    kind: "time",
    descriptionIt: "insegnante — fasce orarie non disponibili",
    family: "4.2 Disponibilità / pause",
    examplesIt: [
      "Il docente Mario Rossi non è disponibile lunedì 2^A e 3^A ORA.",
      "Teacher not available: Rossi, mercoledì 6^A ORA.",
    ],
    describe: (f) => {
      const slots = dayHourList(f, "Not_Available_Time");
      return `Docente ${asString(f.Teacher)} non disponibile: ${formatDayHours(slots)} (peso ${weightOf(f)}%)${activeLabel(f)}.`;
    },
    parseIt: (text) => {
      const m = text.match(
        /(?:docente|insegnante|teacher)\s+([^,;]+?)\s+(?:non\s+[èe]\s+disponibile|not\s+available|assente)[:\s]+(.+)/i,
      );
      if (!m && !/non\s+disponibile/i.test(text)) return null;
      const teacher = m
        ? m[1]!.trim()
        : (text.match(/(?:docente|insegnante|teacher)\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ' .'-]{2,})/i)?.[1] ??
          "").trim();
      if (!teacher) return null;
      const slots = parseDayHourPairs(m?.[2] ?? text);
      return {
        fields: baseFields({
          Teacher: teacher,
          Number_of_Not_Available_Times: String(slots.length),
          Not_Available_Time: slots,
        }),
        confidence: slots.length ? 0.9 : 0.5,
      };
    },
    fromStructured: (input) => {
      const slots =
        (input.Not_Available_Time as { Day: string; Hour: string }[] | undefined) ??
        parseDayHourPairs(asString(input.slots ?? input.times ?? ""));
      return baseFields(input, {
        Teacher: asString(input.Teacher ?? input.teacher),
        Number_of_Not_Available_Times: String(slots.length),
        Not_Available_Time: slots,
      });
    },
  }),

  live({
    type: "ConstraintStudentsSetNotAvailableTimes",
    kind: "time",
    descriptionIt: "insieme di studenti — fasce orarie non disponibili",
    family: "4.2 Disponibilità / pause",
    examplesIt: [
      "La classe 3 non è disponibile venerdì 5^A, 6^A e 7^A ORA.",
      "Students set P1A not available: lunedì 7^A ORA.",
    ],
    describe: (f) => {
      const slots = dayHourList(f, "Not_Available_Time");
      return `Studenti «${asString(f.Students)}» non disponibili: ${formatDayHours(slots)} (peso ${weightOf(f)}%)${activeLabel(f)}.`;
    },
    parseIt: (text) => {
      const m = text.match(
        /(?:classe|studenti|students\s*set|anno|year)\s+([^\s,;]+)\s+(?:non\s+[èe]\s+disponibile|not\s+available)[:\s]+(.+)/i,
      );
      if (!m) return null;
      const students = m[1]!.trim();
      const slots = parseDayHourPairs(m[2]!);
      return {
        fields: baseFields({
          Students: students,
          Number_of_Not_Available_Times: String(slots.length),
          Not_Available_Time: slots,
        }),
        confidence: slots.length ? 0.9 : 0.5,
      };
    },
    fromStructured: (input) => {
      const slots =
        (input.Not_Available_Time as { Day: string; Hour: string }[] | undefined) ??
        parseDayHourPairs(asString(input.slots ?? input.times ?? ""));
      return baseFields(input, {
        Students: asString(input.Students ?? input.students),
        Number_of_Not_Available_Times: String(slots.length),
        Not_Available_Time: slots,
      });
    },
  }),

  live({
    type: "ConstraintRoomNotAvailableTimes",
    kind: "space",
    descriptionIt: "aula — fasce orarie non disponibili",
    family: "5.2 Disponibilità aule",
    examplesIt: [
      "L'aula M08-00 non è disponibile lunedì 6^A e 7^A ORA.",
      "Room M09 not available: martedì 1^A ORA.",
    ],
    describe: (f) => {
      const slots = dayHourList(f, "Not_Available_Time");
      return `Aula ${asString(f.Room)} non disponibile: ${formatDayHours(slots)} (peso ${weightOf(f)}%)${activeLabel(f)}.`;
    },
    parseIt: (text) => {
      const m = text.match(
        /(?:aula|room|laboratorio)\s+([^\s,;]+)\s+(?:non\s+[èe]\s+disponibile|not\s+available)[:\s]+(.+)/i,
      );
      if (!m) return null;
      const room = m[1]!.trim();
      const slots = parseDayHourPairs(m[2]!);
      return {
        fields: baseFields({
          Room: room,
          Number_of_Not_Available_Times: String(slots.length),
          Not_Available_Time: slots,
        }),
        confidence: slots.length ? 0.9 : 0.5,
      };
    },
    fromStructured: (input) => {
      const slots =
        (input.Not_Available_Time as { Day: string; Hour: string }[] | undefined) ??
        parseDayHourPairs(asString(input.slots ?? input.times ?? ""));
      return baseFields(input, {
        Room: asString(input.Room ?? input.room),
        Number_of_Not_Available_Times: String(slots.length),
        Not_Available_Time: slots,
      });
    },
  }),

  live({
    type: "ConstraintMinDaysBetweenActivities",
    kind: "time",
    descriptionIt: "giorni minimi tra attività (split)",
    family: "4.4 MinDays",
    examplesIt: [
      "Separa le attività 1,2,3,4 con almeno 1 giorno (consecutive se stesso giorno).",
      "MinDays=1 tra id 10 e 11, peso 95%.",
    ],
    describe: (f) => {
      const ids = activityIdsOf(f);
      return `MinDays=${asString(f.MinDays)} tra attività [${ids.join(", ")}] (Consecutive_If_Same_Day=${asString(f.Consecutive_If_Same_Day)}; peso ${weightOf(f)}%)${activeLabel(f)}.`;
    },
    parseIt: (text) => {
      if (!/min\s*days|giorni\s+minim|almeno\s+\d+\s+giorn|separa(?:re)?\s+le\s+attivit/i.test(text)) {
        return null;
      }
      const ids = idsFromText(text);
      const md = text.match(/(?:mindays|almeno|min(?:imo)?)\s*[=:]?\s*(\d+)\s*giorn?/i);
      const minDays = md?.[1] ?? "1";
      const consecutive = !/non\s+consecutive|consecutive\s*=\s*false/i.test(text);
      if (!ids.length) return { fields: baseFields({ MinDays: minDays }), confidence: 0.35 };
      return {
        fields: baseFields({
          Consecutive_If_Same_Day: consecutive ? "true" : "false",
          Number_of_Activities: String(ids.length),
          Activity_Id: ids,
          MinDays: minDays,
        }),
        confidence: 0.9,
      };
    },
    fromStructured: (input) => {
      const ids = asStringList(input.Activity_Id ?? input.activityIds ?? input.ids);
      return baseFields(input, {
        Consecutive_If_Same_Day: asBoolStr(input.Consecutive_If_Same_Day ?? true),
        Number_of_Activities: String(ids.length),
        Activity_Id: ids,
        MinDays: asString(input.MinDays ?? input.minDays ?? "1"),
      });
    },
  }),

  live({
    type: "ConstraintActivitiesSameStartingTime",
    kind: "time",
    descriptionIt: "attività — stesso orario di inizio (parallelo)",
    family: "4.5 Allineamento",
    examplesIt: [
      "Le attività 1 e 12 devono partire insieme (stesso orario).",
      "Same starting time per id 5, 6.",
    ],
    describe: (f) => {
      const ids = activityIdsOf(f);
      return `Stesso orario di inizio per attività [${ids.join(", ")}] (peso ${weightOf(f)}%)${activeLabel(f)}.`;
    },
    parseIt: (text) => {
      if (
        !/stesso\s+orario|part(?:ono|ire)\s+insieme|same\s+starting\s+time|alline[ae].*attivit/i.test(
          text,
        )
      ) {
        return null;
      }
      const ids = idsFromText(text);
      if (ids.length < 2) return { fields: baseFields({}), confidence: 0.3 };
      return {
        fields: baseFields({
          Number_of_Activities: String(ids.length),
          Activity_Id: ids,
        }),
        confidence: 0.9,
      };
    },
    fromStructured: (input) => {
      const ids = asStringList(input.Activity_Id ?? input.activityIds ?? input.ids);
      return baseFields(input, {
        Number_of_Activities: String(ids.length),
        Activity_Id: ids,
      });
    },
  }),

  live({
    type: "ConstraintTwoActivitiesConsecutive",
    kind: "time",
    descriptionIt: "due attività consecutive",
    family: "4.5 Allineamento",
    examplesIt: [
      "L'attività 80 deve essere immediatamente seguita dalla 127.",
      "Two activities consecutive: first=80 second=127.",
    ],
    describe: (f) =>
      `Attività ${asString(f.First_Activity_Id)} immediatamente seguita da ${asString(f.Second_Activity_Id)} (peso ${weightOf(f)}%)${activeLabel(f)}.`,
    parseIt: (text) => {
      if (!/consecutive|immediatamente\s+seguit|una\s+dopo\s+l['']altra/i.test(text)) return null;
      const pair =
        text.match(
          /(?:first|prima|attivit[àa])\s*[#:=]?\s*(\d+)\D{0,60}?(?:second|seconda|seguit\w*\s+(?:da|dalla|dall['']?\s*attivit\w*)|#:?)\s*(\d+)/i,
        ) ??
        text.match(
          /attivit[àa]\s+(\d+)\s+deve\s+essere\s+immediatamente\s+seguita\s+dalla\s+(\d+)/i,
        );
      const ids = idsFromText(text);
      // also bare "dalla 127" second id
      const dalla = text.match(/\bdalla\s+(\d+)\b/i)?.[1];
      const first = pair?.[1] ?? ids[0];
      const second = pair?.[2] ?? dalla ?? ids[1];
      if (!first || !second) return { fields: baseFields({}), confidence: 0.3 };
      return {
        fields: baseFields({
          First_Activity_Id: first,
          Second_Activity_Id: second,
        }),
        confidence: 0.9,
      };
    },
    fromStructured: (input) =>
      baseFields(input, {
        First_Activity_Id: asString(input.First_Activity_Id ?? input.first),
        Second_Activity_Id: asString(input.Second_Activity_Id ?? input.second),
      }),
  }),

  live({
    type: "ConstraintTeachersMaxHoursDaily",
    kind: "time",
    descriptionIt: "tutti i docenti — massimo ore giornaliere",
    family: "4.3 Carichi",
    examplesIt: [
      "Tutti i docenti al massimo 5 ore al giorno.",
      "Teachers max hours daily = 5 (può essere Active=false se solo preferenza).",
    ],
    describe: (f) =>
      `Tutti i docenti: max ${asString(f.Maximum_Hours_Daily)} ore/giorno (peso ${weightOf(f)}%)${activeLabel(f)}.`,
    parseIt: (text) => {
      const isAllTeachers =
        /tutti\s+i\s+docenti/i.test(text) ||
        /teachers?\s+max\s+hours\s+daily/i.test(text);
      if (!isAllTeachers) return null;
      if (/docente\s+[A-ZÀ-Ÿ][A-Za-zÀ-ÿ' .'-]{2,}/i.test(text) && !/tutti/i.test(text)) {
        return null;
      }
      const n = text.match(
        /max(?:imo)?\s*(?:ore)?\s*[=:]?\s*(\d+)|(\d+)\s+ore\s+(?:al\s+)?giorno|hours\s*daily\s*=\s*(\d+)/i,
      );
      const hours = n?.[1] ?? n?.[2] ?? n?.[3] ?? "5";
      const active = !/inattiv|active\s*=\s*false/i.test(text);
      return {
        fields: baseFields({ Maximum_Hours_Daily: hours, Active: active ? "true" : "false" }),
        confidence: 0.85,
      };
    },
    fromStructured: (input) =>
      baseFields(input, {
        Maximum_Hours_Daily: asString(input.Maximum_Hours_Daily ?? input.maxHours ?? "5"),
      }),
  }),

  live({
    type: "ConstraintTeacherMaxHoursDaily",
    kind: "time",
    descriptionIt: "singolo docente — massimo ore giornaliere",
    family: "4.3 Carichi",
    examplesIt: [
      "Il docente PAOLO MEGGIATO al massimo 5 ore al giorno.",
      "Teacher max hours daily for Rossi = 4.",
    ],
    describe: (f) =>
      `Docente ${asString(f.Teacher)}: max ${asString(f.Maximum_Hours_Daily)} ore/giorno (peso ${weightOf(f)}%)${activeLabel(f)}.`,
    parseIt: (text) => {
      const m = text.match(
        /(?:docente|insegnante|teacher)\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ' .'-]{2,}?)\s+(?:al\s+)?max(?:imo)?\s*(?:di\s*)?(\d+)\s*ore/i,
      );
      const m2 = text.match(
        /(?:docente|insegnante|teacher)\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ' .'-]{2,}?).{0,40}?(\d+)\s+ore\s+(?:al\s+)?giorno/i,
      );
      const hit = m ?? m2;
      if (!hit) return null;
      if (/tutti\s+i\s+docenti/i.test(text)) return null;
      const active = !/inattiv|active\s*=\s*false/i.test(text);
      return {
        fields: baseFields({
          Teacher: hit[1]!.trim(),
          Maximum_Hours_Daily: hit[2]!,
          Active: active ? "true" : "false",
        }),
        confidence: 0.9,
      };
    },
    fromStructured: (input) =>
      baseFields(input, {
        Teacher: asString(input.Teacher ?? input.teacher),
        Maximum_Hours_Daily: asString(input.Maximum_Hours_Daily ?? input.maxHours ?? "5"),
      }),
  }),

  live({
    type: "ConstraintActivityPreferredStartingTime",
    kind: "time",
    descriptionIt: "attività — orario di inizio preferito (giorno/ora)",
    family: "4.6 Preferred times",
    examplesIt: [
      "Blocca l'attività 9 mercoledì 4^A ORA (lock; Active=false se artefatto soluzione).",
      "Preferred starting time for activity 3: lunedì 1^A ORA, permanently locked.",
    ],
    describe: (f) => {
      const lock = asBool(f.Permanently_Locked, false);
      return `Attività ${asString(f.Activity_Id)} preferisce ${asString(f.Day)} ${asString(f.Hour)}${lock ? " (lock permanente)" : ""} (peso ${weightOf(f)}%)${activeLabel(f)}.`;
    },
    parseIt: (text) => {
      if (
        !/preferred\s+starting\s+time|orario\s+(?:di\s+inizio\s+)?preferit|blocca\s+l['']?attivit|fissa\s+l['']?attivit/i.test(
          text,
        )
      ) {
        return null;
      }
      // plural form handled by other type
      if (/preferred\s+starting\s+times|orari\s+preferiti|fasce\s+preferite/i.test(text) &&
        !/\bun\s+solo\b|singol/i.test(text)) {
        // may still be singular if one slot
      }
      const ids = idsFromText(text);
      const slots = parseDayHourPairs(text);
      if (!ids[0] || !slots[0]) return { fields: baseFields({}), confidence: 0.3 };
      const locked =
        /permanent|lock|blocc|fiss/i.test(text) && !/non\s+blocc|unlocked/i.test(text);
      const active = !/inattiv|active\s*=\s*false|artefatto\s+di\s+soluzione/i.test(text);
      return {
        fields: baseFields({
          Activity_Id: ids[0],
          Day: slots[0].Day,
          Hour: slots[0].Hour,
          Permanently_Locked: locked ? "true" : "false",
          Active: active ? "true" : "false",
        }),
        confidence: 0.9,
        notes: active
          ? undefined
          : ["Active=false: tipico lock di soluzione precedente; FET lo ignora in generazione."],
      };
    },
    fromStructured: (input) =>
      baseFields(input, {
        Activity_Id: asString(input.Activity_Id ?? input.activityId),
        Day: asString(input.Day ?? input.day),
        Hour: asString(input.Hour ?? input.hour),
        Permanently_Locked: asBoolStr(input.Permanently_Locked ?? input.locked ?? false, false),
      }),
  }),

  live({
    type: "ConstraintActivityPreferredStartingTimes",
    kind: "time",
    descriptionIt: "attività — insieme di orari di inizio preferiti",
    family: "4.6 Preferred times",
    examplesIt: [
      "L'attività 2 può iniziare solo in queste fasce: lunedì 1–4^A ORA, martedì 1–4^A ORA…",
      "Preferred starting times for activity 5: …",
    ],
    describe: (f) => {
      const slots = dayHourList(f, "Preferred_Starting_Time");
      return `Attività ${asString(f.Activity_Id)}: orari preferiti ${formatDayHours(slots, 6)} (peso ${weightOf(f)}%)${activeLabel(f)}.`;
    },
    parseIt: (text) => {
      if (
        !/preferred\s+starting\s+times|orari\s+(?:di\s+inizio\s+)?preferiti|fasce\s+preferite|pu[òo]\s+iniziare\s+solo/i.test(
          text,
        )
      ) {
        return null;
      }
      const ids = idsFromText(text);
      const slots = parseDayHourPairs(text);
      if (!ids[0]) return { fields: baseFields({}), confidence: 0.3 };
      return {
        fields: baseFields({
          Activity_Id: ids[0],
          Number_of_Preferred_Starting_Times: String(slots.length),
          Preferred_Starting_Time: slots,
        }),
        confidence: slots.length ? 0.85 : 0.4,
      };
    },
    fromStructured: (input) => {
      const slots =
        (input.Preferred_Starting_Time as { Day: string; Hour: string }[] | undefined) ??
        parseDayHourPairs(asString(input.slots ?? input.times ?? ""));
      return baseFields(input, {
        Activity_Id: asString(input.Activity_Id ?? input.activityId),
        Number_of_Preferred_Starting_Times: String(slots.length),
        Preferred_Starting_Time: slots,
      });
    },
  }),

  live({
    type: "ConstraintSubjectPreferredRoom",
    kind: "space",
    descriptionIt: "materia — aula preferita",
    family: "5.3 Preferred rooms",
    examplesIt: [
      "La materia LAB. CNC preferisce l'aula M09.",
      "Subject preferred room: Matematica → Aula1.",
    ],
    describe: (f) =>
      `Materia «${asString(f.Subject)}» preferisce aula ${asString(f.Room)} (peso ${weightOf(f)}%)${activeLabel(f)}.`,
    parseIt: (text) => {
      const m = text.match(
        /(?:materia|subject)\s+([^→\n]+?)\s+(?:preferisce|→|->|aula\s+preferita)\s+(?:l['']?aula\s+)?([^\s,;.]+)/i,
      );
      if (!m && !/subject\s+preferred\s+room/i.test(text)) return null;
      if (/aule\s+preferite|preferred\s+rooms/i.test(text)) return null;
      const subject = (m?.[1] ?? text.match(/materia\s+([^\n,]+)/i)?.[1] ?? "").trim();
      const room =
        (m?.[2] ?? text.match(/(?:aula|room)\s+([^\s,;.]+)/i)?.[1] ?? "").trim();
      if (!subject || !room) return { fields: baseFields({}), confidence: 0.3 };
      return {
        fields: baseFields({ Subject: subject, Room: room }),
        confidence: 0.9,
      };
    },
    fromStructured: (input) =>
      baseFields(input, {
        Subject: asString(input.Subject ?? input.subject),
        Room: asString(input.Room ?? input.room),
      }),
  }),

  live({
    type: "ConstraintSubjectPreferredRooms",
    kind: "space",
    descriptionIt: "materia — aule preferite (insieme)",
    family: "5.3 Preferred rooms",
    examplesIt: [
      "LAB. MECCANICO può usare le aule M08-00 e M08-01.",
      "Subject preferred rooms: Lab → A1, A2.",
    ],
    describe: (f) => {
      const rooms = asStringList(f.Preferred_Room);
      return `Materia «${asString(f.Subject)}» aule preferite: ${rooms.join(", ") || "(nessuna)"} (peso ${weightOf(f)}%)${activeLabel(f)}.`;
    },
    parseIt: (text) => {
      if (!/aule\s+preferite|preferred\s+rooms|pu[òo]\s+usare\s+le\s+aule/i.test(text)) return null;
      const subject =
        text.match(/(?:materia|subject)\s+([^→\n]+?)\s+(?:pu[òo]|prefer|→|->|aule)/i)?.[1]?.trim() ??
        text.match(/«([^»]+)»/)?.[1]?.trim() ??
        text.match(/^\s*([A-Za-zÀ-ÿ0-9._ \-]+?)\s+pu[òo]\s+usare\s+le\s+aule/i)?.[1]?.trim() ??
        "";
      const roomsPart =
        text.match(/aule?\s+[:=]?\s*([A-Za-z0-9_,\- .]+)/i)?.[1] ??
        text.match(/→\s*(.+)$/i)?.[1] ??
        "";
      const rooms = asStringList(roomsPart.replace(/\be\b/gi, ","));
      if (!subject) return { fields: baseFields({}), confidence: 0.3 };
      return {
        fields: baseFields({
          Subject: subject,
          Number_of_Preferred_Rooms: String(rooms.length),
          Preferred_Room: rooms,
        }),
        confidence: rooms.length ? 0.85 : 0.4,
      };
    },
    fromStructured: (input) => {
      const rooms = asStringList(input.Preferred_Room ?? input.rooms);
      return baseFields(input, {
        Subject: asString(input.Subject ?? input.subject),
        Number_of_Preferred_Rooms: String(rooms.length),
        Preferred_Room: rooms,
      });
    },
  }),

  live({
    type: "ConstraintActivityPreferredRoom",
    kind: "space",
    descriptionIt: "attività — aula preferita",
    family: "5.3 Preferred rooms",
    examplesIt: [
      "L'attività 1 preferisce l'aula M08-00.",
      "Activity preferred room: id 12 → Lab1 (lock).",
    ],
    describe: (f) => {
      const lock = asBool(f.Permanently_Locked, false);
      return `Attività ${asString(f.Activity_Id)} preferisce aula ${asString(f.Room)}${lock ? " (lock permanente)" : ""} (peso ${weightOf(f)}%)${activeLabel(f)}.`;
    },
    parseIt: (text) => {
      if (
        !/attivit[àa]\s+\d+.{0,40}(?:preferisce|aula)|activity\s+preferred\s+room|aula\s+preferita\s+per\s+l['']?attivit/i.test(
          text,
        )
      ) {
        return null;
      }
      if (/(?:materia|subject)\s+/i.test(text) && !/attivit/i.test(text)) return null;
      const ids = idsFromText(text);
      const room =
        text.match(/(?:aula|room)\s+([A-Za-z0-9_\-]+)/i)?.[1] ??
        text.match(/→\s*([A-Za-z0-9_\-]+)/)?.[1] ??
        "";
      if (!ids[0] || !room) return { fields: baseFields({}), confidence: 0.3 };
      const locked = /permanent|lock|blocc/i.test(text);
      return {
        fields: baseFields({
          Activity_Id: ids[0],
          Room: room,
          Permanently_Locked: locked ? "true" : "false",
        }),
        confidence: 0.9,
      };
    },
    fromStructured: (input) =>
      baseFields(input, {
        Activity_Id: asString(input.Activity_Id ?? input.activityId),
        Room: asString(input.Room ?? input.room),
        Permanently_Locked: asBoolStr(input.Permanently_Locked ?? input.locked ?? false, false),
      }),
  }),
];

/** Unused helper kept to avoid tree-shaking confusion in stubs. */
export function _unusedStubParse(text: string): PhraseParseResult | null {
  return stubParse(text);
}

export function asNumberSafe(v: unknown): number {
  return asNumber(v);
}
