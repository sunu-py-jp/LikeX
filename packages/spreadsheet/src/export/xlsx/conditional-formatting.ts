import { cellAddress } from "../../model/address";
import type { SpreadsheetSheet } from "../../model/types";
import { opaqueXlsxColor, type XlsxStyles } from "./styles";
import { xml } from "./xml";
const operators = { gt: "greaterThan", gte: "greaterThanOrEqual", lt: "lessThan", lte: "lessThanOrEqual", eq: "equal", neq: "notEqual", between: "between", notBetween: "notBetween" };
export function conditionalFormattingXml(sheet: SpreadsheetSheet, styles: XlsxStyles): string {
  return (sheet.conditionalFormats ?? []).map((rule, index) => {
    const ranges = rule.ranges.map(r => `${cellAddress(r.top, r.left)}:${cellAddress(r.bottom, r.right)}`).join(" ");
    const priority = `priority="${index + 1}"`;
    let content: string;
    if (rule.type === "comparison") content = `<cfRule type="cellIs" dxfId="${styles.dxfId(rule.format)}" ${priority} operator="${operators[rule.operator]}"${rule.stopIfTrue ? ' stopIfTrue="1"' : ""}><formula>${xml(rule.value)}</formula>${rule.secondValue !== undefined && ["between", "notBetween"].includes(rule.operator) ? `<formula>${xml(rule.secondValue)}</formula>` : ""}</cfRule>`;
    else if (rule.type === "text") {
      const first = rule.ranges[0], address = cellAddress(first.top, first.left), literal = `"${rule.value.replaceAll('"', '""')}"`;
      const condition = rule.operator === "contains" ? `ISNUMBER(FIND(LOWER(${literal}),LOWER(${address})))` : rule.operator === "notContains" ? `ISERROR(FIND(LOWER(${literal}),LOWER(${address})))` : `${rule.operator === "startsWith" ? "LEFT" : "RIGHT"}(${address},LEN(${literal}))=${literal}`;
      content = `<cfRule type="expression" dxfId="${styles.dxfId(rule.format)}" ${priority}${rule.stopIfTrue ? ' stopIfTrue="1"' : ""}><formula>${xml(`AND(LEN(${address})>0,${condition})`)}</formula></cfRule>`;
    } else {
      const minimum = rule.min === undefined ? '<cfvo type="min"/>' : `<cfvo type="num" val="${xml(rule.min)}"/>`;
      const maximum = rule.max === undefined ? '<cfvo type="max"/>' : `<cfvo type="num" val="${xml(rule.max)}"/>`;
      if (rule.type === "dataBar") content = `<cfRule type="dataBar" ${priority}><dataBar minLength="0" maxLength="100">${minimum}${maximum}<color rgb="FF${opaqueXlsxColor(rule.color, "638EC6")}"/></dataBar></cfRule>`;
      else content = `<cfRule type="colorScale" ${priority}><colorScale>${minimum}${rule.colors.length === 3 ? '<cfvo type="percent" val="50"/>' : ""}${maximum}${rule.colors.map(color => `<color rgb="FF${opaqueXlsxColor(color, "FFFFFF")}"/>`).join("")}</colorScale></cfRule>`;
    }
    return `<conditionalFormatting sqref="${xml(ranges)}">${content}</conditionalFormatting>`;
  }).join("");
}
