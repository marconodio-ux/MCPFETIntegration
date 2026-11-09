/**
 * Minimal XML element model tuned for FET .fet files
 * (element tree, attribute map, escaped text leaves).
 */

export interface XmlElement {
  tag: string;
  attrs: Record<string, string>;
  /** Present when this node is a text leaf (may be empty string). */
  text?: string;
  children: XmlElement[];
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    attrs[m[1]] = unescapeXml(m[2] ?? m[3] ?? "");
  }
  return attrs;
}

/**
 * Parse a FET XML document into an element tree.
 * Skips XML declaration, DOCTYPE, and comments.
 */
export function parseXml(xml: string): XmlElement {
  const s = xml.replace(/^\uFEFF/, "");
  let i = 0;
  const len = s.length;

  const skipWs = () => {
    while (i < len && /\s/.test(s[i]!)) i++;
  };

  const parseNode = (): XmlElement | null => {
    skipWs();
    if (i >= len) return null;
    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i + 4);
      if (end < 0) throw new Error("Unterminated XML comment");
      const text = s.slice(i + 4, end);
      i = end + 3;
      // Preserve comments for round-trip (synthetic tag).
      return { tag: "#comment", attrs: {}, text, children: [] };
    }
    if (s.startsWith("<?", i)) {
      const end = s.indexOf("?>", i + 2);
      if (end < 0) throw new Error("Unterminated XML processing instruction");
      i = end + 2;
      return parseNode();
    }
    if (s.startsWith("<!", i)) {
      const end = s.indexOf(">", i + 2);
      if (end < 0) throw new Error("Unterminated XML declaration");
      i = end + 1;
      return parseNode();
    }
    if (s[i] !== "<") {
      throw new Error(`Expected '<' at position ${i}`);
    }
    if (s[i + 1] === "/") {
      return null;
    }

    const tagStart = i + 1;
    let j = tagStart;
    while (j < len && /[A-Za-z0-9_.:-]/.test(s[j]!)) j++;
    const tag = s.slice(tagStart, j);
    if (!tag) throw new Error(`Empty tag at position ${i}`);

    let k = j;
    while (k < len && s[k] !== ">" && !(s[k] === "/" && s[k + 1] === ">")) k++;
    if (k >= len) throw new Error(`Unterminated start tag <${tag}>`);
    const attrRaw = s.slice(j, k);
    const attrs = parseAttrs(attrRaw);

    if (s[k] === "/" && s[k + 1] === ">") {
      i = k + 2;
      return { tag, attrs, children: [], text: "" };
    }
    if (s[k] !== ">") throw new Error(`Malformed start tag <${tag}>`);
    i = k + 1;

    const children: XmlElement[] = [];
    let textParts: string[] = [];

    while (i < len) {
      skipWs();
      if (s.startsWith(`</${tag}`, i)) {
        const closeEnd = s.indexOf(">", i);
        if (closeEnd < 0) throw new Error(`Unterminated end tag </${tag}>`);
        i = closeEnd + 1;
        break;
      }
      if (s[i] === "<") {
        const child = parseNode();
        if (!child) {
          // closing tag of parent handled above; if we see other close, bubble
          break;
        }
        children.push(child);
        continue;
      }
      const next = s.indexOf("<", i);
      const chunk = next < 0 ? s.slice(i) : s.slice(i, next);
      textParts.push(unescapeXml(chunk));
      i = next < 0 ? len : next;
    }

    const textCombined = textParts.join("").replace(/^\s+|\s+$/g, "");
    if (children.length === 0) {
      return { tag, attrs, children: [], text: textCombined };
    }
    return { tag, attrs, children };
  };

  skipWs();
  let root: XmlElement | null = null;
  while (i < len) {
    const node = parseNode();
    if (!node) break;
    if (node.tag === "#comment") continue;
    root = node;
    break;
  }
  if (!root) throw new Error("No root element found");
  return root;
}

export function serializeXml(root: XmlElement, opts?: { includeBom?: boolean; versionAttr?: string }): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("");

  const write = (node: XmlElement, indent: number) => {
    const pad = "\t".repeat(Math.max(0, indent));
    if (node.tag === "#comment") {
      lines.push(`${pad}<!--${node.text ?? ""}-->`);
      return;
    }
    const attrStr = Object.entries(node.attrs)
      .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
      .join("");
    if (node.children.length === 0) {
      const text = node.text ?? "";
      lines.push(`${pad}<${node.tag}${attrStr}>${escapeXml(text)}</${node.tag}>`);
      return;
    }
    lines.push(`${pad}<${node.tag}${attrStr}>`);
    for (const child of node.children) write(child, indent + 1);
    lines.push(`${pad}</${node.tag}>`);
  };

  write(root, 0);
  lines.push("");
  const body = lines.join("\n");
  return (opts?.includeBom === false ? "" : "\uFEFF") + body;
}

export function el(tag: string, children: XmlElement[] = [], text?: string, attrs: Record<string, string> = {}): XmlElement {
  if (text !== undefined && children.length === 0) {
    return { tag, attrs, text, children: [] };
  }
  return { tag, attrs, children };
}

export function textEl(tag: string, text: string, attrs: Record<string, string> = {}): XmlElement {
  return { tag, attrs, text, children: [] };
}

export function child(parent: XmlElement, tag: string): XmlElement | undefined {
  return parent.children.find((c) => c.tag === tag);
}

export function childrenOf(parent: XmlElement, tag: string): XmlElement[] {
  return parent.children.filter((c) => c.tag === tag);
}

export function textOf(parent: XmlElement, tag: string): string | undefined {
  const c = child(parent, tag);
  return c?.text;
}

export function setTextChild(parent: XmlElement, tag: string, value: string): void {
  const existing = child(parent, tag);
  if (existing) {
    existing.text = value;
    existing.children = [];
    return;
  }
  parent.children.push(textEl(tag, value));
}

export function ensureList(root: XmlElement, listTag: string): XmlElement {
  let list = child(root, listTag);
  if (!list) {
    list = el(listTag, []);
    root.children.push(list);
  }
  return list;
}

/** Convert an XML element (excluding its own tag) into a JSON-friendly fields object. */
export function elementToFields(node: XmlElement): Record<string, unknown> {
  if (node.children.length === 0) {
    return {};
  }
  const groups = new Map<string, XmlElement[]>();
  for (const c of node.children) {
    const arr = groups.get(c.tag) ?? [];
    arr.push(c);
    groups.set(c.tag, arr);
  }
  const out: Record<string, unknown> = {};
  for (const [tag, nodes] of groups) {
    const mapped = nodes.map((n) => {
      if (n.children.length === 0) return n.text ?? "";
      return elementToFields(n);
    });
    out[tag] = mapped.length === 1 ? mapped[0] : mapped;
  }
  return out;
}

/** Build child elements from a JSON fields object (mirrors elementToFields). */
export function fieldsToChildren(fields: Record<string, unknown>): XmlElement[] {
  const children: XmlElement[] = [];
  for (const [tag, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          children.push(el(tag, fieldsToChildren(item as Record<string, unknown>)));
        } else {
          children.push(textEl(tag, item == null ? "" : String(item)));
        }
      }
    } else if (value !== null && typeof value === "object") {
      children.push(el(tag, fieldsToChildren(value as Record<string, unknown>)));
    } else {
      children.push(textEl(tag, value == null ? "" : String(value)));
    }
  }
  return children;
}

export function replaceChildrenFromFields(node: XmlElement, fields: Record<string, unknown>): void {
  node.children = fieldsToChildren(fields);
  delete node.text;
}
