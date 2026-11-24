import { xmlAttribute } from "./biff";
import { xlsColor, type XlsBook, type XlsFont, type XlsFormat } from "./biff-book";

const BORDER_STYLES = ["none", "thin", "medium", "dashed", "dotted", "thick", "double", "hair", "mediumDashed", "dashDot", "mediumDashDot", "dashDotDot", "mediumDashDotDot", "slantDashDot"];
const FILL_PATTERNS = ["none", "solid", "mediumGray", "darkGray", "lightGray", "darkHorizontal", "darkVertical", "darkDown", "darkUp", "darkGrid", "darkTrellis",
  "lightHorizontal", "lightVertical", "lightDown", "lightUp", "lightGrid", "lightTrellis", "gray125", "gray0625"];
const HORIZONTAL = [undefined, "left", "center", "right", "fill", "justify", "centerContinuous", "distributed"];
const VERTICAL = ["top", "center", undefined, "justify", "distributed"];
const UNDERLINES: Readonly<Record<number, string>> = { 1: "single", 2: "double", 0x21: "singleAccounting", 0x22: "doubleAccounting" };
export const MAIN_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** Font records skip index 4, so a reference of 5 or more points one record earlier. */
export const fontRecordIndex = (book: XlsBook, index: number): number => {
  const record = index > 4 ? index - 1 : index;
  return record < book.fonts.length ? record : 0;
};
const color = (book: XlsBook, index: number, name = "color"): string => {
  const rgb = xlsColor(book, index);
  return rgb ? `<${name} rgb="FF${rgb}"/>` : "";
};
function fontXml(book: XlsBook, font: XlsFont): string {
  return `<font>${font.bold ? "<b/>" : ""}${font.italic ? "<i/>" : ""}${font.strike ? "<strike/>" : ""}${font.outline ? "<outline/>" : ""}${font.shadow ? "<shadow/>" : ""}` +
    `${UNDERLINES[font.underline] ? `<u val="${UNDERLINES[font.underline]}"/>` : ""}${font.escapement === 1 || font.escapement === 2 ? `<vertAlign val="${font.escapement === 1 ? "superscript" : "subscript"}"/>` : ""}` +
    `<sz val="${font.size}"/>${color(book, font.color)}<name val="${xmlAttribute(font.name)}"/></font>`;
}
function fillXml(book: XlsBook, format: XlsFormat): string {
  const pattern = FILL_PATTERNS[format.pattern] ?? "none";
  if (pattern === "none") return `<fill><patternFill patternType="none"/></fill>`;
  return `<fill><patternFill patternType="${pattern}">${color(book, format.foreground, "fgColor")}${color(book, format.background, "bgColor")}</patternFill></fill>`;
}
function borderXml(book: XlsBook, format: XlsFormat): string {
  const edge = (name: "left" | "right" | "top" | "bottom" | "diagonal", enabled = true) => {
    const style = enabled ? BORDER_STYLES[format.borders[name]] : undefined;
    return style && style !== "none" ? `<${name} style="${style}">${color(book, format.borderColors[name])}</${name}>` : `<${name}/>`;
  };
  const diagonal = format.diagonalDown || format.diagonalUp;
  return `<border${format.diagonalUp ? ' diagonalUp="1"' : ""}${format.diagonalDown ? ' diagonalDown="1"' : ""}>${edge("left")}${edge("right")}${edge("top")}${edge("bottom")}${edge("diagonal", diagonal)}</border>`;
}
function alignmentXml(format: XlsFormat): string {
  const attributes = [HORIZONTAL[format.horizontal] && `horizontal="${HORIZONTAL[format.horizontal]}"`, VERTICAL[format.vertical] && `vertical="${VERTICAL[format.vertical]}"`,
    format.rotation && `textRotation="${format.rotation}"`, format.wrap && `wrapText="1"`, format.indent && `indent="${format.indent}"`, format.shrink && `shrinkToFit="1"`].filter(Boolean);
  return attributes.length ? `<alignment ${attributes.join(" ")}/>` : "";
}

/**
 * Writes styles.xml with one cell format per XF record, so a cell's format index is unchanged.
 * Colours are resolved through the workbook palette; BIFF8 has no theme.
 */
export function xlsStylesXml(book: XlsBook): string {
  const fonts = book.fonts.length ? book.fonts : [{ name: "Arial", size: 10, bold: false, italic: false, strike: false, outline: false, shadow: false, underline: 0, escapement: 0, color: 0x7fff }];
  const fills = [`<fill><patternFill patternType="none"/></fill>`, `<fill><patternFill patternType="gray125"/></fill>`], borders = [`<border><left/><right/><top/><bottom/><diagonal/></border>`];
  const index = (list: string[], item: string) => { const found = list.indexOf(item); return found >= 0 ? found : list.push(item) - 1; };
  const formats = book.formats.map(format => {
    const alignment = alignmentXml(format);
    return `<xf numFmtId="${format.numberFormat}" fontId="${fontRecordIndex(book, format.font)}" fillId="${index(fills, fillXml(book, format))}" borderId="${index(borders, borderXml(book, format))}" xfId="0"` +
      ` applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"${alignment ? `>${alignment}</xf>` : "/>"}`;
  });
  const numberFormats = [...book.numberFormats].map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${xmlAttribute(code)}"/>`);
  // The first format record is the Normal style, whose font defines the column width unit.
  const normalFont = fontRecordIndex(book, book.formats[0]?.font ?? 0);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${MAIN_NAMESPACE}">` +
    (numberFormats.length ? `<numFmts count="${numberFormats.length}">${numberFormats.join("")}</numFmts>` : "") +
    `<fonts count="${fonts.length}">${fonts.map(font => fontXml(book, font)).join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills>` +
    `<borders count="${borders.length}">${borders.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="${normalFont}" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${Math.max(1, formats.length)}">${formats.length ? formats.join("") : `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}
