import { openOfficePackage, resolveOfficePart, type OfficePackageInput, type OfficePackageSignal, type OfficePackageArchive } from "../ooxml";
import { createContext, child, localName, textContent, relationship, type Node, type PptxContext, type Relations } from "./pptx-reader";
const mainType = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
const templateType = "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml";
const fail = (message: string): never => { throw new Error(`PowerPointを読み込めません: ${message}`); };
export type PptxPresentationPackage = {
  context: PptxContext; archive: OfficePackageArchive; presentation: Node; presentationLinks: Relations;
  width: number; height: number; title: string;
};
/** One bounded, non-network package boundary for full decks and template-only imports. */
export async function openPptxPresentation(input: OfficePackageInput, options: { signal?: OfficePackageSignal } = {}): Promise<PptxPresentationPackage> {
  const signal = options.signal; signal?.throwIfAborted();
  if (input && typeof input === "object" && "name" in input && typeof input.name === "string" && !/\.(?:pptx|potx)$/i.test(input.name))
    return fail(".pptx または .potx形式を指定してください。古い.ppt形式と暗号化ファイルには対応していません");
  let archive: OfficePackageArchive;
  try { archive = await openOfficePackage(input, signal); }
  catch (cause) { if (signal?.aborted || cause instanceof Error && cause.name === "AbortError") throw cause;
    return fail(`暗号化されていない.pptx または .potx形式を指定してください（古い.pptは未対応）。${cause instanceof Error ? cause.message : "不正なファイルです"}`); }
  const context = createContext(archive, signal), content = await context.root("[Content_Types].xml"), contentTypes = new Map<string, string>();
  if (localName(content.name) !== "Types") return fail("Officeパッケージの構造が不正です");
  for (const entry of content.children) {
    const type = entry.attributes.ContentType;
    if (!type || /macroEnabled|vbaProject|encrypted/i.test(type)) return fail("マクロ・暗号化ファイルには対応していません");
    if (localName(entry.name) === "Override") {
      const path = resolveOfficePart("", entry.attributes.PartName ?? "");
      if (contentTypes.has(path)) return fail("コンテンツ形式が重複しています");
      contentTypes.set(path, type);
    }
  }
  if (archive.paths.some(path => /(?:^|\/)(?:vbaProject\.bin|EncryptedPackage|EncryptionInfo)$/i.test(path))) return fail("マクロ・暗号化ファイルには対応していません");
  for (const path of archive.paths.filter(path => path.endsWith(".rels"))) {
    const match = /^(?:(.*)\/)?_rels\/([^/]*)\.rels$/.exec(path); if (!match) return fail("参照情報の場所が不正です");
    const part = `${match[1] ? `${match[1]}/` : ""}${match[2]}`;
    for (const link of (await context.links(part)).values()) {
      if (/vbaProject|attachedTemplate/i.test(link.type)) return fail("マクロ・外部テンプレートには対応していません");
      if (link.external) context.warn("外部リンク・外部画像を読み込まずに省略しました");
    }
  }
  const packageLinks = await context.links(""), presentationLink = relationship(packageLinks, "officeDocument");
  if (!presentationLink || ![mainType, templateType].includes(contentTypes.get(presentationLink.target) ?? "")) return fail(".pptx または .potx形式のプレゼンテーションではありません");
  const presentation = await context.root(presentationLink.target), presentationLinks = await context.links(presentationLink.target);
  if (localName(presentation.name) !== "presentation") return fail("プレゼンテーションの構造が不正です");
  const size = child(presentation, "sldSz"), width = Number(size?.attributes.cx) / 9525, height = Number(size?.attributes.cy) / 9525;
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) return fail("スライドのサイズが不正です");
  const titleLink = [...packageLinks.values()].find(link => link.type.endsWith("/metadata/core-properties") && !link.external);
  const title = titleLink ? textContent(child(await context.root(titleLink.target), "title")) : "";
  return { context, archive, presentation, presentationLinks, width, height, title };
}
