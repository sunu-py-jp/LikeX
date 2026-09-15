import { FormulaError, checked, countable, fail, finite, logical, number, recoverableErrors, round, text,
  appendText, type FunctionContext, type FunctionHandler } from "./runtime";

function aggregate(name: string, c: FunctionContext) {
  // Existing SUM/COUNT/MIN/MAX permit zero arguments.
  if (!["SUM", "COUNT", "MIN", "MAX"].includes(name)) c.checkArity(1, 255);
  const numbers: number[] = [];
  let count = 0;
  for (let index = 0; index < c.count; index++) {
    let values;
    try { values = c.values(index); }
    catch (error) {
      if (name === "COUNTA" && error instanceof FormulaError && recoverableErrors.has(error.code)) { count++; continue; }
      throw error;
    }
    for (const value of values) {
      c.tick();
      if (value === null) continue;
      if (name === "COUNTA") { countable(value); count++; continue; }
      checked(value);
      if (typeof value === "number") numbers.push(value);
      else if (name === "PRODUCT" && !c.referenced(index)) numbers.push(number(value));
    }
  }
  if (name === "COUNTA") return count;
  if (name === "COUNT") return numbers.length;
  if (!numbers.length) return name === "AVERAGE" ? fail("#DIV/0!") : 0;
  if (name === "MIN") return numbers.reduce((value, next) => Math.min(value, next), Infinity);
  if (name === "MAX") return numbers.reduce((value, next) => Math.max(value, next), -Infinity);
  if (name === "PRODUCT") return numbers.reduce((value, next) => finite(value * next), 1);
  const sum = numbers.reduce((total, value) => total + value, 0);
  return finite(name === "AVERAGE" ? sum / numbers.length : sum);
}

function errorFallback(c: FunctionContext, naOnly = false) {
  c.checkArity(2);
  try { const value = c.raw(0); return checked(value ?? ""); }
  catch (error) {
    if (!(error instanceof FormulaError) || !(naOnly ? error.code === "#N/A" : recoverableErrors.has(error.code))) throw error;
    const value = c.raw(1); return checked(value ?? "");
  }
}
function predicate(c: FunctionContext, kind: "blank" | "number" | "text" | "error") {
  c.checkArity(1);
  try {
    const value = c.raw(0);
    if (typeof value === "string" && recoverableErrors.has(value)) return kind === "error";
    return kind === "blank" ? value === null : kind === "number" ? typeof value === "number" : kind === "text" ? typeof value === "string" : false;
  } catch (error) {
    if (!(error instanceof FormulaError) || !recoverableErrors.has(error.code)) throw error;
    return kind === "error";
  }
}
function allAny(c: FunctionContext, all: boolean) {
  c.checkArity(1, 255);
  let count = 0, truth = all;
  for (let index = 0; index < c.count; index++) for (const value of c.values(index)) {
    c.tick();
    if (value === null) continue;
    checked(value);
    if (c.referenced(index) && typeof value === "string") continue;
    const condition = logical(value); count++;
    truth = all ? truth && condition : truth || condition;
  }
  return count ? truth : fail("#VALUE!");
}
function rounded(c: FunctionContext, mode: "nearest" | "up" | "down") {
  c.checkArity(2); return round(number(c.scalar(0)), number(c.scalar(1)), mode);
}
export const BASIC_FUNCTIONS = {
  SUM: c => aggregate("SUM", c), AVERAGE: c => aggregate("AVERAGE", c),
  MIN: c => aggregate("MIN", c), MAX: c => aggregate("MAX", c),
  COUNT: c => aggregate("COUNT", c), COUNTA: c => aggregate("COUNTA", c), PRODUCT: c => aggregate("PRODUCT", c),
  ROUND: c => rounded(c, "nearest"), ROUNDUP: c => rounded(c, "up"), ROUNDDOWN: c => rounded(c, "down"),
  ABS: c => { c.checkArity(1); return Math.abs(number(c.scalar(0))); },
  INT: c => { c.checkArity(1); return Math.floor(number(c.scalar(0))); },
  MOD: c => {
    c.checkArity(2); const a = number(c.scalar(0)), b = number(c.scalar(1));
    if (b === 0) return fail("#DIV/0!");
    const remainder = a % b;
    return finite(remainder === 0 ? 0 : Math.sign(remainder) === Math.sign(b) ? remainder : remainder + b);
  },
  IF: c => {
    c.checkArity(2, 3);
    const index = logical(c.scalar(0)) ? 1 : 2;
    return index === 2 && c.count === 2 ? false : c.scalar(index);
  },
  IFERROR: c => errorFallback(c), IFNA: c => errorFallback(c, true),
  IFS: c => {
    c.checkArity(2, 254); if (c.count % 2) return fail("#VALUE!");
    for (let index = 0; index < c.count; index += 2) if (logical(c.scalar(index))) return c.scalar(index + 1);
    return fail("#N/A");
  },
  ISBLANK: c => predicate(c, "blank"), ISNUMBER: c => predicate(c, "number"),
  ISTEXT: c => predicate(c, "text"), ISERROR: c => predicate(c, "error"),
  AND: c => allAny(c, true), OR: c => allAny(c, false),
  NOT: c => { c.checkArity(1); return !logical(c.scalar(0)); },
  LEN: c => { c.checkArity(1); return [...c.text(0)].length; },
  CONCAT: c => {
    c.checkArity(1, 255); let joined = "";
    for (let index = 0; index < c.count; index++) for (const value of c.values(index)) {
      c.tick(); if (value !== null) {
        const item = text(checked(value)); c.tick(Math.ceil(item.length / 64)); joined = appendText(joined, item);
      }
    }
    return joined;
  },
  ROW: c => { c.checkArity(0, 1); return (c.count ? c.range(0).row : c.position.row) + 1; },
  COLUMN: c => { c.checkArity(0, 1); return (c.count ? c.range(0).column : c.position.column) + 1; },
  ROWS: c => { c.checkArity(1); return c.range(0).rows; },
  COLUMNS: c => { c.checkArity(1); return c.range(0).columns; },
} satisfies Record<string, FunctionHandler>;
