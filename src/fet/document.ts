import fs from "node:fs";
import { FET_VERSION } from "../config.js";
import {
  ENTITY_LIST_TAGS,
  type EntityKind,
  getConstraintType,
  type ConstraintKind,
} from "./catalog.js";
import {
  child,
  childrenOf,
  el,
  elementToFields,
  ensureList,
  fieldsToChildren,
  parseXml,
  replaceChildrenFromFields,
  serializeXml,
  setTextChild,
  textEl,
  textOf,
  type XmlElement,
} from "./xml.js";

export type FetMode = "Official" | "Mornings_Afternoons" | "Block_Planning" | "Terms";

export interface FetMeta {
  version: string;
  mode: FetMode | string;
  institutionName: string;
  comments: string;
  numberOfTerms?: number;
  numberOfDaysPerTerm?: number;
}

export interface DocumentSummary {
  path?: string;
  version?: string;
  mode?: string;
  institutionName?: string;
  comments?: string;
  counts: Record<string, number>;
  timeConstraintsByType: Record<string, number>;
  spaceConstraintsByType: Record<string, number>;
  generationOptions: number;
}

function emptyList(tag: string, extras: XmlElement[] = []): XmlElement {
  return el(tag, extras);
}

/** Create a minimal Official FET 7.12 document matching Rules::write section order. */
export function createEmptyDocument(opts?: {
  mode?: FetMode;
  institutionName?: string;
  comments?: string;
  days?: string[];
  hours?: string[];
}): XmlElement {
  const mode = opts?.mode ?? "Official";
  const days = opts?.days ?? ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  const hours = opts?.hours ?? ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00"];

  const children: XmlElement[] = [
    textEl("Mode", mode),
    textEl("Institution_Name", opts?.institutionName ?? "Default institution"),
    textEl("Comments", opts?.comments ?? ""),
  ];

  if (mode === "Terms") {
    children.push(textEl("Number_of_Terms", "3"));
    children.push(textEl("Number_of_Days_Per_Term", "5"));
  }

  children.push(
    emptyList("Days_List", [
      textEl("Number_of_Days", String(days.length)),
      ...days.map((name) => el("Day", [textEl("Name", name), textEl("Long_Name", "")])),
    ]),
  );

  if (mode === "Mornings_Afternoons") {
    const realDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    children.push(
      emptyList("Real_Days_List", [
        textEl("Number_of_Real_Days", String(realDays.length)),
        ...realDays.map((name) => el("Real_Day", [textEl("Name", name), textEl("Long_Name", "")])),
      ]),
    );
  }

  children.push(
    emptyList("Hours_List", [
      textEl("Number_of_Hours", String(hours.length)),
      ...hours.map((name) => el("Hour", [textEl("Name", name), textEl("Long_Name", "")])),
    ]),
  );

  if (mode === "Mornings_Afternoons") {
    children.push(
      emptyList("Real_Hours_List", [
        textEl("Number_of_Real_Hours", String(hours.length)),
        ...hours.map((name) => el("Real_Hour", [textEl("Name", name), textEl("Long_Name", "")])),
      ]),
    );
  }

  children.push(
    emptyList("Subjects_List"),
    emptyList("Activity_Tags_List"),
    emptyList("Teachers_List"),
    emptyList("Students_List"),
    emptyList("Activities_List"),
    emptyList("Buildings_List"),
    emptyList("Rooms_List"),
    emptyList("Time_Constraints_List", [
      el("ConstraintBasicCompulsoryTime", [
        textEl("Weight_Percentage", "100"),
        textEl("Active", "true"),
        textEl("Comments", ""),
      ]),
    ]),
    emptyList("Space_Constraints_List", [
      el("ConstraintBasicCompulsorySpace", [
        textEl("Weight_Percentage", "100"),
        textEl("Active", "true"),
        textEl("Comments", ""),
      ]),
    ]),
    emptyList("Timetable_Generation_Options_List"),
  );

  return {
    tag: "fet",
    attrs: { version: FET_VERSION },
    children,
  };
}

function constraintListTag(kind: ConstraintKind): string {
  if (kind === "time") return "Time_Constraints_List";
  if (kind === "space") return "Space_Constraints_List";
  return "Timetable_Generation_Options_List";
}

export class FetDocument {
  root: XmlElement;
  sourcePath?: string;
  dirty = false;

  constructor(root: XmlElement, sourcePath?: string) {
    if (root.tag.toLowerCase() !== "fet") {
      throw new Error(`Expected <fet> root, got <${root.tag}>`);
    }
    this.root = root;
    this.sourcePath = sourcePath;
  }

  static create(opts?: Parameters<typeof createEmptyDocument>[0]): FetDocument {
    return new FetDocument(createEmptyDocument(opts));
  }

  static loadFile(filePath: string): FetDocument {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
    const raw = fs.readFileSync(filePath, "utf8");
    const root = parseXml(raw);
    return new FetDocument(root, filePath);
  }

  saveFile(filePath?: string): string {
    const dest = filePath ?? this.sourcePath;
    if (!dest) throw new Error("No destination path (pass filePath or open/save with a path first)");
    // Keep version attribute current when we write.
    if (!this.root.attrs.version) this.root.attrs.version = FET_VERSION;
    const xml = serializeXml(this.root, { includeBom: true });
    fs.writeFileSync(dest, xml, "utf8");
    this.sourcePath = dest;
    this.dirty = false;
    return dest;
  }

  toXml(): string {
    return serializeXml(this.root, { includeBom: true });
  }

  getMeta(): FetMeta {
    const version = this.root.attrs.version ?? FET_VERSION;
    const mode = textOf(this.root, "Mode") ?? "Official";
    const institutionName = textOf(this.root, "Institution_Name") ?? "";
    const comments = textOf(this.root, "Comments") ?? "";
    const nTerms = textOf(this.root, "Number_of_Terms");
    const nDays = textOf(this.root, "Number_of_Days_Per_Term");
    return {
      version,
      mode,
      institutionName,
      comments,
      numberOfTerms: nTerms != null ? Number(nTerms) : undefined,
      numberOfDaysPerTerm: nDays != null ? Number(nDays) : undefined,
    };
  }

  setMeta(patch: Partial<FetMeta>): FetMeta {
    if (patch.version != null) this.root.attrs.version = patch.version;
    if (patch.mode != null) setTextChild(this.root, "Mode", patch.mode);
    if (patch.institutionName != null) setTextChild(this.root, "Institution_Name", patch.institutionName);
    if (patch.comments != null) setTextChild(this.root, "Comments", patch.comments);
    if (patch.numberOfTerms != null) setTextChild(this.root, "Number_of_Terms", String(patch.numberOfTerms));
    if (patch.numberOfDaysPerTerm != null) {
      setTextChild(this.root, "Number_of_Days_Per_Term", String(patch.numberOfDaysPerTerm));
    }
    this.dirty = true;
    return this.getMeta();
  }

  private listInfo(kind: EntityKind) {
    return ENTITY_LIST_TAGS[kind];
  }

  listEntities(kind: EntityKind): Array<{ index: number; fields: Record<string, unknown> }> {
    const { listTag, itemTag } = this.listInfo(kind);
    const list = child(this.root, listTag);
    if (!list) return [];
    return childrenOf(list, itemTag).map((node, index) => ({
      index,
      fields: elementToFields(node),
    }));
  }

  getEntity(kind: EntityKind, index: number): { index: number; fields: Record<string, unknown> } {
    const items = this.listEntities(kind);
    if (index < 0 || index >= items.length) {
      throw new Error(`Entity index out of range for ${kind}: ${index} (count=${items.length})`);
    }
    return items[index]!;
  }

  private syncCount(list: XmlElement, countTag: string | undefined, itemTag: string): void {
    if (!countTag) return;
    const n = childrenOf(list, itemTag).length;
    setTextChild(list, countTag, String(n));
    // Keep count tag before items when possible: rebuild order count + items + other non-items.
    const countEl = child(list, countTag)!;
    const items = childrenOf(list, itemTag);
    const others = list.children.filter((c) => c.tag !== countTag && c.tag !== itemTag);
    list.children = [countEl, ...items, ...others];
  }

  upsertEntity(
    kind: EntityKind,
    fields: Record<string, unknown>,
    index?: number,
  ): { index: number; fields: Record<string, unknown> } {
    const { listTag, itemTag, countTag } = this.listInfo(kind);
    const list = ensureList(this.root, listTag);
    const items = childrenOf(list, itemTag);
    const node = el(itemTag, fieldsToChildren(fields));
    let idx: number;
    if (index == null || index < 0 || index >= items.length) {
      list.children.push(node);
      idx = childrenOf(list, itemTag).length - 1;
    } else {
      const existing = items[index]!;
      const pos = list.children.indexOf(existing);
      list.children[pos] = node;
      idx = index;
    }
    this.syncCount(list, countTag, itemTag);
    this.dirty = true;
    return { index: idx, fields: elementToFields(node) };
  }

  removeEntity(kind: EntityKind, index: number): { removed: true; remaining: number } {
    const { listTag, itemTag, countTag } = this.listInfo(kind);
    const list = child(this.root, listTag);
    if (!list) throw new Error(`Missing list ${listTag}`);
    const items = childrenOf(list, itemTag);
    if (index < 0 || index >= items.length) {
      throw new Error(`Entity index out of range for ${kind}: ${index}`);
    }
    const target = items[index]!;
    list.children = list.children.filter((c) => c !== target);
    this.syncCount(list, countTag, itemTag);
    this.dirty = true;
    return { removed: true, remaining: childrenOf(list, itemTag).length };
  }

  /** Replace entire days/hours name lists (common convenience). */
  setNamedList(kind: "days" | "hours" | "real_days" | "real_hours", names: Array<string | { Name: string; Long_Name?: string }>): void {
    const items = names.map((n) => {
      if (typeof n === "string") return { Name: n, Long_Name: "" };
      return { Name: n.Name, Long_Name: n.Long_Name ?? "" };
    });
    const { listTag, itemTag, countTag } = this.listInfo(kind);
    const list = ensureList(this.root, listTag);
    list.children = [
      ...(countTag ? [textEl(countTag, String(items.length))] : []),
      ...items.map((f) => el(itemTag, fieldsToChildren(f))),
    ];
    this.dirty = true;
  }

  private constraintNodes(kind: ConstraintKind): XmlElement[] {
    const list = child(this.root, constraintListTag(kind));
    if (!list) return [];
    if (kind === "generation_option") {
      return childrenOf(list, "GroupActivitiesInInitialOrder");
    }
    return list.children.filter((c) => c.tag.startsWith("Constraint") && c.tag !== "#comment");
  }

  listConstraints(filter?: {
    kind?: ConstraintKind;
    type?: string;
  }): Array<{ kind: ConstraintKind; index: number; type: string; fields: Record<string, unknown> }> {
    const kinds: ConstraintKind[] = filter?.kind
      ? [filter.kind]
      : ["time", "space", "generation_option"];
    const out: Array<{ kind: ConstraintKind; index: number; type: string; fields: Record<string, unknown> }> = [];
    for (const kind of kinds) {
      const nodes = this.constraintNodes(kind);
      nodes.forEach((node, index) => {
        if (filter?.type && node.tag !== filter.type) return;
        out.push({ kind, index, type: node.tag, fields: elementToFields(node) });
      });
    }
    return out;
  }

  getConstraint(kind: ConstraintKind, index: number): {
    kind: ConstraintKind;
    index: number;
    type: string;
    fields: Record<string, unknown>;
  } {
    const nodes = this.constraintNodes(kind);
    if (index < 0 || index >= nodes.length) {
      throw new Error(`Constraint index out of range for ${kind}: ${index} (count=${nodes.length})`);
    }
    const node = nodes[index]!;
    return { kind, index, type: node.tag, fields: elementToFields(node) };
  }

  addConstraint(
    type: string,
    fields: Record<string, unknown>,
  ): { kind: ConstraintKind; index: number; type: string; fields: Record<string, unknown> } {
    const info = getConstraintType(type);
    if (!info) {
      throw new Error(`Unknown constraint type: ${type}. Use fet_constraint_catalog to list types.`);
    }
    const kind = info.kind;
    const list = ensureList(this.root, constraintListTag(kind));
    const merged = {
      Weight_Percentage: fields.Weight_Percentage ?? "100",
      ...fields,
      Active: fields.Active ?? "true",
      Comments: fields.Comments ?? "",
    };
    // generation option has no Weight_Percentage
    if (kind === "generation_option") {
      delete (merged as Record<string, unknown>).Weight_Percentage;
    }
    const node = el(type, fieldsToChildren(merged));
    list.children.push(node);
    this.dirty = true;
    const index = this.constraintNodes(kind).length - 1;
    return { kind, index, type, fields: elementToFields(node) };
  }

  updateConstraint(
    kind: ConstraintKind,
    index: number,
    fields: Record<string, unknown>,
    replace = false,
  ): { kind: ConstraintKind; index: number; type: string; fields: Record<string, unknown> } {
    const nodes = this.constraintNodes(kind);
    if (index < 0 || index >= nodes.length) {
      throw new Error(`Constraint index out of range for ${kind}: ${index}`);
    }
    const node = nodes[index]!;
    if (replace) {
      replaceChildrenFromFields(node, fields);
    } else {
      const current = elementToFields(node);
      replaceChildrenFromFields(node, { ...current, ...fields });
    }
    this.dirty = true;
    return { kind, index, type: node.tag, fields: elementToFields(node) };
  }

  removeConstraint(kind: ConstraintKind, index: number): { removed: true; type: string; remaining: number } {
    const list = child(this.root, constraintListTag(kind));
    if (!list) throw new Error(`Missing constraint list for ${kind}`);
    const nodes = this.constraintNodes(kind);
    if (index < 0 || index >= nodes.length) {
      throw new Error(`Constraint index out of range for ${kind}: ${index}`);
    }
    const target = nodes[index]!;
    const type = target.tag;
    list.children = list.children.filter((c) => c !== target);
    this.dirty = true;
    return { removed: true, type, remaining: this.constraintNodes(kind).length };
  }

  summarize(): DocumentSummary {
    const meta = this.getMeta();
    const counts: Record<string, number> = {};
    for (const kind of Object.keys(ENTITY_LIST_TAGS) as EntityKind[]) {
      counts[kind] = this.listEntities(kind).length;
    }
    const timeConstraintsByType: Record<string, number> = {};
    const spaceConstraintsByType: Record<string, number> = {};
    for (const c of this.listConstraints({ kind: "time" })) {
      timeConstraintsByType[c.type] = (timeConstraintsByType[c.type] ?? 0) + 1;
    }
    for (const c of this.listConstraints({ kind: "space" })) {
      spaceConstraintsByType[c.type] = (spaceConstraintsByType[c.type] ?? 0) + 1;
    }
    return {
      path: this.sourcePath,
      version: meta.version,
      mode: meta.mode,
      institutionName: meta.institutionName,
      comments: meta.comments.slice(0, 500),
      counts,
      timeConstraintsByType,
      spaceConstraintsByType,
      generationOptions: this.listConstraints({ kind: "generation_option" }).length,
    };
  }
}
