import { ByteReader, OFFICE_ART, OFFICE_ART_PROPERTY as P, OFFICE_PACKAGE_LIMITS, officeArtColor, officeArtPreset, officeArtRecords, officeArtString, readOfficeArtDrawing, readOfficeArtImages,
  type OfficeArtImage, type OfficeArtProperty, type OfficeArtRecord, type OfficeArtShape } from "../../core";
import { SLIDE_LIMITS } from "../../model/limits";
import { RT, fail, type PptFile, type PptSlideEntry } from "./ppt-file";
import { masterLevelStyle, readMasterStyle, readText, storedTextLength, type PptCharacterStyle, type PptMasterStyles, type PptText } from "./ppt-text";

/** Writes the PresentationML package that states the same content as the binary presentation. */
const A = "http://schemas.openxmlformats.org/drawingml/2006/main", PM = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", PACKAGE_RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships";
const TYPES = "application/vnd.openxmlformats-officedocument.presentationml", XML_HEADER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const NAMESPACES = `xmlns:a="${A}" xmlns:p="${PM}" xmlns:r="${R}"`;
/** Master units are 1/576 inch. */
const MASTER_UNIT_EMU = 914_400 / 576;
const IMAGE_TYPES: Readonly<Record<string, [type: string, extension: string]>> = { png: ["image/png", "png"], jpeg: ["image/jpeg", "jpeg"], dib: ["image/bmp", "bmp"],
  emf: ["image/x-emf", "emf"], wmf: ["image/x-wmf", "wmf"], pict: ["image/x-pict", "pict"], tiff: ["image/tiff", "tiff"] };
const PLACEHOLDERS: Readonly<Record<number, string>> = { 1: "title", 2: "body", 3: "ctrTitle", 4: "subTitle", 5: "sldImg", 6: "body", 7: "dt", 8: "sldNum", 9: "ftr", 10: "hdr", 11: "sldImg",
  12: "body", 13: "title", 14: "body", 15: "ctrTitle", 16: "subTitle", 17: "title", 18: "body", 19: "obj", 20: "chart", 21: "tbl", 22: "clipArt", 23: "dgm", 24: "media" };
const ALIGNMENTS = ["l", "ctr", "r", "just", "dist"], ANCHORS = ["t", "ctr", "b", "t", "ctr", "b", "t", "b", "t", "b"];
const ARROWHEADS = ["none", "triangle", "stealth", "diamond", "oval", "arrow"], DASHES = ["solid", "sysDash", "sysDot", "sysDashDot", "sysDashDotDot", "dot", "dash", "lgDash", "dashDot", "lgDashDot", "lgDashDotDot"];
const ANIMATION_RECORDS = new Set([0xf12b, 0xf12c, 0xf12d, 0xf12e, 0xf12f, 0xf130, 0xf131, 0xf132]);
const HEADER_MASTER = 0x0301, MAX_SHAPES = 20_000;
/** The largest text the slide model accepts: 1,000 px at 96 dpi. */
const MAX_FONT_POINTS = 750;
/** The widest line (100 px) and the smallest and largest slide (1 and 10,000 px) the slide model accepts. */
const MAX_LINE_EMU = 952_500, MIN_SLIDE_UNITS = 6, MAX_SLIDE_UNITS = 60_000;
/** Converted parts are held in memory, so their total is capped at the expanded size a package may have. */
const MAX_OUTPUT_BYTES = OFFICE_PACKAGE_LIMITS.totalBytes;
const encoder = new TextEncoder();
const text = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f￾￿]/g, "").replace(/[&<>]/g, character => character === "&" ? "&amp;" : character === "<" ? "&lt;" : "&gt;");
const attribute = (value: string) => text(value).replace(/["\t\n\r]/g, character => ({ '"': "&quot;", "\t": "&#9;", "\n": "&#10;", "\r": "&#13;" })[character]!);
const emu = (units: number) => Math.round(units * MASTER_UNIT_EMU);

type Scheme = readonly string[];
type Sheet = {
  record: OfficeArtRecord; entry: PptSlideEntry; flags: number; masterId: number; notesId: number;
  scheme: Scheme | undefined; styles: PptMasterStyles; root: OfficeArtShape | undefined; background: OfficeArtShape | undefined; rules: Map<number, [start: number, end: number, startSite: number, endSite: number]>;
};
export type PptPackage = { parts: [string, Uint8Array][]; warnings: string[] };

export function writePptPackage(file: PptFile, title: string | undefined): PptPackage {
  const { document } = file, view = new DataView(document.buffer, document.byteOffset, document.byteLength);
  const parts: [string, Uint8Array][] = [], overrides: string[] = [], extensions = new Map<string, string>(), warnings = new Set<string>();
  let outputBytes = 0, textCharacters = 0;
  const store = (path: string, content: Uint8Array) => {
    if ((outputBytes += content.byteLength) > MAX_OUTPUT_BYTES) fail("変換後のデータのサイズが上限を超えています");
    parts.push([path, content]);
  };
  const part = (path: string, xml: string) => { store(path, encoder.encode(xml)); };
  const relationships = (items: readonly string[]) => `${XML_HEADER}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">${items.join("")}</Relationships>`;
  const find = (record: OfficeArtRecord, type: number, instance?: number) => file.children(record).find(item => item.type === type && (instance === undefined || item.instance === instance));

  // Document-wide data: slide size, fonts, default text styles, pictures and drawing defaults.
  const size = find(file.documentRecord, RT.documentAtom);
  if (!size || size.end - size.start < 8) return fail("スライドのサイズが不正です");
  const width = view.getInt32(size.start, true), height = view.getInt32(size.start + 4, true);
  // Master units are 1/576 inch, six to a pixel; the deck holds slides of 1 to 10,000 px.
  if ([width, height].some(value => value < MIN_SLIDE_UNITS || value > MAX_SLIDE_UNITS)) return fail("スライドのサイズが不正です");
  const environment = find(file.documentRecord, RT.environment), fonts: string[] = [], documentStyles: PptMasterStyles = new Map();
  if (environment) {
    for (const font of file.children(find(environment, RT.fontCollection) ?? { ...environment, start: 0, end: 0 })) if (font.type === RT.fontEntity) {
      const name = new TextDecoder("utf-16le").decode(document.subarray(font.start, Math.min(font.end, font.start + 64))), end = name.indexOf("\u0000");
      // "@" marks the vertical variant of a face. A name the slide model cannot store is left out, so the
      // text takes the font of its master instead of the whole import being refused.
      const face = (end < 0 ? name : name.slice(0, end)).replace(/^@/, "").trim();
      if (/^[\p{L}\p{N} ,.'_-]{1,200}$/u.test(face)) fonts[font.instance] = face;
    }
    for (const style of file.children(environment)) if (style.type === RT.textMasterStyle) readMasterStyle(document, style, documentStyles);
  }
  const drawingGroup = find(file.documentRecord, RT.drawingGroup), groupRecord = drawingGroup && find(drawingGroup, OFFICE_ART.drawingGroup);
  const images: (OfficeArtImage | undefined)[] = groupRecord ? readOfficeArtImages(document, groupRecord, file.pictures) : [], defaults = new Map<number, OfficeArtProperty>();
  if (groupRecord) for (const record of file.children(groupRecord)) if (record.type === OFFICE_ART.properties) for (const [key, value] of readProperties(document, record)) defaults.set(key, value);

  function readSheet(entry: PptSlideEntry): Sheet | undefined {
    const record = file.persist(entry.persist);
    if (!record || record.type !== RT.slide && record.type !== RT.mainMaster && record.type !== RT.notes) return undefined;
    const atom = find(record, RT.slideAtom), colors = find(record, RT.colorScheme, 1), styles: PptMasterStyles = new Map(), drawing = find(record, RT.drawing);
    const container = drawing && find(drawing, OFFICE_ART.drawing), read = container ? readOfficeArtDrawing(document, container) : {};
    for (const style of file.children(record)) if (style.type === RT.textMasterStyle) readMasterStyle(document, style, styles);
    const rules = new Map<number, [number, number, number, number]>();
    for (const solver of container ? file.children(container).filter(item => item.type === 0xf005) : []) for (const rule of file.children(solver)) if (rule.type === RT.connectorRule && rule.end - rule.start >= 24)
      rules.set(view.getUint32(rule.start + 12, true), [view.getUint32(rule.start + 4, true), view.getUint32(rule.start + 8, true), view.getUint32(rule.start + 16, true), view.getUint32(rule.start + 20, true)]);
    const valid = atom && atom.end - atom.start >= 22;
    return { record, entry, flags: valid ? view.getUint16(atom.start + 20, true) : 0, masterId: valid ? view.getUint32(atom.start + 12, true) : 0, notesId: valid ? view.getUint32(atom.start + 16, true) : 0,
      scheme: colors && colors.end - colors.start >= 32 ? Array.from({ length: 8 }, (_, index) => [0, 1, 2].map(channel => document[colors.start + index * 4 + channel].toString(16).padStart(2, "0")).join("").toUpperCase()) : undefined,
      styles, root: read.root, background: read.background, rules };
  }

  type Writer = { relations: string[]; sheet: Sheet; master: Sheet | undefined; scheme: Scheme; styles: PptMasterStyles; masterShapes: Map<number, OfficeArtShape>; shapeCount: number; placeholderIndex: number; usedTitle: boolean; usedBody: boolean };
  const imagePaths = new Map<number, string>();
  let imageCount = 0, shapeTotal = 0;
  const property = (shape: OfficeArtShape, id: number, writer: Writer): OfficeArtProperty | undefined => {
    const inherited = shape.properties.get(HEADER_MASTER)?.value;
    return shape.properties.get(id) ?? (inherited === undefined ? undefined : writer.masterShapes.get(inherited)?.properties.get(id)) ?? defaults.get(id);
  };
  /** A boolean applies only where its "use" bit is set, along the same chain as other properties. */
  const flag = (shape: OfficeArtShape, id: number, bit: number, fallback: boolean, writer: Writer): boolean => {
    const inherited = shape.properties.get(HEADER_MASTER)?.value;
    for (const source of [shape.properties, inherited === undefined ? undefined : writer.masterShapes.get(inherited)?.properties, defaults]) {
      const value = source?.get(id)?.value;
      if (value !== undefined && value & bit << 16) return !!(value & bit);
    }
    return fallback;
  };
  const drawingColor = (value: number | undefined, scheme: Scheme): string | undefined => {
    if (value === undefined) return undefined;
    const color = officeArtColor(value);
    return color.rgb ?? (color.scheme !== undefined ? scheme[color.scheme] : undefined);
  };
  /** Text colours are RGB when the index byte is 0xFE, else an index into the colour scheme. */
  const textColor = (value: number | undefined, scheme: Scheme): string | undefined => {
    if (value === undefined) return undefined;
    const index = value >>> 24;
    return index === 0xfe ? [value & 0xff, value >>> 8 & 0xff, value >>> 16 & 0xff].map(channel => channel.toString(16).padStart(2, "0")).join("").toUpperCase() : scheme[index];
  };
  const solid = (color: string | undefined, opacity = 1) => color ? `<a:solidFill><a:srgbClr val="${color}">${opacity < 1 ? `<a:alpha val="${Math.round(opacity * 100_000)}"/>` : ""}</a:srgbClr></a:solidFill>` : "";
  function runProperties(style: PptCharacterStyle, scheme: Scheme, name = "a:rPr"): string {
    const font = style.font === undefined ? undefined : fonts[style.font];
    // Bold and italic are always stated: the style is fully resolved here, and the reader lets an unstated run inherit.
    return `<${name}${style.size ? ` sz="${Math.min(MAX_FONT_POINTS, style.size) * 100}"` : ""} b="${style.bold ? 1 : 0}" i="${style.italic ? 1 : 0}"` +
      `${style.underline ? ' u="sng"' : ""}>${solid(textColor(style.color, scheme))}${font ? `<a:latin typeface="${attribute(font)}"/><a:ea typeface="${attribute(font)}"/>` : ""}</${name}>`;
  }
  function textBody(shape: OfficeArtShape, writer: Writer, placeholderType: number | undefined): { xml: string; plain: string } {
    const anchor = ANCHORS[property(shape, P.textAnchor, writer)?.value ?? 0] ?? "t";
    let body: PptText | undefined;
    if (shape.clientTextbox) {
      const records = file.children(shape.clientTextbox), reference = records.find(record => record.type === RT.outlineTextReference);
      // Placeholder text is stored with the slide list; the shape only names which text it shows.
      const source = reference && reference.end - reference.start >= 4 ? writer.sheet.entry.texts[view.getInt32(reference.start, true)] : records;
      // The PPTX reader refuses a longer text; refuse it here, before it is split into paragraphs and runs.
      if (source && storedTextLength(source) > SLIDE_LIMITS.textLength) throw new Error("PowerPointのテキスト量が読み込み上限を超えています");
      body = source && readText(document, source, writer.styles);
    }
    const fallbackType = placeholderType === undefined ? 4 : [1, 13, 17].includes(placeholderType) ? 0 : [3, 15].includes(placeholderType) ? 6 : [4, 16].includes(placeholderType) ? 5 : [6, 12].includes(placeholderType) ? 2 : 1;
    if (!body) {
      if (placeholderType === undefined) return { xml: "", plain: "" };
      const style = masterLevelStyle(writer.styles, fallbackType, 0);
      return { xml: `<p:txBody><a:bodyPr anchor="${anchor}"/><a:lstStyle/><a:p><a:pPr${ALIGNMENTS[style.paragraph.align ?? -1] ? ` algn="${ALIGNMENTS[style.paragraph.align!]}"` : ""}/>${runProperties(style.character, writer.scheme, "a:endParaRPr")}</a:p></p:txBody>`, plain: "" };
    }
    const paragraphs = body.paragraphs.map(paragraph => {
      const align = ALIGNMENTS[paragraph.style.align ?? -1], level = Math.min(8, paragraph.style.level);
      // Only a bullet the paragraph states itself is written; inherited ones stay with the master, as in PPTX.
      const head = `<a:pPr${align ? ` algn="${align}"` : ""}${level ? ` lvl="${level}"` : ""}>${paragraph.ownBullet && paragraph.style.bullet ? `<a:buChar char="&#8226;"/>` : ""}</a:pPr>`;
      const runs = paragraph.runs.map(run => {
        const properties = runProperties(run.style, writer.scheme);
        return run.text.split("\u000b").map(piece => piece ? `<a:r>${properties}<a:t>${text(piece)}</a:t></a:r>` : "").join("<a:br/>");
      }).join("");
      return `<a:p>${head}${runs}${runProperties(paragraph.runs.at(-1)!.style, writer.scheme, "a:endParaRPr")}</a:p>`;
    });
    // One stored text may be shown by many shapes, so the converted text is budgeted as it is produced.
    if ((textCharacters += paragraphs.reduce((total, paragraph) => total + paragraph.length, 0)) > MAX_OUTPUT_BYTES) fail("変換後のデータのサイズが上限を超えています");
    return { xml: `<p:txBody><a:bodyPr anchor="${anchor}"/><a:lstStyle/>${paragraphs.join("")}</p:txBody>`, plain: body.paragraphs.map(paragraph => paragraph.runs.map(run => run.text).join("")).join("\n") };
  }
  /** Position in master units; the anchor stores top, left, right, bottom as 16- or 32-bit values. */
  function bounds(shape: OfficeArtShape): { left: number; top: number; width: number; height: number } | undefined {
    const anchor = shape.clientAnchor;
    if (!anchor) return undefined;
    const reader = new ByteReader(document, anchor.start, anchor.end), wide = anchor.end - anchor.start >= 16;
    if (!wide && anchor.end - anchor.start < 8) return undefined;
    const top = wide ? reader.i32() : reader.i16(), left = wide ? reader.i32() : reader.i16(), right = wide ? reader.i32() : reader.i16(), bottom = wide ? reader.i32() : reader.i16();
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }
  function transform(shape: OfficeArtShape, writer: Writer): string | undefined {
    const box = bounds(shape);
    if (!box) return undefined;
    const rotation = ((property(shape, P.rotation, writer)?.value ?? 0) | 0) / 65_536, turns = ((rotation % 360) + 360) % 360;
    let { left, top, width: boxWidth, height: boxHeight } = box;
    // Near a quarter turn the stored box is that of the turned shape; swap it back around its centre.
    if (turns >= 45 && turns < 135 || turns >= 225 && turns < 315) { left += (boxWidth - boxHeight) / 2; top += (boxHeight - boxWidth) / 2; [boxWidth, boxHeight] = [boxHeight, boxWidth]; }
    return `<a:xfrm${turns ? ` rot="${Math.round(turns * 60_000)}"` : ""}${shape.flipHorizontal ? ' flipH="1"' : ""}${shape.flipVertical ? ' flipV="1"' : ""}><a:off x="${emu(left)}" y="${emu(top)}"/><a:ext cx="${emu(boxWidth)}" cy="${emu(boxHeight)}"/></a:xfrm>`;
  }
  function fillXml(shape: OfficeArtShape, writer: Writer, filledByDefault: boolean): string {
    if (!flag(shape, P.fillFlags, 0x10, filledByDefault, writer)) return "<a:noFill/>";
    const kind = property(shape, P.fillType, writer)?.value ?? 0;
    if (kind !== 0 && kind !== 9) return "<a:gradFill/>";
    const opacity = property(shape, P.fillOpacity, writer)?.value;
    return solid(drawingColor(property(shape, P.fillColor, writer)?.value ?? 0x00ffffff, writer.scheme), opacity === undefined ? 1 : Math.min(1, opacity / 65_536)) || "<a:noFill/>";
  }
  function lineXml(shape: OfficeArtShape, writer: Writer, lineByDefault: boolean): string {
    if (!flag(shape, P.lineFlags, 0x08, lineByDefault, writer)) return "<a:ln><a:noFill/></a:ln>";
    const dash = DASHES[property(shape, P.lineDash, writer)?.value ?? 0], start = ARROWHEADS[property(shape, P.lineStart, writer)?.value ?? 0], end = ARROWHEADS[property(shape, P.lineEnd, writer)?.value ?? 0];
    return `<a:ln w="${Math.min(MAX_LINE_EMU, Math.max(0, property(shape, P.lineWidth, writer)?.value ?? 9525))}">${solid(drawingColor(property(shape, P.lineColor, writer)?.value ?? 0, writer.scheme)) || "<a:noFill/>"}` +
      `${dash && dash !== "solid" ? `<a:prstDash val="${dash}"/>` : ""}${start && start !== "none" ? `<a:headEnd type="${start}"/>` : ""}${end && end !== "none" ? `<a:tailEnd type="${end}"/>` : ""}</a:ln>`;
  }
  function imageRelation(index: number, writer: Writer): string | undefined {
    const image = images[index - 1];
    if (!image) return undefined;
    let path = imagePaths.get(index);
    if (!path) {
      const [type, extension] = IMAGE_TYPES[image.format];
      path = `ppt/media/image${++imageCount}.${extension}`;
      store(path, image.data); extensions.set(extension, type); imagePaths.set(index, path);
    }
    const id = `rId${writer.relations.length + 1}`;
    writer.relations.push(`<Relationship Id="${id}" Type="${R}/image" Target="../${path.slice(4)}"/>`);
    return id;
  }
  function shapeXml(shape: OfficeArtShape, writer: Writer): string {
    if (shape.deleted || shape.patriarch) return "";
    if (++shapeTotal > MAX_SHAPES) return fail("スライドのオブジェクト数が読み込み上限を超えています");
    const id = ++writer.shapeCount + 1, data = shape.clientData ? file.children(shape.clientData) : [];
    const hidden = flag(shape, P.groupFlags, 0x02, false, writer), name = officeArtString(shape, P.name) ?? "", description = officeArtString(shape, P.description);
    const identity = `<p:cNvPr id="${shape.id || id}" name="${attribute(name || `Object ${id}`)}"${description ? ` descr="${attribute(description)}"` : ""}${hidden ? ' hidden="1"' : ""}/>`;
    if (data.some(record => record.type === RT.animationInfo)) warnings.add("アニメーションを省略しました");
    // Groups, and with them tables, are not imported: the reader omits and reports them as for PPTX.
    if (shape.group) return `<p:grpSp><p:nvGrpSpPr>${identity}<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:grpSp>`;
    const placeholderRecord = data.find(record => record.type === RT.placeholder), placeholderType = placeholderRecord && placeholderRecord.end - placeholderRecord.start >= 5 ? document[placeholderRecord.start + 4] : undefined;
    const geometry = transform(shape, writer);
    if (!geometry) return "";
    // Embedded objects and charts keep only a frame, which the reader reports as unsupported.
    if (data.some(record => record.type === 0x0bc1)) return `<p:graphicFrame><p:nvGraphicFramePr>${identity}<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr></p:graphicFrame>`;
    let placeholder = "";
    if (placeholderType !== undefined && PLACEHOLDERS[placeholderType]) {
      const kind = PLACEHOLDERS[placeholderType], titleLike = kind === "title" || kind === "ctrTitle", bodyLike = ["body", "subTitle", "obj"].includes(kind);
      // The first title and the first body pair with the layout's placeholders; further ones stand alone.
      const index = titleLike && !writer.usedTitle ? 0 : bodyLike && !writer.usedBody ? 1 : ++writer.placeholderIndex;
      if (titleLike) writer.usedTitle = true;
      if (bodyLike) writer.usedBody = true;
      placeholder = `<p:ph type="${kind}"${index ? ` idx="${index}"` : ""}/>`;
    }
    const picture = property(shape, P.picture, writer)?.value;
    if (picture) {
      const relation = imageRelation(picture, writer), crops = [P.cropLeft, P.cropTop, P.cropRight, P.cropBottom].map(id => (shape.properties.get(id)?.value ?? 0) | 0);
      const crop = crops.some(Boolean) ? `<a:srcRect l="${Math.round(crops[0] / 65_536 * 100_000)}" t="${Math.round(crops[1] / 65_536 * 100_000)}" r="${Math.round(crops[2] / 65_536 * 100_000)}" b="${Math.round(crops[3] / 65_536 * 100_000)}"/>` : "";
      return `<p:pic><p:nvPicPr>${identity}<p:cNvPicPr/><p:nvPr>${placeholder}</p:nvPr></p:nvPicPr><p:blipFill><a:blip${relation ? ` r:embed="${relation}"` : ""}/>${crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
        `<p:spPr>${geometry}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    }
    const preset = officeArtPreset(shape.shapeType), connector = shape.connector || shape.shapeType === 20 || shape.shapeType >= 32 && shape.shapeType <= 40;
    if (connector) {
      const rule = writer.sheet.rules.get(shape.id);
      const connection = rule ? `${rule[0] ? `<a:stCxn id="${rule[0]}" idx="${rule[2]}"/>` : ""}${rule[1] ? `<a:endCxn id="${rule[1]}" idx="${rule[3]}"/>` : ""}` : "";
      return `<p:cxnSp><p:nvCxnSpPr>${identity}<p:cNvCxnSpPr>${connection}</p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr>${geometry}<a:prstGeom prst="${preset ?? "line"}"><a:avLst/></a:prstGeom>${lineXml(shape, writer, true)}</p:spPr></p:cxnSp>`;
    }
    const textBox = shape.shapeType === 202, plain = placeholder || textBox, body = textBody(shape, writer, placeholder ? placeholderType : undefined);
    // A shape type without a preset outline is written as a custom shape, which the reader approximates and reports.
    const outline = preset ? `<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>` : `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst/></a:custGeom>`;
    return `<p:sp><p:nvSpPr>${identity}<p:cNvSpPr${textBox ? ' txBox="1"' : ""}/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr><p:spPr>${geometry}${outline}${fillXml(shape, writer, !plain)}${lineXml(shape, writer, !plain)}</p:spPr>${body.xml}</p:sp>`;
  }
  function backgroundXml(sheet: Sheet, writer: Writer): string {
    if (!sheet.background) return "";
    const fill = fillXml(sheet.background, writer, true);
    return fill === "<a:noFill/>" ? "" : `<p:bg><p:bgPr>${fill}<a:effectLst/></p:bgPr></p:bg>`;
  }
  const tree = (shapes: string) => `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree>`;
  const createWriter = (sheet: Sheet, master: Sheet | undefined): Writer => {
    const masterShapes = new Map<number, OfficeArtShape>();
    for (const shape of master?.root?.children ?? []) masterShapes.set(shape.id, shape);
    return { relations: [], sheet, master, scheme: (sheet.flags & 0x02 ? master?.scheme : sheet.scheme) ?? sheet.scheme ?? master?.scheme ?? ["FFFFFF", "000000", "808080", "000000", "BBE0E3", "333399", "009999", "99CC00"],
      // Text styles apply from the document defaults through the master to the sheet's own records.
      styles: new Map([...documentStyles, ...(master?.styles ?? []), ...sheet.styles]),
      masterShapes, shapeCount: 0, placeholderIndex: 9, usedTitle: false, usedBody: false };
  };
  const isPlaceholder = (shape: OfficeArtShape) => !!shape.clientData && file.children(shape.clientData).some(record => record.type === RT.placeholder);
  function hasAnimation(record: OfficeArtRecord, depth = 0): boolean {
    if (depth > 12) return false;
    return officeArtRecords(document, record.start, record.end).some(item => ANIMATION_RECORDS.has(item.type) || item.version === 15 && hasAnimation(item, depth + 1));
  }

  // Masters: a main master becomes a slide master with one layout; a title master becomes a further layout of its main master.
  const masters = file.masters.map(readSheet), mainMasters = masters.filter((sheet): sheet is Sheet => !!sheet && sheet.record.type === RT.mainMaster);
  if (!mainMasters.length) warnings.add("マスターのないプレゼンテーションをスライド内の書式のみで読み込みました");
  const layoutOf = new Map<number, string>(), masterIds: string[] = [], presentationRelations: string[] = [];
  let layoutCount = 0;
  mainMasters.forEach((master, index) => {
    const masterPath = `ppt/slideMasters/slideMaster${index + 1}.xml`, themePath = `ppt/theme/theme${index + 1}.xml`, scheme = master.scheme ?? createWriter(master, undefined).scheme;
    const layouts: { sheet: Sheet; path: string; own: boolean }[] = [{ sheet: master, path: `ppt/slideLayouts/slideLayout${++layoutCount}.xml`, own: false }];
    for (const sheet of masters) if (sheet && sheet.record.type === RT.slide && (sheet.masterId === master.entry.slideId || !mainMasters.some(item => item.entry.slideId === sheet.masterId) && index === 0))
      layouts.push({ sheet, path: `ppt/slideLayouts/slideLayout${++layoutCount}.xml`, own: true });
    const masterWriter = createWriter(master, undefined);
    const masterShapes = (master.root?.children ?? []).map(shape => shapeXml(shape, masterWriter)).join("");
    const masterRelations = [...layouts.map((layout, position) => `<Relationship Id="rIdL${position + 1}" Type="${R}/slideLayout" Target="../${layout.path.slice(4)}"/>`),
      `<Relationship Id="rIdT" Type="${R}/theme" Target="../${themePath.slice(4)}"/>`, ...masterWriter.relations];
    part(masterPath, `${XML_HEADER}<p:sldMaster ${NAMESPACES}><p:cSld>${backgroundXml(master, masterWriter)}${tree(masterShapes)}</p:cSld>` +
      `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
      `<p:sldLayoutIdLst>${layouts.map((_, position) => `<p:sldLayoutId id="${2_147_483_649 + layoutCount * 16 + position}" r:id="rIdL${position + 1}"/>`).join("")}</p:sldLayoutIdLst></p:sldMaster>`);
    part(`ppt/slideMasters/_rels/slideMaster${index + 1}.xml.rels`, relationships(masterRelations));
    overrides.push(`<Override PartName="/${masterPath}" ContentType="${TYPES}.slideMaster+xml"/>`, `<Override PartName="/${themePath}" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`);
    const titleFont = fonts[masterLevelStyle(master.styles, 0, 0).character.font ?? -1] ?? "Arial", bodyFont = fonts[masterLevelStyle(master.styles, 1, 0).character.font ?? -1] ?? "Arial";
    const colour = (name: string, value: string) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`;
    // The eight scheme colours are: background, text, shadow, title text, fill, accent, hyperlink, followed hyperlink.
    part(themePath, `${XML_HEADER}<a:theme xmlns:a="${A}" name="Office Theme"><a:themeElements><a:clrScheme name="Office">${colour("dk1", scheme[1])}${colour("lt1", scheme[0])}${colour("dk2", scheme[3])}${colour("lt2", scheme[2])}` +
      `${colour("accent1", scheme[4])}${colour("accent2", scheme[5])}${colour("accent3", scheme[2])}${colour("accent4", scheme[3])}${colour("accent5", scheme[4])}${colour("accent6", scheme[5])}${colour("hlink", scheme[6])}${colour("folHlink", scheme[7])}</a:clrScheme>` +
      `<a:fontScheme name="Office"><a:majorFont><a:latin typeface="${attribute(titleFont)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${attribute(bodyFont)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
      `<a:fmtScheme name="Office"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`);
    for (const layout of layouts) {
      const writer = createWriter(layout.sheet, layout.own ? master : undefined);
      // The default layout repeats the master's placeholders; a title master contributes all of its shapes.
      const shapes = (layout.sheet.root?.children ?? []).filter(shape => layout.own || isPlaceholder(shape)).map(shape => shapeXml(shape, writer)).join("");
      part(layout.path, `${XML_HEADER}<p:sldLayout ${NAMESPACES}${layout.own && !(layout.sheet.flags & 0x01) ? ' showMasterSp="0"' : ""}><p:cSld name="${layout.own ? "タイトル スライド" : "標準"}">` +
        `${layout.own && !(layout.sheet.flags & 0x04) ? backgroundXml(layout.sheet, writer) : ""}${tree(shapes)}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
      part(`${layout.path.replace("slideLayouts/", "slideLayouts/_rels/")}.rels`, relationships([`<Relationship Id="rIdM" Type="${R}/slideMaster" Target="../${masterPath.slice(4)}"/>`, ...writer.relations]));
      overrides.push(`<Override PartName="/${layout.path}" ContentType="${TYPES}.slideLayout+xml"/>`);
      layoutOf.set(layout.sheet.entry.slideId, layout.path);
    }
    presentationRelations.push(`<Relationship Id="rIdM${index + 1}" Type="${R}/slideMaster" Target="${masterPath.slice(4)}"/>`);
    masterIds.push(`<p:sldMasterId id="${2_147_483_648 + index}" r:id="rIdM${index + 1}"/>`);
  });

  if (!file.slides.length) return fail("スライド数は1〜500枚にしてください");
  const notesById = new Map(file.notes.map(entry => [entry.slideId, entry])), slideIds: string[] = [];
  file.slides.forEach((entry, index) => {
    const sheet = readSheet(entry);
    if (!sheet || sheet.record.type !== RT.slide) return fail("スライドの参照が不正または重複しています");
    const master = masters.find(item => item?.entry.slideId === sheet.masterId) ?? mainMasters[0], mainMaster = master?.record.type === RT.mainMaster ? master : mainMasters.find(item => item.entry.slideId === master?.masterId) ?? mainMasters[0];
    const writer = createWriter(sheet, master), layout = layoutOf.get(sheet.masterId) ?? (mainMaster && layoutOf.get(mainMaster.entry.slideId));
    if (layout) writer.relations.push(`<Relationship Id="rId1" Type="${R}/slideLayout" Target="../${layout.slice(4)}"/>`);
    const shapes = (sheet.root?.children ?? []).map(shape => shapeXml(shape, writer)).join("");
    // Slide show settings: the effect type at byte 9, then flags whose third bit hides the slide.
    const show = find(sheet.record, RT.slideShowInfo), showFlags = show && show.end - show.start >= 12 ? view.getUint16(show.start + 10, true) : 0;
    const transition = show && show.end - show.start >= 12 && document[show.start + 9] !== 0 ? "<p:transition/>" : "";
    for (const tags of file.children(sheet.record).filter(record => record.type === RT.programTags)) if (hasAnimation(tags)) warnings.add("アニメーションを省略しました");
    const notesEntry = notesById.get(sheet.notesId), notes = notesEntry && readSheet(notesEntry);
    if (notes) {
      const notesWriter = createWriter(notes, undefined);
      const body = (notes.root?.children ?? []).find(shape => { const record = shape.clientData && find(shape.clientData, RT.placeholder); return !!record && [6, 12].includes(document[record.start + 4]); });
      const content = body && textBody(body, notesWriter, 12);
      if (content?.plain) {
        const path = `ppt/notesSlides/notesSlide${index + 1}.xml`;
        part(path, `${XML_HEADER}<p:notes ${NAMESPACES}><p:cSld>${tree(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>${content.xml}</p:sp>`)}</p:cSld></p:notes>`);
        overrides.push(`<Override PartName="/${path}" ContentType="${TYPES}.notesSlide+xml"/>`);
        writer.relations.push(`<Relationship Id="rId${writer.relations.length + 1}" Type="${R}/notesSlide" Target="../${path.slice(4)}"/>`);
      }
    }
    const path = `ppt/slides/slide${index + 1}.xml`;
    part(path, `${XML_HEADER}<p:sld ${NAMESPACES}${showFlags & 0x04 ? ' show="0"' : ""}${layout && !(sheet.flags & 0x01) ? ' showMasterSp="0"' : ""}><p:cSld>${sheet.flags & 0x04 ? "" : backgroundXml(sheet, writer)}${tree(shapes)}</p:cSld>` +
      `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transition}</p:sld>`);
    part(`ppt/slides/_rels/slide${index + 1}.xml.rels`, relationships(writer.relations));
    overrides.push(`<Override PartName="/${path}" ContentType="${TYPES}.slide+xml"/>`);
    presentationRelations.push(`<Relationship Id="rIdS${index + 1}" Type="${R}/slide" Target="${path.slice(4)}"/>`);
    slideIds.push(`<p:sldId id="${256 + index}" r:id="rIdS${index + 1}"/>`);
  });
  part("ppt/presentation.xml", `${XML_HEADER}<p:presentation ${NAMESPACES}>${masterIds.length ? `<p:sldMasterIdLst>${masterIds.join("")}</p:sldMasterIdLst>` : ""}<p:sldIdLst>${slideIds.join("")}</p:sldIdLst>` +
    `<p:sldSz cx="${emu(width)}" cy="${emu(height)}"/><p:notesSz cx="${emu(height)}" cy="${emu(width)}"/></p:presentation>`);
  part("ppt/_rels/presentation.xml.rels", relationships(presentationRelations));
  part("docProps/core.xml", `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${text(title ?? "")}</dc:title></cp:coreProperties>`);
  part("_rels/.rels", relationships([`<Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/presentation.xml"/>`,
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`]));
  part("[Content_Types].xml", `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>${[...extensions].map(([extension, type]) => `<Default Extension="${extension}" ContentType="${type}"/>`).join("")}` +
    `<Override PartName="/ppt/presentation.xml" ContentType="${TYPES}.presentation.main+xml"/>${overrides.join("")}</Types>`);
  return { parts, warnings: [...warnings] };
}

/** Property table of a drawing-group record, for the defaults that shapes fall back to. */
function readProperties(bytes: Uint8Array, record: OfficeArtRecord): Map<number, OfficeArtProperty> {
  const result = new Map<number, OfficeArtProperty>();
  try {
    const reader = new ByteReader(bytes, record.start, record.end);
    for (let index = 0; index < record.instance; index++) { const id = reader.u16(), value = reader.u32(); if (!(id & 0x8000)) result.set(id & 0x3fff, { value }); }
  } catch { /* A truncated table keeps the defaults read so far. */ }
  return result;
}
