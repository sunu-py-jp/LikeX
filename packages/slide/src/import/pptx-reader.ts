import { officeXml, type OfficeXmlNode, type OfficePackageArchive, type OfficeRelationship, type OfficePackageSignal, readOfficeRelationships } from "../ooxml";

export const { child, children, attribute, localName, textContent, spreadsheetText } = officeXml;
export type Node = OfficeXmlNode;
export type Relations = ReadonlyMap<string, OfficeRelationship>;
export type Theme = { colors: Record<string, string>; majorFont: string; minorFont: string };
export type PptxContext = {
  archive: OfficePackageArchive; signal?: OfficePackageSignal; warnings: Set<string>;
  roots: Map<string, Node>; relations: Map<string, Relations>; images: Map<string, string>;
  textCharacters: number; totalElements: number;
  warn(message: string): void;
  root(path: string): Promise<Node>;
  links(path: string): Promise<Relations>;
};
export function createContext(archive: OfficePackageArchive, signal?: OfficePackageSignal): PptxContext {
  const context: PptxContext = { archive, signal, warnings: new Set(), roots: new Map(), relations: new Map(), images: new Map(), textCharacters: 0, totalElements: 0,
    warn(message) { this.warnings.add(message); },
    async root(path) { signal?.throwIfAborted(); let root = this.roots.get(path); if (!root) { root = officeXml.parseXml(await archive.read(path)); this.roots.set(path, root); } return root; },
    async links(path) { let links = this.relations.get(path); if (!links) { links = await readOfficeRelationships(archive, path); this.relations.set(path, links); } return links; } };
  return context;
}
export const relationship = (relations: Relations, kind: string) => [...relations.values()].find(item => item.type.endsWith(`/${kind}`) && !item.external);
export const shapes = (root: Node | undefined): Node[] => child(child(root, "cSld"), "spTree")?.children.filter(node => !["nvGrpSpPr", "grpSpPr", "extLst"].includes(localName(node.name))) ?? [];
export function placeholder(node: Node | undefined): Node | undefined {
  const nv = node?.children.find(item => ["nvSpPr", "nvPicPr", "nvCxnSpPr"].includes(localName(item.name)));
  return child(child(nv, "nvPr"), "ph");
}
export function nonVisual(node: Node): Node | undefined {
  return child(node.children.find(item => ["nvSpPr", "nvPicPr", "nvCxnSpPr"].includes(localName(item.name))), "cNvPr");
}
export async function readTheme(context: PptxContext, masterPath: string | undefined): Promise<Theme> {
  const theme: Theme = { colors: { dk1: "#000000", lt1: "#FFFFFF", dk2: "#1F497D", lt2: "#EEECE1", accent1: "#4F81BD", accent2: "#C0504D", accent3: "#9BBB59", accent4: "#8064A2", accent5: "#4BACC6", accent6: "#F79646", hlink: "#0000FF", folHlink: "#800080" }, majorFont: "Arial", minorFont: "Arial" };
  const relation = masterPath ? relationship(await context.links(masterPath), "theme") : undefined;
  if (!relation) return theme;
  const root = await context.root(relation.target), elements = child(root, "themeElements"), scheme = child(elements, "clrScheme");
  for (const node of scheme?.children ?? []) {
    const color = node.children[0], value = color?.attributes.lastClr ?? color?.attributes.val;
    if (value && /^[a-f0-9]{6}$/i.test(value)) theme.colors[localName(node.name)] = `#${value.toUpperCase()}`;
  }
  const font = child(elements, "fontScheme");
  theme.majorFont = child(child(font, "majorFont"), "latin")?.attributes.typeface || "Arial";
  theme.minorFont = child(child(font, "minorFont"), "latin")?.attributes.typeface || "Arial";
  return theme;
}
export function color(node: Node | undefined, theme: Theme, mapping: Record<string, string>, context: PptxContext): string | undefined {
  if (!node) return;
  const item = ["srgbClr", "schemeClr", "sysClr"].includes(localName(node.name)) ? node : node.children.find(value => ["srgbClr", "schemeClr", "sysClr"].includes(localName(value.name)));
  if (!item) return;
  const kind = localName(item.name), raw = item.attributes.val;
  let value = kind === "schemeClr" ? theme.colors[mapping[raw] ?? raw] : `#${item.attributes.lastClr ?? raw}`;
  if (!value || !/^#[a-f0-9]{6}$/i.test(value)) return;
  let rgb = value.slice(1).match(/../g)!.map(channel => parseInt(channel, 16));
  let alpha = 1;
  for (const transform of item.children) {
    const amount = Number(transform.attributes.val) / 100000;
    if (!Number.isFinite(amount)) throw new Error("PowerPointの色指定が不正です");
    switch (localName(transform.name)) {
      case "alpha": alpha = amount; break;
      case "alphaMod": alpha *= amount; break;
      case "tint": rgb = rgb.map(channel => channel * amount + 255 * (1 - amount)); break;
      case "shade": rgb = rgb.map(channel => channel * amount); break;
      case "lumMod": rgb = rgb.map(channel => channel * amount); context.warn("テーマ色の明度をRGB色へ近似しました"); break;
      case "lumOff": rgb = rgb.map(channel => channel + 255 * amount); context.warn("テーマ色の明度をRGB色へ近似しました"); break;
      default: context.warn("未対応の色変換を省略しました");
    }
  }
  value = `#${rgb.map(channel => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, "0")).join("")}`;
  return alpha < 1 ? `${value}${Math.round(Math.max(0, alpha) * 255).toString(16).padStart(2, "0")}` : value;
}
export function readFill(properties: Node | undefined, theme: Theme, mapping: Record<string, string>, context: PptxContext): string | undefined {
  if (!properties) return;
  if (child(properties, "noFill")) return "transparent";
  const solid = child(properties, "solidFill"); if (solid) return color(solid, theme, mapping, context);
  if (["gradFill", "pattFill", "blipFill"].some(key => child(properties, key))) context.warn("グラデーション・模様・画像の塗りつぶしを単色へ変更しました");
}
export function plainText(body: Node | undefined): string {
  return children(body, "p").map(paragraph => paragraph.children.map(item => localName(item.name) === "br" ? "\n" : ["r", "fld"].includes(localName(item.name)) ? textContent(child(item, "t")) : "").join("")).join("\n");
}
