import type { SpreadsheetCalculatedValue as Value } from "../types";
import { compareValues, numeric, recoverableErrors } from "./runtime";

type PatternToken = { kind: "literal"; value: string } | { kind: "star" | "any" };
/** Glob matching uses an explicit loop and the workbook budget, never user-provided regular expressions. */
export function wildcardMatcher(pattern: string, tick: () => void, caseSensitive = false) {
  const fold = (value: string) => caseSensitive ? value : value.toLocaleLowerCase("en-US");
  const chars = [...pattern];
  const tokens: PatternToken[] = [];
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (char === "~" && ["*", "?", "~"].includes(chars[index + 1])) tokens.push({ kind: "literal", value: fold(chars[++index]) });
    else if (char === "*") { if (tokens.at(-1)?.kind !== "star") tokens.push({ kind: "star" }); }
    else if (char === "?") tokens.push({ kind: "any" });
    else tokens.push({ kind: "literal", value: fold(char) });
  }
  let previous: string | undefined, value: string[] = [];
  return (input: string, start = 0, prefix = false): boolean => {
    if (input !== previous) {
      value = [];
      for (const char of input) { tick(); value.push(fold(char)); }
      previous = input;
    }
    let at = start, part = 0, star = -1, retry = start;
    while (at < value.length) {
      tick();
      if (prefix && part === tokens.length) return true;
      const token = tokens[part];
      if (token?.kind === "any" || (token?.kind === "literal" && token.value === value[at])) { at++; part++; }
      else if (token?.kind === "star") { star = part++; retry = at; }
      else if (star !== -1) { part = star + 1; at = ++retry; }
      else return false;
    }
    while (tokens[part]?.kind === "star") { tick(); part++; }
    return part === tokens.length;
  };
}

/** Common numeric/comparison/wildcard criteria for the six conditional aggregation functions. */
export function criteriaMatcher(criteria: Value, tick: () => void): (value: Value | null) => boolean {
  const expression = typeof criteria === "string" ? /^(<=|>=|<>|=|<|>)(.*)$/s.exec(criteria) : null;
  const operator = expression?.[1] ?? "=";
  const operand = expression ? expression[2] : criteria;
  const numericOperand = typeof operand === "number" ? operand : typeof operand === "string" && numeric.test(operand.trim()) ? Number(operand) : undefined;
  const wildcard = typeof operand === "string" && numericOperand === undefined && ["=", "<>"].includes(operator)
    ? wildcardMatcher(operand, tick) : undefined;
  return value => {
    tick();
    let comparison: number | undefined;
    if (numericOperand !== undefined) {
      const candidate = typeof value === "number" ? value
        : operator === "=" && typeof value === "string" && numeric.test(value.trim()) ? Number(value) : undefined;
      if (candidate !== undefined) comparison = candidate === numericOperand ? 0 : candidate < numericOperand ? -1 : 1;
    } else if (wildcard) {
      const candidate = value === null && operand === "" ? "" : value;
      // Wildcards apply to text; they do not stringify numbers or logical values.
      comparison = typeof candidate === "string" && (!recoverableErrors.has(candidate) || typeof operand === "string" && candidate.toLocaleLowerCase("en-US") === operand.toLocaleLowerCase("en-US")) && wildcard(candidate) ? 0 : undefined;
    } else if (value !== null && typeof value === typeof operand &&
      !(typeof value === "string" && recoverableErrors.has(value))) comparison = compareValues(value, operand);
    if (operator === "=") return comparison === 0;
    if (operator === "<>") return comparison !== 0;
    if (comparison === undefined) return false;
    return operator === "<" ? comparison < 0 : operator === ">" ? comparison > 0 : operator === "<=" ? comparison <= 0 : comparison >= 0;
  };
}
