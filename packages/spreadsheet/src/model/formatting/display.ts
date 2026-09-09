import type { SpreadsheetCell, SpreadsheetCellFormat, SpreadsheetCalculatedValue } from "../types";

/** Date validation supplies its natural display format unless the host selected another format. */
export function effectiveCellFormat(cell?: SpreadsheetCell): SpreadsheetCellFormat | undefined {
  return cell?.validation?.type === "date" && (!cell.format?.numberFormat || cell.format.numberFormat === "general") ? { ...cell.format, numberFormat: "date" } : cell?.format;
}
const DAY = 86_400_000, EPOCH = Date.UTC(1899, 11, 31);
type DateKind = "date" | "time" | "datetime";
/** ISO civil dates/times only. No locale parsing or timezone-dependent interpretation. */
export function excelDateSerial(value: string, kind: DateKind): number | undefined {
  const date = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  const time = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (kind === "time" && time) {
    const [h, m, s] = [Number(time[1]), Number(time[2]), Number(time[3] ?? 0)];
    if (h > 23 || m > 59 || s > 59) return undefined;
    return (h * 3600 + m * 60 + s + Number(`0.${time[4] ?? 0}`)) / 86400;
  }
  if (!date) return undefined;
  const [year, month, day, hour, minute, second] = date.slice(1, 7).map(item => Number(item ?? 0));
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return undefined;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, Number((date[7] ?? "0").padEnd(3, "0")));
  const parsed = new Date(utc);
  if (parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return undefined;
  let milliseconds = utc;
  const zone = date[8];
  if (zone && zone !== "Z") {
    const zoneHour = Number(zone.slice(1, 3)), zoneMinute = Number(zone.slice(4));
    if (zoneHour > 23 || zoneMinute > 59) return undefined;
    milliseconds -= (zone[0] === "+" ? 1 : -1) * (zoneHour * 60 + zoneMinute) * 60000;
  }
  const serial = (milliseconds - EPOCH) / DAY + (milliseconds >= Date.UTC(1900, 2, 1) ? 1 : 0);
  return kind === "time" ? ((serial % 1) + 1) % 1 : kind === "date" ? Math.floor(serial) : serial;
}
function dateDisplay(value: SpreadsheetCalculatedValue, kind: DateKind): string {
  const serial = typeof value === "number" ? value : typeof value === "string" ? excelDateSerial(value, kind) : undefined;
  if (serial === undefined || !Number.isFinite(serial) || serial < 0 || serial >= 2958466) return String(value);
  const whole = Math.floor(serial), milliseconds = Math.round((serial - whole) * DAY);
  const date = new Date(EPOCH + (whole >= 60 ? whole - 1 : whole) * DAY + milliseconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = whole === 60 ? "1900/02/29" : `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}`;
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  return kind === "date" ? day : kind === "time" ? time : `${day} ${time}`;
}
export function isNegativeRed(value: SpreadsheetCalculatedValue | undefined, format?: SpreadsheetCellFormat) {
  return typeof value === "number" && value < 0 && (format?.negativeFormat === "red" || format?.negativeFormat === "red-parentheses");
}
/** Shared deterministic display contract for grid, automatic sizing and export settings. */
export function formatCellValue(value: SpreadsheetCalculatedValue | undefined, format?: SpreadsheetCellFormat): string {
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const kind = format?.numberFormat ?? "general";
  if (kind === "date" || kind === "time" || kind === "datetime") return dateDisplay(value, kind);
  if (typeof value !== "number") return String(value);
  if (kind === "general") return value < 0 && format?.negativeFormat?.includes("parentheses") ? `(${Math.abs(value)})` : String(value);
  const decimals = format?.decimalPlaces;
  const negative = value < 0 && (format?.negativeFormat === "parentheses" || format?.negativeFormat === "red-parentheses");
  const output = new Intl.NumberFormat("ja-JP", {
    ...(kind === "percent" ? { style: "percent" as const } : kind === "currency" ? { style: "currency" as const, currency: "JPY" } : {}),
    useGrouping: format?.useGrouping ?? true,
    ...(decimals !== undefined ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals } : kind !== "currency" ? { maximumFractionDigits: 2 } : {}),
  }).format(negative ? Math.abs(value) : value);
  return negative ? `(${output})` : output;
}
export function cellNumberFormatCode(format?: SpreadsheetCellFormat): string | undefined {
  const kind = format?.numberFormat ?? "general";
  if (kind === "general") {
    if (!format?.negativeFormat || format.negativeFormat === "minus") return undefined;
    return `General;${format.negativeFormat.includes("red") ? "[Red]" : ""}${format.negativeFormat.includes("parentheses") ? "(General)" : "-General"}`;
  }
  if (kind === "date") return "yyyy/mm/dd";
  if (kind === "time") return "hh:mm:ss";
  if (kind === "datetime") return "yyyy/mm/dd hh:mm:ss";
  const digits = format?.decimalPlaces === undefined ? kind === "currency" ? "" : ".##" : format.decimalPlaces ? `.${"0".repeat(format.decimalPlaces)}` : "";
  const number = `${format?.useGrouping === false ? "0" : "#,##0"}${digits}`;
  const positive = kind === "currency" ? `"¥"${number}` : kind === "percent" ? `${number}%` : number;
  const red = format?.negativeFormat?.includes("red") ? "[Red]" : "";
  const parentheses = format?.negativeFormat?.includes("parentheses");
  return `${positive};${red}${parentheses ? `(${positive})` : `-${positive}`}`;
}
