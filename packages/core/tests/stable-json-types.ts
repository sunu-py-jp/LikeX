import { serializeStableJson, type StableJsonOptions } from "../src/stable-json";

const options: StableJsonOptions = {
  maxLength: 1024,
  space: 2,
  compareKeys: (left, right, path) => path.at(-1) === "rows" ? Number(left) - Number(right) : 0,
};
const serialized: string = serializeStableJson({ rows: { 10: "b", 1: "a" } }, options);
// @ts-expect-error Limits use numeric UTF-16 character counts.
serializeStableJson({}, { maxLength: "100" });
// @ts-expect-error Comparators return a number, not a list of keys.
serializeStableJson({}, { compareKeys: () => ["a", "b"] });
// @ts-expect-error Indentation is a number of spaces, not arbitrary text.
serializeStableJson({}, { space: "  " });
void serialized;
