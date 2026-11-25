import type { DocBlock, DocContent, DocParagraph, DocTable, DocTextRun } from "./doc-content";
import { OFFICE_PACKAGE_LIMITS } from "../../core";
import { fail } from "./doc-file";
import type { DocFloating, DocImageData } from "./doc-drawings";
import { HIGHLIGHT_NAMES, type CharacterProperties, type DocList, type SectionProperties, type TableCell } from "./doc-properties";

/** Writes the WordprocessingML package that states the same content as the binary document. */
export type DocImage = DocImageData & { width: number; height: number };
/** `bitmaps` are the indexes of the parts whose data is still a bitmap to be rewritten as PNG. */
export type DocPackage = { parts: [string, Uint8Array][]; bitmaps: number[] };
export type DocPackageInput = {
  content: DocContent; fonts: readonly string[]; lists: readonly (DocList | undefined)[]; title: string | undefined;
  /** Resolves an inline picture by its offset in the Data stream. */
  picture(offset: number): DocImage | undefined;
  /** Resolves the object of the drawing layer that is anchored at a character position. */
  floating(cp: number): DocFloating | undefined;
};
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main", R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PICTURE = "http://schemas.openxmlformats.org/drawingml/2006/picture", SHAPE = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
const PACKAGE_RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_HEADER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const ALIGNMENTS = ["left", "center", "right", "both", "distribute"], SECTION_STARTS = ["continuous", "nextColumn", "nextPage", "evenPage", "oddPage"];
const NUMBER_FORMATS: Readonly<Record<number, string>> = { 0: "decimal", 1: "upperRoman", 2: "lowerRoman", 3: "upperLetter", 4: "lowerLetter", 5: "ordinal", 22: "decimalZero", 23: "bullet", 255: "none" };
const encoder = new TextEncoder();
const text = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f￾￿]/g, "").replace(/[&<>]/g, character => character === "&" ? "&amp;" : character === "<" ? "&lt;" : "&gt;");
const attribute = (value: string) => text(value).replace(/["\t\n\r]/g, character => ({ '"': "&quot;", "\t": "&#9;", "\n": "&#10;", "\r": "&#13;" })[character]!);

function runProperties(properties: CharacterProperties, fonts: readonly string[]): string {
  const font = properties.font === undefined ? undefined : fonts[properties.font], eastAsian = properties.eastAsianFont === undefined ? undefined : fonts[properties.eastAsianFont];
  const highlight = properties.highlight === undefined ? undefined : HIGHLIGHT_NAMES[properties.highlight];
  const items = [font || eastAsian ? `<w:rFonts${font ? ` w:ascii="${attribute(font)}" w:hAnsi="${attribute(font)}"` : ""}${eastAsian ? ` w:eastAsia="${attribute(eastAsian)}"` : ""}/>` : "",
    properties.bold ? "<w:b/>" : "", properties.italic ? "<w:i/>" : "", properties.strike ? "<w:strike/>" : "", properties.vanish ? "<w:vanish/>" : "",
    properties.color ? `<w:color w:val="${properties.color}"/>` : "", `<w:sz w:val="${properties.size}"/>`, highlight ? `<w:highlight w:val="${highlight}"/>` : "",
    properties.underline ? `<w:u w:val="single"/>` : "", properties.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${properties.shade}"/>` : "",
    properties.position === 1 || properties.position === 2 ? `<w:vertAlign w:val="${properties.position === 1 ? "superscript" : "subscript"}"/>` : ""];
  return `<w:rPr>${items.join("")}</w:rPr>`;
}
function sectionXml(section: SectionProperties, headers: boolean): string {
  return `<w:sectPr>${headers ? `<w:headerReference w:type="default" r:id="rIdHeader"/>` : ""}<w:type w:val="${SECTION_STARTS[section.start] ?? "nextPage"}"/>` +
    `<w:pgSz w:w="${section.width}" w:h="${section.height}"${section.width > section.height ? ' w:orient="landscape"' : ""}/>` +
    `<w:pgMar w:top="${section.top}" w:right="${section.right}" w:bottom="${section.bottom}" w:left="${section.left}"/>${section.columns > 1 ? `<w:cols w:num="${section.columns}"/>` : ""}</w:sectPr>`;
}
/** A hyperlink field names its target after optional switches; \l selects a bookmark in this document. */
function hyperlinkTarget(instruction: string): { url?: string; anchor?: string } | undefined {
  const match = /^\s*HYPERLINK\b(.*)$/is.exec(instruction);
  if (!match) return undefined;
  const local = /\\l\s+"([^"]*)"/i.exec(match[1])?.[1], rest = match[1].replace(/\\[lotmn]\s+"[^"]*"/gi, " ").replace(/\\[a-z]\b/gi, " ");
  const url = /"([^"]*)"/.exec(rest)?.[1] ?? rest.trim().split(/\s+/)[0];
  return url ? { url: local ? `${url}#${local}` : url } : local ? { anchor: local } : undefined;
}

export function writeDocPackage(input: DocPackageInput): DocPackage {
  const { content, fonts, lists } = input, parts: [string, Uint8Array][] = [], bitmaps: number[] = [], relationships: string[] = [], extensions = new Map<string, string>();
  const formatted = new Map<CharacterProperties, string>(), pictures = new Map<string, string>();
  let relation = 0, drawing = 0, emitted = 0;
  /** The body is one part of the package; past the size a part may have, nothing more is built. */
  const bounded = (xml: string) => { if ((emitted += xml.length) > OFFICE_PACKAGE_LIMITS.entryBytes) fail("変換後のデータのサイズが上限を超えています"); return xml; };
  const format = (properties: CharacterProperties) => { let xml = formatted.get(properties); if (xml === undefined) formatted.set(properties, xml = runProperties(properties, fonts)); return xml; };
  /** Fields may start in one paragraph and end in another, so their state outlives a paragraph. */
  const fields: { instruction: string; result: boolean; link?: string; inner?: boolean }[] = [];

  /** Stores a picture once per key and returns its relationship; anchors of one picture share the part. */
  function imageRelation(key: string, image: DocImageData): string {
    let relationId = pictures.get(key);
    if (!relationId) {
      relationId = `rId${++relation}`;
      const path = `media/image${relation}.${image.extension}`;
      if (image.bitmap) bitmaps.push(parts.length);
      parts.push([`word/${path}`, image.data]);
      extensions.set(image.extension, image.type);
      relationships.push(`<Relationship Id="${relationId}" Type="${R}/image" Target="${path}"/>`);
      pictures.set(key, relationId);
    }
    return relationId;
  }
  /** `adjusted` states a crop, so that the reader reports the crop, rotation or flip it does not apply. */
  const pictureGraphic = (relationId: string, id: number, width: number, height: number, adjusted = false) => `<a:graphic><a:graphicData uri="${PICTURE}">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationId}"/>${adjusted ? `<a:srcRect t="1"/>` : ""}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
  function pictureXml(offset: number): string {
    const image = input.picture(offset);
    if (!image) return "<w:pict/>";
    const relationId = imageRelation(`inline ${offset}`, image), id = ++drawing;
    return `<w:drawing><wp:inline><wp:extent cx="${image.width}" cy="${image.height}"/><wp:docPr id="${id}" name="Picture ${id}"/>${pictureGraphic(relationId, id, image.width, image.height)}</wp:inline></w:drawing>`;
  }
  /**
   * An object of the drawing layer becomes an anchored drawing, which the reader places in the text as it
   * does for DOCX: pictures as pictures, text boxes and outline shapes as shapes. What has no counterpart
   * is written so that the reader names it when it leaves it out.
   */
  function floatingXml(cp: number): string {
    const object = input.floating(cp);
    if (!object) return "<w:pict/>";
    const id = ++drawing, { width, height } = object;
    let graphic: string;
    if (object.kind === "picture") graphic = pictureGraphic(imageRelation(`store ${object.store}`, object.image), id, width, height, object.adjusted);
    else {
      const geometry = object.kind === "group" ? "<a:grpSp/>" : object.preset ? `<a:prstGeom prst="${attribute(object.preset)}"><a:avLst/></a:prstGeom>` : "<a:custGeom/>";
      const shape = object.kind === "shape" ? object : undefined, lines = shape?.text ? shape.text.split("\n") : [];
      const paint = (colour: string | undefined) => colour ? `<a:solidFill><a:srgbClr val="${colour}"/></a:solidFill>` : "<a:noFill/>";
      // The text of a text box starts at its top left; the reader centres it and says so.
      graphic = `<a:graphic><a:graphicData uri="${SHAPE}"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm rot="${Math.round((shape?.rotation ?? 0) * 60_000)}" flipH="${shape?.flipHorizontal ? 1 : 0}" flipV="${shape?.flipVertical ? 1 : 0}">` +
        `<a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>${geometry}${paint(shape?.fill)}<a:ln w="${shape?.lineWidth ?? 9525}">${paint(shape?.line)}</a:ln></wps:spPr>` +
        `<wps:txbx><w:txbxContent>${lines.map(line => `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t xml:space="preserve">${text(line)}</w:t></w:r></w:p>`).join("") || "<w:p/>"}</w:txbxContent></wps:txbx>` +
        `<wps:bodyPr${lines.length ? ' anchor="t"' : ""}/></wps:wsp></a:graphicData></a:graphic>`;
    }
    // The anchor keeps where the object stood and how text passed it; the reader decides whether it can show it there.
    const { place } = object, axis = (side: string | undefined, offset: number) => side ? `<wp:align>${side}</wp:align>` : `<wp:posOffset>${offset}</wp:posOffset>`;
    const wrap = place.wrap === "none" ? "<wp:wrapNone/>" : place.wrap === "topAndBottom" ? "<wp:wrapTopAndBottom/>" : `<wp:wrap${place.wrap === "square" ? "Square" : place.wrap === "tight" ? "Tight" : "Through"} wrapText="bothSides"/>`;
    return `<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="${place.behind ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>` +
      `<wp:positionH relativeFrom="${place.horizontal}">${axis(place.alignHorizontal, place.left)}</wp:positionH><wp:positionV relativeFrom="${place.vertical}">${axis(place.alignVertical, place.top)}</wp:positionV><wp:extent cx="${width}" cy="${height}"/>` +
      `${wrap}<wp:docPr id="${id}" name="${attribute(object.name || `Object ${id}`)}"${object.description ? ` descr="${attribute(object.description)}"` : ""}/>${graphic}</wp:anchor></w:drawing>`;
  }
  function linkOpen(target: { url?: string; anchor?: string }): string {
    if (target.anchor !== undefined) return `<w:hyperlink w:anchor="${attribute(target.anchor)}">`;
    relationships.push(`<Relationship Id="rId${++relation}" Type="${R}/hyperlink" Target="${attribute(target.url!)}" TargetMode="External"/>`);
    return `<w:hyperlink r:id="rId${relation}">`;
  }
  function runsXml(runs: readonly DocTextRun[]): string {
    const output: string[] = [];
    // A link that spans paragraphs is closed at each paragraph end and reopened in the next.
    const open = fields.find(field => field.link && field.result)?.link;
    if (open) output.push(open);
    for (const { text: source, properties, cp } of runs) {
      const style = format(properties), wrap = properties.deleted ? ["<w:del>", "</w:del>"] : properties.inserted ? ["<w:ins>", "</w:ins>"] : ["", ""];
      const literal = properties.deleted ? "w:delText" : "w:t";
      let buffer = "";
      const flush = () => { if (buffer) { output.push(bounded(`${wrap[0]}<w:r>${style}<${literal} xml:space="preserve">${text(buffer)}</${literal}></w:r>${wrap[1]}`)); buffer = ""; } };
      const element = (xml: string) => { flush(); output.push(bounded(`${wrap[0]}<w:r>${style}${xml}</w:r>${wrap[1]}`)); };
      for (let index = 0; index < source.length; index++) {
        const code = source.charCodeAt(index), field = fields.at(-1);
        if (code === 0x13) { flush(); fields.push({ instruction: "", result: false }); continue; }
        if (code === 0x14 && field && !field.result) {
          flush(); field.result = true;
          const target = hyperlinkTarget(field.instruction);
          // Links do not nest: a hyperlink field inside a linked result shows its text under the outer link.
          if (target && fields.some(other => other.link)) field.inner = true;
          else if (target) { field.link = linkOpen(target); output.push(field.link); }
          else output.push(`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${text(field.instruction)}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`);
          continue;
        }
        if (code === 0x15 && field) {
          flush(); fields.pop();
          if (field.link) output.push("</w:hyperlink>");
          else if (!field.inner) output.push(`${field.result ? "" : `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${text(field.instruction)}</w:instrText></w:r>`}<w:r><w:fldChar w:fldCharType="end"/></w:r>`);
          continue;
        }
        if (field && !field.result) { if (field.instruction.length < 4096) field.instruction += source[index]; continue; }
        if (code >= 0x20 && code !== 0xfffe && code !== 0xffff) {
          if (properties.special && code === 0x28 && properties.symbol) element("<w:sym/>"); else buffer += source[index];
        } else if (code === 0x09) element("<w:tab/>");
        else if (code === 0x0b) element("<w:br/>");
        else if (code === 0x0c) element(`<w:br w:type="page"/>`);
        else if (code === 0x0e) element(`<w:br w:type="column"/>`);
        else if (code === 0x1e) buffer += "‑";
        else if (properties.special && code === 0x01) element(properties.pictureOffset !== undefined && !properties.embedded ? pictureXml(properties.pictureOffset) : "<w:object/>");
        else if (properties.special && code === 0x08) element(floatingXml(cp + index));
        else if (properties.special && code === 0x02) element(`<w:footnoteReference w:id="1"/>`);
        else if (properties.special && code === 0x05) element(`<w:commentReference w:id="0"/>`);
      }
      flush();
    }
    if (fields.some(field => field.link && field.result)) output.push("</w:hyperlink>");
    return output.join("");
  }
  function paragraphXml(paragraph: DocParagraph): string {
    const { properties } = paragraph, numbered = properties.list > 0 && lists[properties.list - 1];
    const items = [properties.pageBreakBefore ? "<w:pageBreakBefore/>" : "", numbered ? `<w:numPr><w:ilvl w:val="${Math.min(8, properties.listLevel)}"/><w:numId w:val="${properties.list}"/></w:numPr>` : "",
      ALIGNMENTS[properties.align] ? `<w:jc w:val="${ALIGNMENTS[properties.align]}"/>` : "", paragraph.heading >= 1 && paragraph.heading <= 6 ? `<w:outlineLvl w:val="${paragraph.heading - 1}"/>` : "",
      paragraph.section ? sectionXml(paragraph.section, content.hasHeaders) : ""];
    return `${bounded(`<w:p><w:pPr>${items.join("")}</w:pPr>`)}${runsXml(paragraph.runs)}</w:p>`;
  }
  function tableXml(table: DocTable): string {
    // Rows may place their cell edges differently; the grid is the union of all edges.
    const edges = [...new Set(table.rows.flatMap(row => row.description?.cells.flatMap(cell => [cell.left, cell.right]) ?? []))].sort((a, b) => a - b);
    const widest = Math.max(1, ...table.rows.map(row => row.cells.length));
    const grid = edges.length > 1 ? edges.slice(1).map((edge, index) => edge - edges[index]) : Array.from({ length: widest }, () => 2000);
    // The DOCX reader refuses wider tables; refuse them here, before every cell is measured against the grid.
    if (grid.length > 100) return fail("表の列数が読み込み上限を超えています");
    const column = new Map(edges.map((edge, index) => [edge, index]));
    const rows = table.rows.map(row => {
      // Every row is laid out over the whole grid, whatever its own edges and cell count say: the first
      // cell starts at the first column, the last one ends at the last, and text without a column of
      // its own joins the neighbouring cell. Rows of different widths would not form a table.
      const description = edges.length > 1 ? row.description : undefined, columns = grid.length;
      const groups: { start: number; end: number; cell: TableCell | undefined; blocks: DocBlock[] }[] = [];
      if (description?.cells.length) {
        for (let index = 0; index < description.cells.length; index++) {
          const cell = description.cells[index];
          let last = index;
          if (cell.firstMerged) while (description.cells[last + 1]?.merged) last++;
          // The text of cells merged into this one follows it in the binary format; keep all of it.
          const group = { start: column.get(cell.left) ?? 0, end: column.get(description.cells[last].right) ?? 0, cell, blocks: row.cells.slice(index, last + 1).flat() };
          if (group.end > group.start || !groups.length) groups.push(group); else groups.at(-1)!.blocks.push(...group.blocks);
          index = last;
        }
        // A leading cell without width gives its text to the first cell that has one.
        while (groups.length > 1 && groups[0].end <= groups[0].start) { const [empty] = groups.splice(0, 1); groups[0].blocks.unshift(...empty.blocks); }
        groups[0].start = 0; groups.at(-1)!.end = columns;
        groups.at(-1)!.blocks.push(...row.cells.slice(description.cells.length).flat());
      } else if (row.cells.length) {
        const count = Math.min(columns, row.cells.length);
        for (let index = 0; index < count; index++) groups.push({ start: index, end: index + 1, cell: row.description?.cells[index], blocks: row.cells[index] });
        groups.at(-1)!.end = columns;
        groups.at(-1)!.blocks.push(...row.cells.slice(count).flat());
      }
      const cells = groups.map(({ start, end, cell, blocks }) => {
        const body = blocks.map(blockXml).join("") || "<w:p/>", span = end - start, width = grid.slice(start, end).reduce((total, column) => total + Math.max(0, column), 0);
        const properties = [`<w:tcW w:w="${width}" w:type="dxa"/>`, span > 1 ? `<w:gridSpan w:val="${span}"/>` : "",
          cell?.verticalMerge === "restart" ? `<w:vMerge w:val="restart"/>` : cell?.verticalMerge === "continue" ? "<w:vMerge/>" : "", cell?.borders ? `<w:tcBorders>${cell.borders}</w:tcBorders>` : "",
          cell?.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${cell.shade}"/>` : ""];
        return `<w:tc><w:tcPr>${properties.join("")}</w:tcPr>${/<\/w:p>$|<w:p\/>$/.test(body) ? body : `${body}<w:p/>`}</w:tc>`;
      });
      return `<w:tr>${row.description?.header ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells.join("")}</w:tr>`;
    });
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${grid.map(width => `<w:gridCol w:w="${Math.max(0, width)}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>`;
  }
  function blockXml(block: DocBlock): string { return block.kind === "table" ? tableXml(block) : paragraphXml(block); }

  const body = content.blocks.map(blockXml).join("");
  const numbering = lists.map((list, index) => list ? `<w:abstractNum w:abstractNumId="${index}">${list.levels.map((level, depth) =>
    `<w:lvl w:ilvl="${depth}"><w:start w:val="${Math.min(1_000_000, Math.max(0, level.start))}"/><w:numFmt w:val="${NUMBER_FORMATS[level.format] ?? "custom"}"/>` +
    // Level placeholders are stored as characters 0–8.
    `<w:lvlText w:val="${attribute(level.text.replace(/[\u0000-\u0008]/g, character => `%${character.charCodeAt(0) + 1}`))}"/></w:lvl>`).join("")}</w:abstractNum>` : "").join("") +
    lists.map((list, index) => list ? `<w:num w:numId="${index + 1}"><w:abstractNumId w:val="${index}"/></w:num>` : "").join("");
  const part = (path: string, xml: string) => { parts.push([path, encoder.encode(xml)]); };
  if (content.hasHeaders) relationships.push(`<Relationship Id="rIdHeader" Type="${R}/header" Target="header1.xml"/>`);
  if (numbering) relationships.push(`<Relationship Id="rIdNumbering" Type="${R}/numbering" Target="numbering.xml"/>`);
  part("word/document.xml", `${XML_HEADER}<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="${PICTURE}" xmlns:wps="${SHAPE}"><w:body>${body}${sectionXml(content.lastSection, content.hasHeaders)}</w:body></w:document>`);
  if (content.hasHeaders) part("word/header1.xml", `${XML_HEADER}<w:hdr xmlns:w="${W}"><w:p/></w:hdr>`);
  if (numbering) part("word/numbering.xml", `${XML_HEADER}<w:numbering xmlns:w="${W}">${numbering}</w:numbering>`);
  part("word/_rels/document.xml.rels", `${XML_HEADER}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">${relationships.join("")}</Relationships>`);
  part("docProps/core.xml", `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${text(input.title ?? "")}</dc:title></cp:coreProperties>`);
  part("_rels/.rels", `${XML_HEADER}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  part("[Content_Types].xml", `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>${[...extensions].map(([extension, type]) => `<Default Extension="${extension}" ContentType="${type}"/>`).join("")}` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `${numbering ? `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` : ""}` +
    `${content.hasHeaders ? `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>` : ""}</Types>`);
  return { parts, bitmaps };
}
