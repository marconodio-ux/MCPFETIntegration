import type { AdviseSuggestion } from "./types.js";

export interface AdviseSession {
  adviseId: string;
  documentId?: string;
  inputFile?: string;
  createdAt: string;
  suggestions: AdviseSuggestion[];
}

const sessions = new Map<string, AdviseSession>();

export function putAdviseSession(session: AdviseSession): void {
  sessions.set(session.adviseId, session);
}

export function getAdviseSession(adviseId: string): AdviseSession {
  const s = sessions.get(adviseId);
  if (!s) {
    throw new Error(
      `Unknown adviseId: ${adviseId}. Esegui prima fet_advise e riusa l’adviseId restituito.`,
    );
  }
  return s;
}

export function makeAdviseId(): string {
  return `advise-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
