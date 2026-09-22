import { officeXml, type OfficeXmlNode, type OfficeRelationship } from "../ooxml";

export type Node = { type: string; attrs?: Record<string, unknown>; text?: string; marks?: Mark[]; content?: Node[] };
export type Mark = { type: string; attrs?: Record<string, unknown> };
export type XmlNode = OfficeXmlNode;
export const { child, children, attribute: attr, localName, textContent } = officeXml;
export const relation = (links: ReadonlyMap<string, OfficeRelationship>, type: string) => [...links.values()].find(link => !link.external && link.type.endsWith(`/${type}`));
export const descendants = (node: XmlNode, name: string): XmlNode[] => {
  const result: XmlNode[] = [], stack = [node];
  while (stack.length) { const next = stack.pop()!; if (localName(next.name) === name) result.push(next); stack.push(...[...next.children].reverse()); }
  return result;
};
export const on = (node: XmlNode | undefined): boolean | undefined => !node ? undefined : !["0", "false", "off", "none"].includes(attr(node, "val") ?? "");
const color = (value: string | undefined): string | undefined => value && /^[a-f\d]{6}$/i.test(value) ? `#${value.toUpperCase()}` : undefined;

export type Style = { strong?: boolean; em?: boolean; underline?: boolean; strike?: boolean;
  fontFamily?: string; fontSize?: number; color?: string; backgroundColor?: string;
  align?: string; level?: number; numId?: string; listLevel?: number };
export function runStyle(properties: XmlNode | undefined): Style {
  const result: Style = {};
  for (const [tag, mark] of [["b", "strong"], ["i", "em"], ["u", "underline"], ["strike", "strike"]] as const) {
    const value = on(child(properties, tag)); if (value !== undefined) result[mark] = value;
  }
  const family = attr(child(properties, "rFonts"), "ascii") ?? attr(child(properties, "rFonts"), "eastAsia");
  if (family && family.length <= 200 && /^[\p{L}\p{N} ,.'"_-]+$/u.test(family)) result.fontFamily = family;
  const size = Number(attr(child(properties, "sz"), "val")) / 2;
  if (size >= 4 && size <= 240) result.fontSize = size;
  const foreground = color(attr(child(properties, "color"), "val")); if (foreground) result.color = foreground;
  const highlight: Record<string, string> = { yellow: "#FFFF00", green: "#00FF00", cyan: "#00FFFF", magenta: "#FF00FF", blue: "#0000FF", red: "#FF0000", darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080", lightGray: "#C0C0C0", black: "#000000", white: "#FFFFFF" };
  const background = color(attr(child(properties, "shd"), "fill")) ?? highlight[attr(child(properties, "highlight"), "val") ?? ""];
  if (background) result.backgroundColor = background;
  return result;
}
export function paragraphStyle(properties: XmlNode | undefined): Style {
  const result: Style = {}, align = attr(child(properties, "jc"), "val"), outline = Number(attr(child(properties, "outlineLvl"), "val"));
  if (align && ["left", "right", "center", "both", "start", "end"].includes(align)) result.align = align === "both" ? "justify" : align === "start" ? "left" : align === "end" ? "right" : align;
  if (Number.isInteger(outline) && outline >= 0 && outline <= 5) result.level = outline + 1;
  const numbering = child(properties, "numPr"), id = attr(child(numbering, "numId"), "val"), level = attr(child(numbering, "ilvl"), "val");
  if (id !== undefined) result.numId = id;
  if (level !== undefined) result.listLevel = Math.max(0, Math.min(8, Number(level) || 0));
  return result;
}
export function styleMarks(style: Style): Mark[] {
  const marks: Mark[] = [];
  for (const name of ["strong", "em", "underline", "strike"] as const) if (style[name]) marks.push({ type: name });
  const attrs: Record<string, unknown> = {};
  for (const name of ["fontFamily", "fontSize", "color", "backgroundColor"] as const) if (style[name] !== undefined) attrs[name] = style[name];
  if (Object.keys(attrs).length) marks.push({ type: "text_style", attrs });
  return marks;
}

/** Resolves Word styles locally with bounded inheritance; no theme or font downloads. */
export function readStyles(root: XmlNode | undefined, warn: (message: string) => void) {
  const styles = new Map(children(root, "style").map(node => [attr(node, "styleId") ?? "", node])), cache = new Map<string, Style>();
  const defaults = { ...runStyle(child(child(child(root, "docDefaults"), "rPrDefault"), "rPr")), ...paragraphStyle(child(child(child(root, "docDefaults"), "pPrDefault"), "pPr")) };
  const defaultParagraph = children(root, "style").find(node => attr(node, "type") === "paragraph" && on({ ...node, attributes: { val: attr(node, "default") ?? "false" } }));
  function resolve(id: string | undefined, seen = new Set<string>()): Style {
    if (!id) return {};
    const existing = cache.get(id); if (existing) return existing;
    if (seen.has(id) || seen.size > 32) { warn("循環または深すぎるスタイル継承を省略しました"); return {}; }
    const node = styles.get(id); if (!node) return {};
    const inherited = resolve(attr(child(node, "basedOn"), "val"), new Set([...seen, id]));
    const output = { ...inherited, ...paragraphStyle(child(node, "pPr")), ...runStyle(child(node, "rPr")) };
    const heading = /^(?:heading|見出し)\s*([1-6])$/i.exec(attr(child(node, "name"), "val") ?? id);
    if (heading) output.level = Number(heading[1]);
    cache.set(id, output); return output;
  }
  return { defaults: { ...defaults, ...resolve(attr(defaultParagraph, "styleId")) }, resolve };
}

export type NumberingLevel = { type: "ordered_list" | "bullet_list"; order: number };
export function readNumbering(root: XmlNode | undefined, warn: (message: string) => void) {
  const abstracts = new Map(children(root, "abstractNum").map(node => [attr(node, "abstractNumId"), node]));
  const nums = new Map(children(root, "num").map(node => [attr(node, "numId"), node]));
  return (id: string, level: number): NumberingLevel => {
    const num = nums.get(id), abstract = abstracts.get(attr(child(num, "abstractNumId"), "val"));
    const override = children(num, "lvlOverride").find(node => Number(attr(node, "ilvl")) === level);
    const source = child(override, "lvl") ?? children(abstract, "lvl").find(node => Number(attr(node, "ilvl")) === level);
    const format = attr(child(source, "numFmt"), "val") ?? "decimal";
    if (!["decimal", "bullet"].includes(format)) warn("独自の番号書式は連番に変換しました");
    const start = Number(attr(child(override, "startOverride"), "val") ?? attr(child(source, "start"), "val") ?? 1);
    return { type: format === "bullet" ? "bullet_list" : "ordered_list", order: Number.isInteger(start) && start >= 1 ? start : 1 };
  };
}

export type ListedBlock = { node: Node; numId?: string; level?: number };
/** Consecutive numbering paragraphs become actual nested lists, instead of literal bullet text. */
export function groupLists(blocks: ListedBlock[], numbering: ReturnType<typeof readNumbering>): Node[] {
  const output: Node[] = [], stack: { id: string; level: number; list: Node; last: Node }[] = [];
  for (const block of blocks) {
    if (!block.numId || block.numId === "0") { stack.length = 0; output.push(block.node); continue; }
    const level = block.level ?? 0;
    while (stack.length && (stack[stack.length - 1].level > level || stack[stack.length - 1].level === level && stack[stack.length - 1].id !== block.numId)) stack.pop();
    let current = stack[stack.length - 1];
    if (!current || current.level !== level) {
      const specification = numbering(block.numId, level), list: Node = { type: specification.type, attrs: specification.type === "ordered_list" ? { order: specification.order } : {}, content: [] };
      if (current) current.last.content!.push(list); else output.push(list);
      current = { id: block.numId, level, list, last: { type: "list_item", content: [] } }; stack.push(current);
    }
    const item: Node = { type: "list_item", content: [block.node.type === "heading" ? { ...block.node, type: "paragraph" } : block.node] };
    current.list.content!.push(item); current.last = item;
  }
  return output;
}
