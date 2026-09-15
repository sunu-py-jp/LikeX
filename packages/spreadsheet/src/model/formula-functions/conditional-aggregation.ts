import { checked, fail, finite, type FunctionContext, type FunctionHandler, type FormulaRange } from "./runtime";
import { criteriaMatcher } from "./matching";

function sameSize(a: FormulaRange, b: FormulaRange) {
  if (a.rows !== b.rows || a.columns !== b.columns) fail("#VALUE!");
}
function aggregate(c: FunctionContext, kind: "count" | "sum" | "average", multiple: boolean): number {
  const criteria: { range: FormulaRange; matches: ReturnType<typeof criteriaMatcher> }[] = [];
  let resultRange: FormulaRange | undefined;
  if (multiple) {
    const start = kind === "count" ? 0 : 1;
    c.checkArity(start + 2, start + 254);
    if ((c.count - start) % 2) return fail("#VALUE!");
    if (start) resultRange = c.range(0);
    for (let index = start; index < c.count; index += 2)
      criteria.push({ range: c.range(index), matches: criteriaMatcher(c.criterion(index + 1), c.tick) });
  } else {
    c.checkArity(2, kind === "count" ? 2 : 3);
    const range = c.range(0);
    criteria.push({ range, matches: criteriaMatcher(c.criterion(1), c.tick) });
    resultRange = c.count === 3 ? c.range(2) : range;
  }
  const dimensions = criteria[0].range;
  for (const item of criteria) sameSize(dimensions, item.range);
  if (resultRange) sameSize(dimensions, resultRange);
  let count = 0, sum = 0;
  for (let index = 0; index < dimensions.values.length; index++) {
    c.tick();
    if (!criteria.every(item => item.matches(item.range.values[index]))) continue;
    if (kind === "count") { count++; continue; }
    const value = resultRange!.values[index];
    if (value !== null) checked(value);
    if (typeof value === "number") { sum += value; count++; }
  }
  if (kind === "count") return count;
  return finite(kind === "average" ? count ? sum / count : fail("#DIV/0!") : sum);
}
export const CONDITIONAL_AGGREGATION_FUNCTIONS = {
  COUNTIF: c => aggregate(c, "count", false), SUMIF: c => aggregate(c, "sum", false), AVERAGEIF: c => aggregate(c, "average", false),
  COUNTIFS: c => aggregate(c, "count", true), SUMIFS: c => aggregate(c, "sum", true), AVERAGEIFS: c => aggregate(c, "average", true),
  COUNTBLANK: c => {
    c.checkArity(1);
    let count = 0;
    for (const value of c.range(0).values) { c.tick(); if (value === null || value === "") count++; }
    return count;
  },
} satisfies Record<string, FunctionHandler>;
