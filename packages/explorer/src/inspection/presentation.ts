import { officeXml, openOfficePackageMetadata, readOfficeRelationships, resolveOfficePart, type OfficeXmlNode } from "../core";
import type { ExplorerUploadContentMetadata, ExplorerUploadInspectFileRequest } from "../model/upload-content";

const mainType = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
const slideType = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const fail = (): never => { throw new Error("スライド数を確認できません。暗号化されていない正常な.pptxファイルを指定してください"); };
const relationshipTypes = ["http://schemas.openxmlformats.org/officeDocument/2006/relationships/", "http://purl.oclc.org/ooxml/officeDocument/relationships/"];
const presentationNamespaces = ["http://schemas.openxmlformats.org/presentationml/2006/main", "http://purl.oclc.org/ooxml/presentationml/main"];
const namespace = (name: string, attributes: Record<string, string>) => attributes[name.includes(":") ? `xmlns:${name.split(":")[0]}` : "xmlns"];
const presentationNode = (node: OfficeXmlNode, inherited: Record<string, string>) => presentationNamespaces.includes(namespace(node.name, { ...inherited, ...node.attributes }));

export async function inspectPresentation({ file, extension, signal }: ExplorerUploadInspectFileRequest): Promise<ExplorerUploadContentMetadata> {
  signal.throwIfAborted();
  if (extension !== ".pptx") throw new Error("標準のスライド数確認は.pptx形式に対応しています。upload.inspectFileを指定してください");
  const archive = await openOfficePackageMetadata(file, signal);
  if (archive.paths.some(path => /(?:^|\/)(?:vbaProject\.bin|EncryptedPackage|EncryptionInfo)$/i.test(path))) fail();
  const types = officeXml.parseXml(await archive.read("[Content_Types].xml")), contentTypes = new Map<string, string>();
  if (officeXml.localName(types.name) !== "Types") fail();
  for (const entry of types.children) {
    const type = entry.attributes.ContentType;
    if (!type || /macroEnabled|vbaProject|encrypted/i.test(type)) fail();
    if (officeXml.localName(entry.name) === "Override") {
      const path = resolveOfficePart("", entry.attributes.PartName ?? "");
      if (contentTypes.has(path)) fail();
      contentTypes.set(path, type);
    }
  }
  const roots = await readOfficeRelationships(archive, ""), rootLinks = [...roots.values()].filter(link => relationshipTypes.some(type => link.type === `${type}officeDocument`));
  if (rootLinks.length !== 1 || rootLinks[0].external || contentTypes.get(rootLinks[0].target) !== mainType) fail();
  const presentationPart = rootLinks[0].target;
  const presentation = officeXml.parseXml(await archive.read(presentationPart));
  if (officeXml.localName(presentation.name) !== "presentation" || !presentationNode(presentation, {})) fail();
  const lists = officeXml.children(presentation, "sldIdLst");
  if (lists.length > 1 || lists[0] && !presentationNode(lists[0], presentation.attributes)) fail();
  const slides = officeXml.children(lists[0], "sldId"), links = await readOfficeRelationships(archive, presentationPart);
  const seenIds = new Set<string>(), seenTargets = new Set<string>();
  for (const slide of slides) {
    signal.throwIfAborted();
    const inherited = { ...presentation.attributes, ...lists[0].attributes };
    if (!presentationNode(slide, inherited)) fail();
    const attributes = { ...inherited, ...slide.attributes };
    const id = slide.attributes.id, relationId = Object.entries(slide.attributes).find(([key]) => key.endsWith(":id") &&
      relationshipTypes.some(type => namespace(key, attributes) === type.slice(0, -1)))?.[1];
    const link = links.get(relationId ?? "");
    const canonicalId = String(Number(id));
    if (!id || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || seenIds.has(canonicalId) || !link || link.external ||
      !relationshipTypes.some(type => link.type === `${type}slide`) || seenTargets.has(link.target) || contentTypes.get(link.target) !== slideType) fail();
    seenIds.add(canonicalId); seenTargets.add(link!.target);
  }
  signal.throwIfAborted();
  // Hidden slides remain in this list. Slide bodies and embedded media are not read.
  return { kind: "presentation", slides: slides.length };
}
