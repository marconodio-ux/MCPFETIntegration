import { FetDocument } from "./document.js";

export interface WorkspaceEntry {
  id: string;
  doc: FetDocument;
  createdAt: string;
  updatedAt: string;
}

const docs = new Map<string, WorkspaceEntry>();

function now(): string {
  return new Date().toISOString();
}

export function makeDocId(hint?: string): string {
  const base = (hint ?? "doc")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 40) || "doc";
  let id = base;
  let n = 1;
  while (docs.has(id)) {
    id = `${base}_${n++}`;
  }
  return id;
}

export function putDocument(id: string, doc: FetDocument): WorkspaceEntry {
  const existing = docs.get(id);
  const entry: WorkspaceEntry = {
    id,
    doc,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };
  docs.set(id, entry);
  return entry;
}

export function getDocument(id: string): WorkspaceEntry {
  const entry = docs.get(id);
  if (!entry) throw new Error(`Unknown documentId: ${id}. Open/create one with fet_document_open or fet_document_new.`);
  return entry;
}

export function touchDocument(id: string): WorkspaceEntry {
  const entry = getDocument(id);
  entry.updatedAt = now();
  return entry;
}

export function listDocuments(): Array<{
  id: string;
  path?: string;
  dirty: boolean;
  mode?: string;
  institutionName?: string;
  createdAt: string;
  updatedAt: string;
}> {
  return [...docs.values()].map((e) => {
    const meta = e.doc.getMeta();
    return {
      id: e.id,
      path: e.doc.sourcePath,
      dirty: e.doc.dirty,
      mode: meta.mode,
      institutionName: meta.institutionName,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  });
}

export function closeDocument(id: string): boolean {
  return docs.delete(id);
}
