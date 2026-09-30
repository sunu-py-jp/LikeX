import { createZipArchive, type ZipArchiveEntry } from "../core";
import { normalizeSlideDeck } from "../model";
import type { SlideDeck, SlideElement, SlideImageElement } from "../model/types";
import { R, header, namespaces, xml, emu, group, colorMap, relationships, fill, themeXml, type Link } from "./pptx-xml";
import { exportPptxAnimations } from "./pptx-animations";
import { OFFICE_PACKAGE_LIMITS } from "../ooxml";
import { createPptxDiagnosticCollector } from "../office/pptx-diagnostics";
import { SLIDE_LIMITS } from "../model/limits";
import { slideElementTextLength, slideTextLength } from "../model/text-length";
import { createOfficeTaskCheckpoint } from "../office/cooperative-task";
import { isSlideLine } from "../model/lines";
import { pptxConnectorXml, pptxConnectorTargetGeometry, pptxLineArrowheads } from "./pptx-connectors";
import { pptxMasterPlan, writePptxMasterCatalog, pptxPlaceholder, type PptxPlaceholder } from "./pptx-masters";

import { createSvgFallbacks } from "./svg-fallback";

import type { SlidePptxExportOptions } from "./types";
export type { SlidePptxExportOptions } from "./types";

export const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const contentPrefix = "application/vnd.openxmlformats-officedocument.presentationml.";
const part = (path: string, value: string): ZipArchiveEntry => ({ path, content: new Blob([value], { type: "application/xml" }) });
function textBody(element: Exclude<SlideElement, { type: "image" }>): string {
  const isText = element.type === "text", size = Math.round(element.fontSize * 75), color = isText ? element.color : element.textColor;
  const face = isText ? element.fontFamily.split(",")[0].trim().replace(/^['"]|['"]$/g, "") : "Arial", align = isText ? ({ left: "l", center: "ctr", right: "r" } as const)[element.align] : "ctr";
  const anchor = isText ? ({ top: "t", middle: "ctr", bottom: "b" } as const)[element.verticalAlign] : "ctr";
  const run = `<a:rPr lang="ja-JP" sz="${size}" b="${isText && element.bold ? 1 : 0}" i="${isText && element.italic ? 1 : 0}">${fill(color, element.opacity)}<a:latin typeface="${xml(face)}"/><a:ea typeface="${xml(face)}"/></a:rPr>`;
  return `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}"/><a:lstStyle/>${element.text.split("\n").map(line => `<a:p><a:pPr algn="${align}"/><a:r>${run}<a:t xml:space="preserve">${xml(line)}</a:t></a:r><a:endParaRPr lang="ja-JP" sz="${size}"/></a:p>`).join("")}</p:txBody>`;
}
function elementXml(element: SlideElement, id: number, shapeIds: ReadonlyMap<string, number>, connectorTargets: ReadonlySet<string>, imageId?: string, placeholder?: PptxPlaceholder, svgId?: string): string {
  const nvPr = placeholder ? `<p:nvPr><p:ph type="${xml(placeholder.kind)}" idx="${placeholder.index}"/></p:nvPr>` : "<p:nvPr/>";
  if (isSlideLine(element) && element.line) return pptxConnectorXml(element, id, shapeIds, nvPr);
  const transform = `<a:xfrm rot="${Math.round(element.rotation * 60000)}"><a:off x="${emu(element.x)}" y="${emu(element.y)}"/><a:ext cx="${emu(element.width)}" cy="${emu(element.height)}"/></a:xfrm>`;
  const lock = element.locked ? ' noMove="1" noResize="1" noRot="1"' : "";
  const common = `<p:cNvPr id="${id}" name="${xml(element.name)}"${element.type === "image" ? ` descr="${xml(element.alt)}"` : ""}/>`;
  const geometry = (connectorTargets.has(element.id) || placeholder && element.type === "shape") ? pptxConnectorTargetGeometry(element) : undefined;
  if (element.type === "image") return `<p:pic><p:nvPicPr>${common}<p:cNvPicPr><a:picLocks noChangeAspect="1"${lock}/></p:cNvPicPr>${nvPr}</p:nvPicPr><p:blipFill><a:blip r:embed="${imageId}">${element.opacity < 1 ? `<a:alphaModFix amt="${Math.round(element.opacity * 100000)}"/>` : ""}${svgId ? `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${svgId}"/></a:ext></a:extLst>` : ""}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${transform}${geometry ?? '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'}</p:spPr></p:pic>`;
  const preset = element.type === "shape" ? element.shape === "arrow" ? "rightArrow" : element.shape : "rect";
  const stroke = element.type === "shape" ? `<a:ln w="${emu(element.strokeWidth)}">${fill(element.stroke, element.opacity)}<a:prstDash val="solid"/>${element.shape === "line" ? pptxLineArrowheads(element) : ""}</a:ln>` : '<a:ln><a:noFill/></a:ln>';
  return `<p:sp><p:nvSpPr>${common}<p:cNvSpPr${element.type === "text" ? ' txBox="1"' : ""}><a:spLocks${lock}/></p:cNvSpPr>${nvPr}</p:nvSpPr><p:spPr>${transform}${geometry ?? `<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>`}${fill(element.fill, element.opacity)}${stroke}</p:spPr>${textBody(element)}</p:sp>`;
}

/** Writes standard PresentationML only; no downloads, persistence, or network requests. */
export async function exportSlidePptx(input: SlideDeck, options: SlidePptxExportOptions = {}): Promise<Blob> {
  options.signal?.throwIfAborted();
  const checkpoint = createOfficeTaskCheckpoint(options.signal);
  const deck = normalizeSlideDeck(input), parts: ZipArchiveEntry[] = [], types = new Map<string, string>();
  const diagnostics = createPptxDiagnosticCollector("export", options);
  const add = (path: string, type: string, value: string) => { parts.push(part(path, value)); types.set(`/${path}`, type); };
  const masterPlan = pptxMasterPlan(deck);
  const links: Link[] = [...(masterPlan.defaultMaster ? [{ id: "rIdMaster", type: `${R}/slideMaster`, target: "slideMasters/slideMaster1.xml" }] : []),
    ...masterPlan.masters.map(({ number }) => ({ id: `rIdMaster${number}`, type: `${R}/slideMaster`, target: `slideMasters/slideMaster${number}.xml` }))];
  const imageRegistry = new Map<string, { path: string; mime: string; svgPath?: string }>();
  let hasNotes = false, elementCount = 0;
  // Reserve all source text before sampling any page, including names, notes and
  // image alt on later pages. Only added snapshots consume the remaining budget.
  const catalogElements = [...(deck.masters ?? []).flatMap(master => master.elements), ...(deck.layouts ?? []).flatMap(layout => [...layout.elements, ...layout.placeholders.map(slot => slot.element)])];
  const svgFallbacks = await createSvgFallbacks([...catalogElements, ...deck.slides.flatMap(slide => slide.elements)].filter((element): element is SlideImageElement => element.type === "image"), options);
  // The exported fallback master/layout become reusable definitions on import.
  // Reserve their names, along with all source catalog metadata, before sampling.
  const catalogNameLength = [...(deck.masters ?? []), ...(deck.layouts ?? [])].reduce((total, definition) => total + definition.name.length, 0)
    + (masterPlan.defaultMaster ? "LikeSlide".length + "Blank".length : 0);
  let textLength = catalogNameLength + deck.slides.reduce((total, slide) => total + slideTextLength(slide), 0) + catalogElements.reduce((total, element) => total + slideElementTextLength(element), 0);
  const writeElement = (element: SlideElement, shapeId: number, shapeIds: ReadonlyMap<string, number>, connectorTargets: ReadonlySet<string>, links: Link[], placeholder?: PptxPlaceholder): string => {
    if (++elementCount > SLIDE_LIMITS.totalElements) throw new Error("PowerPointのテンプレート・アニメーション近似を含む図形数が上限を超えています");
    if (element.type !== "image") return elementXml(element, shapeId, shapeIds, connectorTargets, undefined, placeholder);
    let image = imageRegistry.get(element.src);
    if (!image) {
      const match = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(element.src);
      if (!match) throw new Error("PowerPointに出力する画像の形式が不正です");
      const mime = match[1], svg = mime === "image/svg+xml", extension = svg ? "svg" : mime === "image/jpeg" ? "jpg" : mime.slice(6);
      image = { path: `ppt/media/image${imageRegistry.size + 1}.${extension}`, mime }; imageRegistry.set(element.src, image);
      const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
      parts.push({ path: image.path, content: new Blob([bytes], { type: mime }) }); types.set(`/${image.path}`, mime);
      if (svg) {
        const svgPath = image.path, fallback = svgFallbacks.get(element.src)!;
        image.svgPath = svgPath; image.path = svgPath.replace(/\.svg$/, ".png"); image.mime = "image/png";
        parts.push({ path: image.path, content: new Blob([fallback as Uint8Array<ArrayBuffer>], { type: "image/png" }) }); types.set(`/${image.path}`, "image/png");
      }
    }
    const id = `rIdImage${shapeId}`; links.push({ id, type: `${R}/image`, target: `../media/${image.path.split("/").at(-1)}` });
    const svgId = image.svgPath ? `rIdSvg${shapeId}` : undefined;
    if (svgId) links.push({ id: svgId, type: `${R}/image`, target: `../media/${image.svgPath!.split("/").at(-1)}` });
    return elementXml(element, shapeId, shapeIds, connectorTargets, id, placeholder, svgId);
  };
  for (const { layout, number } of masterPlan.layouts) for (const slot of layout.placeholders)
    if (pptxPlaceholder(layout, slot.id)!.kind !== slot.kind) diagnostics.warn(`プレースホルダー種別 ${slot.kind} をPowerPointの汎用コンテンツへ変更しました`, {
      code: "content-approximated", action: "approximation", elementId: slot.element.id, elementName: slot.element.name, sourcePart: `ppt/slideLayouts/slideLayout${number}.xml`,
    });
  await writePptxMasterCatalog(masterPlan, { add, rels(path, value) { parts.push(part(path, value)); }, checkpoint,
    elements(elements, links, sourcePart, placeholders) {
      const ids = new Map(elements.map((element, index) => [element.id, index + 2]));
      const targets = new Set(elements.flatMap(element => isSlideLine(element) && element.line ? [element.line.start.binding?.targetId, element.line.end.binding?.targetId].filter((id): id is string => !!id) : []));
      return elements.map((element, index) => {
        if (isSlideLine(element) && element.line && element.text) diagnostics.warn("テンプレートの接続線内の文字を省略しました。文字は別のテキスト要素へ設定してください", { code: "unsupported-content", action: "omission", elementId: element.id, elementName: element.name, sourcePart });
        return writeElement(element, index + 2, ids, targets, links, placeholders?.get(element.id));
      }).join("");
    },
  });
  for (const [index, slide] of deck.slides.entries()) {
    const layout = deck.layouts?.find(item => item.id === slide.layoutId), layoutNumber = layout ? masterPlan.layoutNumbers.get(layout.id)! : 1;
    const number = index + 1, slideLinks: Link[] = [{ id: "rIdLayout", type: `${R}/slideLayout`, target: `../slideLayouts/slideLayout${layoutNumber}.xml` }];
    await checkpoint();
    const shapeIds = new Map(slide.elements.map((element, index) => [element.id, index + 2]));
    const connectorTargets = new Set(slide.elements.flatMap(element => isSlideLine(element) && element.line
      ? [element.line.start.binding?.targetId, element.line.end.binding?.targetId].filter((id): id is string => !!id) : []));
    for (const element of slide.elements) if (isSlideLine(element) && element.line && element.text)
      diagnostics.warn("接続線内の文字はPPTXの接続線に保存できないため省略しました。文字は別のテキスト要素として追加してください。", { code: "unsupported-content", action: "omission", slideIndex: index, elementId: element.id, elementName: element.name });
    const animations = await exportPptxAnimations(slide, deck.width, deck.height, shapeIds,
      (message, details) => diagnostics.warn(message, { slideIndex: index, slideId: slide.id, slideName: slide.name, sourcePart: `ppt/slides/slide${number}.xml`, ...details }),
      SLIDE_LIMITS.totalTextLength - textLength, checkpoint);
    for (const snapshots of animations.snapshots.values()) for (const snapshot of snapshots) textLength += slideElementTextLength(snapshot.element);
    if (textLength > SLIDE_LIMITS.totalTextLength) throw new Error("PowerPointのアニメーション近似を含むテキスト量が上限を超えています");
    const elements = slide.elements.flatMap((sourceElement, i) => [{ element: sourceElement, shapeId: i + 2 }, ...(animations.snapshots.get(sourceElement.id) ?? [])]
      .map(({ element: snapshot, shapeId }) => {
      const element = animations.opacityTargets.has(sourceElement.id) ? { ...snapshot, opacity: 1 } : snapshot;
      return writeElement(element, shapeId, shapeIds, connectorTargets, slideLinks, shapeId === i + 2 ? pptxPlaceholder(layout, sourceElement.layoutPlaceholderId) : undefined);
    })).join("");
    if (slide.notes) {
      hasNotes = true;
      slideLinks.push({ id: "rIdNotes", type: `${R}/notesSlide`, target: `../notesSlides/notesSlide${number}.xml` });
      const paragraphs = slide.notes.split("\n").map(line => `<a:p><a:r><a:t xml:space="preserve">${xml(line)}</a:t></a:r></a:p>`).join("");
      add(`ppt/notesSlides/notesSlide${number}.xml`, `${contentPrefix}notesSlide+xml`, `${header}<p:notes ${namespaces}><p:cSld><p:spTree>${group}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);
      parts.push(part(`ppt/notesSlides/_rels/notesSlide${number}.xml.rels`, relationships([
        { id: "rIdSlide", type: `${R}/slide`, target: `../slides/slide${number}.xml` },
        { id: "rIdMaster", type: `${R}/notesMaster`, target: "../notesMasters/notesMaster1.xml" },
      ])));
    }
    add(`ppt/slides/slide${number}.xml`, `${contentPrefix}slide+xml`, `${header}<p:sld ${namespaces}${slide.showMasterShapes === false ? ' showMasterSp="0"' : ""}><p:cSld name="${xml(slide.name)}">${layout && slide.inheritBackground ? "" : `<p:bg><p:bgPr>${fill(slide.background)}<a:effectLst/></p:bgPr></p:bg>`}<p:spTree>${group}${elements}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${animations.timing}</p:sld>`);
    parts.push(part(`ppt/slides/_rels/slide${number}.xml.rels`, relationships(slideLinks)));
    links.push({ id: `rIdSlide${number}`, type: `${R}/slide`, target: `slides/slide${number}.xml` });
    if (index % 8 === 7) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  if (hasNotes) {
    links.push({ id: "rIdNotesMaster", type: `${R}/notesMaster`, target: "notesMasters/notesMaster1.xml" });
    add("ppt/notesMasters/notesMaster1.xml", `${contentPrefix}notesMaster+xml`, `${header}<p:notesMaster ${namespaces}><p:cSld><p:spTree>${group}</p:spTree></p:cSld>${colorMap}<p:notesStyle/></p:notesMaster>`);
    parts.push(part("ppt/notesMasters/_rels/notesMaster1.xml.rels", relationships([{ id: "rIdTheme", type: `${R}/theme`, target: "../theme/theme1.xml" }])));
  }
  add("ppt/presentation.xml", `${contentPrefix}presentation.main+xml`, `${header}<p:presentation ${namespaces}><p:sldMasterIdLst>${masterPlan.defaultMaster ? '<p:sldMasterId id="2147483648" r:id="rIdMaster"/>' : ""}${masterPlan.masters.map(({ number }) => `<p:sldMasterId id="${2147483647 + number}" r:id="rIdMaster${number}"/>`).join("")}</p:sldMasterIdLst>${hasNotes ? '<p:notesMasterIdLst><p:notesMasterId r:id="rIdNotesMaster"/></p:notesMasterIdLst>' : ""}<p:sldIdLst>${deck.slides.map((_slide, index) => `<p:sldId id="${256 + index}" r:id="rIdSlide${index + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${emu(deck.width)}" cy="${emu(deck.height)}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`);
  parts.push(part("ppt/_rels/presentation.xml.rels", relationships(links)));
  if (masterPlan.defaultMaster) {
  add("ppt/slideMasters/slideMaster1.xml", `${contentPrefix}slideMaster+xml`, `${header}<p:sldMaster ${namespaces}><p:cSld name="LikeSlide"><p:spTree>${group}</p:spTree></p:cSld>${colorMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdLayout"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`);
  parts.push(part("ppt/slideMasters/_rels/slideMaster1.xml.rels", relationships([
    { id: "rIdLayout", type: `${R}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" }, { id: "rIdTheme", type: `${R}/theme`, target: "../theme/theme1.xml" },
  ])));
  add("ppt/slideLayouts/slideLayout1.xml", `${contentPrefix}slideLayout+xml`, `${header}<p:sldLayout ${namespaces} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  parts.push(part("ppt/slideLayouts/_rels/slideLayout1.xml.rels", relationships([{ id: "rIdMaster", type: `${R}/slideMaster`, target: "../slideMasters/slideMaster1.xml" }])));
  }
  add("ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml", themeXml());
  add("docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml", `${header}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(deck.title)}</dc:title><dc:creator>LikeSlide</dc:creator></cp:coreProperties>`);
  parts.push(part("_rels/.rels", relationships([
    { id: "rIdPresentation", type: `${R}/officeDocument`, target: "ppt/presentation.xml" },
    { id: "rIdProperties", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" },
  ])));
  parts.push(part("[Content_Types].xml", `${header}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...types].map(([path, type]) => `<Override PartName="${xml(path)}" ContentType="${type}"/>`).join("")}</Types>`));
  // This writer uses ZIP STORE, so the final size can be checked before reading
  // or allocating entry buffers. Never produce a file our bounded reader rejects.
  if (parts.length > OFFICE_PACKAGE_LIMITS.entries) throw new Error("PowerPointのパッケージ項目数が上限を超えています");
  let archiveBytes = 22;
  for (const entry of parts) if (!entry.directory && typeof entry.content !== "function") {
    if (entry.content.size > OFFICE_PACKAGE_LIMITS.entryBytes) throw new Error("PowerPointのパッケージ項目のサイズが上限を超えています");
    archiveBytes += entry.content.size + 76 + new TextEncoder().encode(entry.path).byteLength * 2;
    if (archiveBytes > OFFICE_PACKAGE_LIMITS.inputBytes) throw new Error("PowerPointの出力サイズが読み込み可能な上限を超えています");
  }
  options.signal?.throwIfAborted();
  return createZipArchive(parts, { type: PPTX_MIME_TYPE, signal: options.signal as AbortSignal | undefined });
}
