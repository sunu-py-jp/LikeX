import { parseCellAddress } from "../../model/address";
import type { SpreadsheetSheet } from "../../model/types";
import type { XlsxContentType, XlsxPart, XlsxRelationship } from "./types";
import { xml, xlsxText } from "./xml";

/** The model has standalone comments, which map to Excel notes, not threaded conversations. */
export function commentParts(sheet: SpreadsheetSheet, index: number): {
  parts: XlsxPart[]; relationships: XlsxRelationship[]; contentTypes: XlsxContentType[]; legacyDrawingId?: string;
} {
  const entries = Object.entries(sheet.comments ?? {}).sort(([left], [right]) => {
    const a = parseCellAddress(left)!, b = parseCellAddress(right)!; return a.row - b.row || a.column - b.column;
  });
  if (!entries.length) return { parts: [], relationships: [], contentTypes: [] };
  const authors = [...new Set(entries.map(([, comment]) => comment.author ?? ""))];
  const comments = entries.map(([address, comment]) => {
    if (comment.text.length > 32_767) throw new Error(`Excelのメモの文字数上限を超えています（${sheet.name}!${address}）`);
    return `<comment ref="${xml(address)}" authorId="${authors.indexOf(comment.author ?? "")}"><text><t xml:space="preserve">${xlsxText(comment.text)}</t></text></comment>`;
  }).join("");
  const noteXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors>${authors.map(author => `<author>${xlsxText(author)}</author>`).join("")}</authors><commentList>${comments}</commentList></comments>`;
  const shapes = entries.map(([address], note) => {
    const { row, column } = parseCellAddress(address)!;
    return `<v:shape id="_x0000_s${1025 + note}" type="#_x0000_t202" style="position:absolute;margin-left:0;margin-top:0;width:144pt;height:79pt;z-index:${note + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"/></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${column}, 15, ${row}, 2, ${column + 2}, 15, ${row + 4}, 2</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${row}</x:Row><x:Column>${column}</x:Column></x:ClientData></v:shape>`;
  }).join("");
  const vml = `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>${shapes}</xml>`;
  const path = `xl/comments${index}.xml`, drawingPath = `xl/drawings/comments${index}.vml`;
  return {
    parts: [{ path, content: new Blob([noteXml], { type: "application/xml" }) }, { path: drawingPath, content: new Blob([vml], { type: "application/xml" }) }],
    relationships: [
      { id: "rIdComments", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments", target: `../comments${index}.xml` },
      { id: "rIdCommentsDrawing", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing", target: `../drawings/comments${index}.vml` },
    ],
    contentTypes: [{ partName: `/${path}`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml" },
      { extension: "vml", contentType: "application/vnd.openxmlformats-officedocument.vmlDrawing" }],
    legacyDrawingId: "rIdCommentsDrawing",
  };
}
