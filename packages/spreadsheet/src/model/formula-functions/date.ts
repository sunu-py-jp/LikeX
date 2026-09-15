import { EXCEL_DATE_SERIAL_END, excelSerialFromUtc, excelUtcFromSerial } from "../formatting/excel-date";
import { fail, integerArgument, number, type FunctionContext, type FunctionHandler } from "./runtime";

function datePart(c: FunctionContext, part: "year" | "month" | "day") {
  c.checkArity(1); const value = number(c.scalar(0));
  if (value < 0 || value >= EXCEL_DATE_SERIAL_END) return fail("#NUM!");
  const serial = Math.floor(value);
  if (serial === 0) return part === "year" ? 1900 : part === "month" ? 1 : 0;
  if (serial === 60) return part === "year" ? 1900 : part === "month" ? 2 : 29;
  const date = new Date(excelUtcFromSerial(serial));
  return part === "year" ? date.getUTCFullYear() : part === "month" ? date.getUTCMonth() + 1 : date.getUTCDate();
}
export const DATE_FUNCTIONS = {
  DATE: c => {
    c.checkArity(3);
    let year = integerArgument(c, 0);
    const month = integerArgument(c, 1), day = integerArgument(c, 2);
    if (year < 0 || year >= 10000) return fail("#NUM!");
    if (year < 1900) year += 1900;
    // Start of month + day offset preserves serial 60 when month/day overflow crosses February 1900.
    const start = Date.UTC(year, month - 1, 1);
    const serial = excelSerialFromUtc(start) + day - 1;
    return Number.isFinite(serial) && serial >= 0 && serial < EXCEL_DATE_SERIAL_END ? serial : fail("#NUM!");
  },
  YEAR: c => datePart(c, "year"), MONTH: c => datePart(c, "month"), DAY: c => datePart(c, "day"),
} satisfies Record<string, FunctionHandler>;
