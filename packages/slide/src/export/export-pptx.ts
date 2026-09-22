import { createZipArchive, type ZipArchiveEntry } from "../core";
import { normalizeSlideDeck, resolveSlideAnimations } from "../model";
import type { SlideDeck, SlideElement } from "../model/types";
import { R, header, namespaces, xml, emu, group, colorMap, relationships, fill, themeXml, type Link } from "./pptx-xml";

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
function elementXml(element: SlideElement, id: number, imageId?: string): string {
  const transform = `<a:xfrm rot="${Math.round(element.rotation * 60000)}"><a:off x="${emu(element.x)}" y="${emu(element.y)}"/><a:ext cx="${emu(element.width)}" cy="${emu(element.height)}"/></a:xfrm>`;
  const lock = element.locked ? ' noMove="1" noResize="1" noRot="1"' : "";
  const common = `<p:cNvPr id="${id}" name="${xml(element.name)}"${element.type === "image" ? ` descr="${xml(element.alt)}"` : ""}/>`;
  if (element.type === "image") return `<p:pic><p:nvPicPr>${common}<p:cNvPicPr><a:picLocks noChangeAspect="1"${lock}/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${imageId}">${element.opacity < 1 ? `<a:alphaModFix amt="${Math.round(element.opacity * 100000)}"/>` : ""}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${transform}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  const preset = element.type === "shape" ? element.shape === "arrow" ? "rightArrow" : element.shape : "rect";
  const stroke = element.type === "shape" ? `<a:ln w="${emu(element.strokeWidth)}">${fill(element.stroke, element.opacity)}<a:prstDash val="solid"/></a:ln>` : '<a:ln><a:noFill/></a:ln>';
  return `<p:sp><p:nvSpPr>${common}<p:cNvSpPr${element.type === "text" ? ' txBox="1"' : ""}><a:spLocks${lock}/></p:cNvSpPr><p:nvPr/></p:nvSpPr><p:spPr>${transform}<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>${fill(element.fill, element.opacity)}${stroke}</p:spPr>${textBody(element)}</p:sp>`;
}

/** Writes standard PresentationML only; no downloads, persistence, or network requests. */
export async function exportSlidePptx(input: SlideDeck, options: SlidePptxExportOptions = {}): Promise<Blob> {
  const source = normalizeSlideDeck(input);
  if (source.slides.some(slide => slide.animations?.length))
    options.onWarning?.("アニメーションは最終静止状態に変換され、タイミング・トリガー・繰り返しはPowerPointに保持されません。");
  const deck = { ...source, slides: source.slides.map(slide => resolveSlideAnimations(slide)) }, parts: ZipArchiveEntry[] = [], types = new Map<string, string>();
  const add = (path: string, type: string, value: string) => { parts.push(part(path, value)); types.set(`/${path}`, type); };
  const links: Link[] = [{ id: "rIdMaster", type: `${R}/slideMaster`, target: "slideMasters/slideMaster1.xml" }];
  const imageRegistry = new Map<string, { path: string; mime: string }>();
  let hasNotes = false;
  for (const [index, slide] of deck.slides.entries()) {
    const number = index + 1, slideLinks: Link[] = [{ id: "rIdLayout", type: `${R}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" }];
    const elements = slide.elements.map((element, i) => {
      if (element.type !== "image") return elementXml(element, i + 2);
      let image = imageRegistry.get(element.src);
      if (!image) {
        const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(element.src);
        if (!match) throw new Error("PowerPointに出力する画像の形式が不正です");
        const mime = match[1], extension = mime === "image/jpeg" ? "jpg" : mime.slice(6);
        image = { path: `ppt/media/image${imageRegistry.size + 1}.${extension}`, mime }; imageRegistry.set(element.src, image);
        const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0));
        parts.push({ path: image.path, content: new Blob([bytes], { type: mime }) }); types.set(`/${image.path}`, mime);
      }
      const id = `rIdImage${i}`; slideLinks.push({ id, type: `${R}/image`, target: `../media/${image.path.split("/").at(-1)}` });
      return elementXml(element, i + 2, id);
    }).join("");
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
    add(`ppt/slides/slide${number}.xml`, `${contentPrefix}slide+xml`, `${header}<p:sld ${namespaces}><p:cSld name="${xml(slide.name)}"><p:bg><p:bgPr>${fill(slide.background)}<a:effectLst/></p:bgPr></p:bg><p:spTree>${group}${elements}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    parts.push(part(`ppt/slides/_rels/slide${number}.xml.rels`, relationships(slideLinks)));
    links.push({ id: `rIdSlide${number}`, type: `${R}/slide`, target: `slides/slide${number}.xml` });
    if (index % 8 === 7) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  if (hasNotes) {
    links.push({ id: "rIdNotesMaster", type: `${R}/notesMaster`, target: "notesMasters/notesMaster1.xml" });
    add("ppt/notesMasters/notesMaster1.xml", `${contentPrefix}notesMaster+xml`, `${header}<p:notesMaster ${namespaces}><p:cSld><p:spTree>${group}</p:spTree></p:cSld>${colorMap}<p:notesStyle/></p:notesMaster>`);
    parts.push(part("ppt/notesMasters/_rels/notesMaster1.xml.rels", relationships([{ id: "rIdTheme", type: `${R}/theme`, target: "../theme/theme1.xml" }])));
  }
  add("ppt/presentation.xml", `${contentPrefix}presentation.main+xml`, `${header}<p:presentation ${namespaces}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdMaster"/></p:sldMasterIdLst>${hasNotes ? '<p:notesMasterIdLst><p:notesMasterId r:id="rIdNotesMaster"/></p:notesMasterIdLst>' : ""}<p:sldIdLst>${deck.slides.map((_slide, index) => `<p:sldId id="${256 + index}" r:id="rIdSlide${index + 1}"/>`).join("")}</p:sldIdLst><p:sldSz cx="${emu(deck.width)}" cy="${emu(deck.height)}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/></p:presentation>`);
  parts.push(part("ppt/_rels/presentation.xml.rels", relationships(links)));
  add("ppt/slideMasters/slideMaster1.xml", `${contentPrefix}slideMaster+xml`, `${header}<p:sldMaster ${namespaces}><p:cSld name="LikeSlide"><p:spTree>${group}</p:spTree></p:cSld>${colorMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rIdLayout"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`);
  parts.push(part("ppt/slideMasters/_rels/slideMaster1.xml.rels", relationships([
    { id: "rIdLayout", type: `${R}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" }, { id: "rIdTheme", type: `${R}/theme`, target: "../theme/theme1.xml" },
  ])));
  add("ppt/slideLayouts/slideLayout1.xml", `${contentPrefix}slideLayout+xml`, `${header}<p:sldLayout ${namespaces} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  parts.push(part("ppt/slideLayouts/_rels/slideLayout1.xml.rels", relationships([{ id: "rIdMaster", type: `${R}/slideMaster`, target: "../slideMasters/slideMaster1.xml" }])));
  add("ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml", themeXml());
  add("docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml", `${header}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(deck.title)}</dc:title><dc:creator>LikeSlide</dc:creator></cp:coreProperties>`);
  parts.push(part("_rels/.rels", relationships([
    { id: "rIdPresentation", type: `${R}/officeDocument`, target: "ppt/presentation.xml" },
    { id: "rIdProperties", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" },
  ])));
  parts.push(part("[Content_Types].xml", `${header}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...types].map(([path, type]) => `<Override PartName="${xml(path)}" ContentType="${type}"/>`).join("")}</Types>`));
  return createZipArchive(parts, { type: PPTX_MIME_TYPE });
}
