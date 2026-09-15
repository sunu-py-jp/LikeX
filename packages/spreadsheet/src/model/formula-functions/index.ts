import type { SpreadsheetFunctionName } from "../function-definitions";
import type { FunctionHandler } from "./runtime";
import { BASIC_FUNCTIONS } from "./basic";
import { CONDITIONAL_AGGREGATION_FUNCTIONS } from "./conditional-aggregation";
import { TEXT_FUNCTIONS } from "./text";
import { LOOKUP_FUNCTIONS } from "./lookup";
import { DATE_FUNCTIONS } from "./date";

/** Compile-time coverage keeps the picker, export allow-list and evaluator in agreement. */
export const FUNCTION_HANDLERS = Object.freeze({
  ...BASIC_FUNCTIONS, ...CONDITIONAL_AGGREGATION_FUNCTIONS, ...TEXT_FUNCTIONS, ...LOOKUP_FUNCTIONS, ...DATE_FUNCTIONS,
} satisfies Record<SpreadsheetFunctionName, FunctionHandler>);
