import type { OfficePackageArchive } from "./zip-reader";
import { children, localName, parseXml } from "./xml";

export type OfficeRelationship = { id: string; type: string; target: string; external: boolean };
export function resolvePart(part: string, target: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(target); } catch { throw new Error("Officeの参照パスが不正です"); }
  if (!decoded || /[\\\u0000-\u001f\u007f?#:%]/.test(decoded) || decoded.startsWith("//")) throw new Error("Officeの参照先がパッケージ外です");
  const segments = decoded.startsWith("/") ? [] : part.split("/").slice(0, -1);
  for (const piece of decoded.replace(/^\//, "").split("/")) {
    if (piece === "..") { if (!segments.length) throw new Error("Officeの参照先がパッケージ外です"); segments.pop(); }
    else if (piece !== "." && piece !== "") segments.push(piece);
  }
  if (!segments.length) throw new Error("Officeの参照パスが不正です");
  return segments.join("/");
}
export async function readRelationships(archive: OfficePackageArchive, part: string): Promise<ReadonlyMap<string, OfficeRelationship>> {
  const slash = part.lastIndexOf("/"), path = part ? `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels` : "_rels/.rels";
  const result = new Map<string, OfficeRelationship>();
  if (!archive.has(path)) return result;
  const root = parseXml(await archive.read(path));
  if (localName(root.name) !== "Relationships") throw new Error("Officeの参照情報が不正です");
  for (const node of children(root, "Relationship")) {
    const { Id: id, Type: type, Target: raw, TargetMode: mode } = node.attributes;
    if (!id || !type || !raw || result.has(id) || (mode !== undefined && mode !== "External" && mode !== "Internal")) throw new Error("Officeの参照情報が不正です");
    const external = mode === "External", target = external ? raw : resolvePart(part, raw);
    if (!external && !archive.has(target)) throw new Error(`Officeの参照先がありません（${target}）`);
    result.set(id, { id, type, target, external });
  }
  return result;
}
