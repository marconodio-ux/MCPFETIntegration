import fs from "node:fs";
import path from "node:path";
import type { DiagnoseBlocker, FetLogArtifacts, FetOutcome } from "./types.js";

function readIfExists(filePath: string): string | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return undefined;
  }
}

/** Collect FET-CL log artifacts under an output directory (logs/). */
export function collectFetLogArtifacts(
  outputDir?: string,
  extras?: { stdout?: string; stderr?: string },
): FetLogArtifacts {
  const pathsFound: string[] = [];
  const art: FetLogArtifacts = {
    outputDir,
    stdout: extras?.stdout,
    stderr: extras?.stderr,
    pathsFound,
  };
  if (!outputDir || !fs.existsSync(outputDir)) return art;

  const logsDir = path.join(outputDir, "logs");
  const assignText = (key: "resultTxt" | "errorsTxt" | "warningsTxt" | "difficultActivitiesTxt" | "initialOrderTxt" | "maxPlacedTxt", p: string) => {
    const body = readIfExists(p);
    if (body != null) {
      art[key] = body;
      pathsFound.push(p);
    }
  };
  assignText("resultTxt", path.join(logsDir, "result.txt"));
  assignText("errorsTxt", path.join(logsDir, "errors.txt"));
  assignText("warningsTxt", path.join(logsDir, "warnings.txt"));
  assignText("difficultActivitiesTxt", path.join(logsDir, "difficult_activities.txt"));
  assignText("initialOrderTxt", path.join(logsDir, "initial_order.txt"));
  assignText("maxPlacedTxt", path.join(logsDir, "max_placed_activities.txt"));
  return art;
}

export function inferFetOutcome(art: FetLogArtifacts, exitCode?: number | null): FetOutcome {
  const blob = [
    art.resultTxt,
    art.errorsTxt,
    art.stdout,
    art.stderr,
    art.difficultActivitiesTxt,
  ]
    .filter(Boolean)
    .join("\n");

  if (/Simulation successful|Timetable generated successfully|generation successful/i.test(blob)) {
    return "succeeded";
  }
  if (/Cannot precompute/i.test(blob)) return "precompute_failed";
  if (/Cannot compute internal structure/i.test(blob)) return "structure_failed";
  if (/\bImpossible\b/i.test(blob) || /impossible to schedule/i.test(blob)) return "impossible";
  if (/Time exceeded/i.test(blob)) return "time_exceeded";
  if (/Generation interrupted/i.test(blob)) return "interrupted";
  if (exitCode === 0) return "succeeded";
  if (exitCode != null && exitCode !== 0) return "failed";
  if (art.errorsTxt || art.difficultActivitiesTxt) return "failed";
  return "unknown";
}

function extractActivityIds(text: string): number[] {
  const ids = new Set<number>();
  const patterns = [
    /Activity with id\s*=\s*(\d+)/gi,
    /\bId:\s*(\d+)\b/gi,
    /activity id[=:\s]+(\d+)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      ids.add(Number(m[1]));
    }
  }
  return [...ids];
}

function extractTeacherNames(text: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /Teacher\s+([^\n,()]+?)(?:'s|\s+activity|\s+has|\s+cannot)/gi,
    /teacher\s+[“"]?([^”"\n,]+)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const n = m[1]?.trim();
      if (n && n.length < 80) names.add(n);
    }
  }
  return [...names];
}

function extractRoomNames(text: string): string[] {
  const names = new Set<string>();
  const re = /Room\s+([^\n]+?)\s+has not enough slots/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = m[1]?.trim();
    if (n) names.add(n);
  }
  return [...names];
}

/**
 * Map FET log / console text into Italian-friendly blockers with catalog hints.
 */
export function blockersFromFetArtifacts(art: FetLogArtifacts): DiagnoseBlocker[] {
  const blockers: DiagnoseBlocker[] = [];
  const outcome = inferFetOutcome(art);

  const pushFromText = (
    text: string | undefined,
    source: DiagnoseBlocker["source"],
    defaultSeverity: DiagnoseBlocker["severity"] = "error",
  ) => {
    if (!text?.trim()) return;
    // Split on blank-line message blocks when present (Title:/Message: format)
    const chunks = text.includes("Message:")
      ? text.split(/\n(?=Title:)/).map((c) => c.trim()).filter(Boolean)
      : [text.trim()];

    for (const chunk of chunks) {
      const messageMatch = chunk.match(/Message:\s*([\s\S]+?)(?:\n\s*\n|$)/i);
      const body = (messageMatch?.[1] ?? chunk).trim();
      if (!body) continue;

      const activityIds = extractActivityIds(body);
      const teachers = extractTeacherNames(body);
      const rooms = extractRoomNames(body);

      if (/no allowed slot/i.test(body)) {
        blockers.push({
          code: "fet_no_allowed_slot",
          severity: "error",
          titleIt: activityIds.length
            ? `Attività ${activityIds.join(", ")}: nessuno slot ammesso`
            : "Attività senza slot ammesso",
          detailIt:
            "FET in precompute ha trovato un'attività con tutti gli slot vietati (NotAvailable, Break, preferenze a 100%, durata, …).",
          suggestedFixIt:
            "Allentare NotAvailable/Break/Preferred* a peso 100% legati a quell'attività (docente/classe), o ridurre Duration.",
          constraintTypes: [
            "ConstraintTeacherNotAvailableTimes",
            "ConstraintStudentsSetNotAvailableTimes",
            "ConstraintBreakTimes",
            "ConstraintActivityPreferredTimeSlots",
            "ConstraintActivityPreferredStartingTime",
          ],
          entities: teachers.map((name) => ({ kind: "teachers", name })),
          activityIds: activityIds.length ? activityIds : undefined,
          source,
          evidence: body.slice(0, 500),
          confidence: "high",
        });
        continue;
      }

      if (/not enough slots for home rooms/i.test(body)) {
        blockers.push({
          code: "fet_room_slots",
          severity: "error",
          titleIt: rooms.length
            ? `Aula "${rooms[0]}": slot insufficienti per home room`
            : "Aule home room: slot insufficienti",
          detailIt: body.slice(0, 400),
          suggestedFixIt:
            "Ridurre le attività legate all'aula, aggiungere slot, o allentare i vincoli home room / preferred room a 100%.",
          constraintTypes: [
            "ConstraintTeacherHomeRoom",
            "ConstraintStudentsSetHomeRoom",
            "ConstraintActivityPreferredRoom",
            "ConstraintActivityPreferredRooms",
          ],
          entities: rooms.map((name) => ({ kind: "rooms", name })),
          activityIds: activityIds.length ? activityIds : undefined,
          source,
          evidence: body.slice(0, 500),
          confidence: "high",
        });
        continue;
      }

      if (/Cannot precompute/i.test(body)) {
        blockers.push({
          code: "fet_precompute_failed",
          severity: "error",
          titleIt: "Precompute FET fallito (dati incoerenti)",
          detailIt:
            "fet-cl ha abortito in precompute. I dettagli tipicamente stanno in logs/errors.txt (messaggi Activity/Teacher/Room).",
          suggestedFixIt:
            "Aprire logs/errors.txt, correggere i vincoli citati, poi rilanciare fet_diagnose / fet_generate.",
          source,
          evidence: body.slice(0, 500),
          confidence: "medium",
        });
        continue;
      }

      if (/Cannot compute internal structure/i.test(body)) {
        blockers.push({
          code: "fet_structure_failed",
          severity: "error",
          titleIt: "Struttura interna FET non calcolabile",
          detailIt:
            "Il file .fet non passa la validazione strutturale (riferimenti rotti, mode/calendario incoerenti, …).",
          suggestedFixIt: "Controllare Teachers/Subjects/Students/Activities e Mode; usare anche l'euristica statica di fet_diagnose.",
          source,
          evidence: body.slice(0, 500),
          confidence: "medium",
        });
        continue;
      }

      // Generic Title/Message error block
      if (messageMatch || /please correct/i.test(body)) {
        blockers.push({
          code: "fet_log_message",
          severity: defaultSeverity,
          titleIt: "Messaggio FET da logs",
          detailIt: body.slice(0, 600),
          suggestedFixIt:
            "Interpretare il messaggio, cercare i tipi vincolo nel catalogo (fet_constraint_catalog) e allentare quelli a peso 100% citati.",
          entities: [
            ...teachers.map((name) => ({ kind: "teachers", name })),
            ...rooms.map((name) => ({ kind: "rooms", name })),
          ],
          activityIds: activityIds.length ? activityIds : undefined,
          source,
          evidence: body.slice(0, 500),
          confidence: "medium",
        });
      }
    }
  };

  pushFromText(art.errorsTxt, "fet_log", "error");
  pushFromText(art.warningsTxt, "fet_log", "warning");
  pushFromText(art.stdout, "fet_stdout", "error");
  pushFromText(art.stderr, "fet_stdout", "error");
  pushFromText(art.resultTxt, "fet_result", "error");

  if (art.difficultActivitiesTxt?.trim()) {
    const ids = extractActivityIds(art.difficultActivitiesTxt);
    blockers.push({
      code: "fet_difficult_activity",
      severity: "error",
      titleIt: ids.length
        ? `FET indica attività difficili: ${ids.slice(0, 8).join(", ")}`
        : "FET ha scritto difficult_activities.txt",
      detailIt:
        "Quando la generazione è Impossible o interrotta, FET elenca le attività che non riesce a collocare. Controllare i vincoli (soprattutto peso 100%) di docenti/classi/aule di quelle attività.",
      suggestedFixIt:
        "Ispezionare l'attività (e la successiva in initial_order.txt): NotAvailable, Preferred*, MinDays, SameStarting, aule preferred/home. Allentare o disattivare i vincoli più stretti.",
      activityIds: ids.length ? ids : undefined,
      source: "fet_difficult",
      evidence: art.difficultActivitiesTxt.slice(0, 800),
      confidence: ids.length ? "high" : "medium",
    });
  }

  // Bare "Impossible" without further detail
  if (outcome === "impossible") {
    const hasSpecific = blockers.some(
      (b) =>
        b.code === "fet_no_allowed_slot" ||
        b.code === "fet_difficult_activity" ||
        b.code === "fet_room_slots",
    );
    if (!hasSpecific) {
      blockers.push({
        code: "fet_impossible_generic",
        severity: "error",
        titleIt: "FET: Impossible (senza dettaglio vincolo)",
        detailIt:
          "fet-cl ha solo riportato «Impossible». Spesso non indica quale Constraint* è la causa radice: va inferita da difficult_activities / initial_order / max_placed_activities e dalle euristiche statiche.",
        suggestedFixIt:
          "1) Leggere logs/difficult_activities.txt e logs/initial_order.txt (attività n+1 dopo max placed). 2) Rilanciare fet_diagnose con includeStatic. 3) Allentare i vincoli a 100% su quell'attività.",
        source: "fet_result",
        evidence: (art.resultTxt ?? art.stdout ?? "Impossible").slice(0, 300),
        confidence: "low",
      });
    }
  }

  if (outcome === "time_exceeded") {
    blockers.push({
      code: "fet_time_exceeded",
      severity: "warning",
      titleIt: "Limite di tempo generazione superato",
      detailIt:
        "Non è necessariamente un conflitto duro: l'orario può essere difficile. Max placed / difficult activities aiutano a capire dove si blocca.",
      suggestedFixIt:
        "Aumentare timeLimitSeconds, semplificare vincoli soft/hard, o usare difficult_activities come guida.",
      source: "fet_result",
      confidence: "medium",
    });
  }

  // Dedup
  const seen = new Set<string>();
  return blockers.filter((b) => {
    const key = `${b.code}|${b.titleIt}|${(b.activityIds ?? []).join(",")}|${(b.evidence ?? "").slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const DIAGNOSE_LIMITS_IT = [
  "Quando fet-cl stampa solo «Impossible», spesso non nomina il Constraint* colpevole: servono logs/difficult_activities.txt, initial_order.txt e le euristiche statiche MCP.",
  "I messaggi dettagliati di precompute finiscono in logs/errors.txt (Title/Message); su Windows la console può essere povera.",
  "Le euristiche statiche coprono overload, NotAvailable totali, MinDays vs giorni, preferred clash e riferimenti rotti — non l'intero spazio di ricerca FET.",
  "Un time-limit raggiunto non prova l'impossibilità: può servire più tempo o vincoli più morbidi.",
];
