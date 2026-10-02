import test from "node:test";
import assert from "node:assert/strict";
import { collectConditionalConflicts } from "../src/conditional-edits.ts";

test("conditional comparison preserves field precision and ignores object key order", () => {
  assert.deepEqual(collectConditionalConflicts({ value: "10", format: { bold: true, color: "red" } }, { format: { color: "red", bold: true }, value: "10" }), []);
  assert.deepEqual(collectConditionalConflicts({ value: "10", format: { bold: true } }, { value: "20", format: { bold: true } }, "A1"), [
    { path: "A1.value", expected: "10", actual: "20" },
  ]);
});

test("missing properties remain distinct from explicit null through JSON", () => {
  const [difference] = collectConditionalConflicts({}, { value: null });
  assert.deepEqual(JSON.parse(JSON.stringify(difference)), { path: "value", actual: null, expectedExists: false, actualExists: true });
});

test("array order and membership changes are detected with bounded diagnostics", () => {
  assert.ok(collectConditionalConflicts(["a", "b"], ["b", "a"]).length);
  assert.equal(collectConditionalConflicts([], ["a"])[0].path, ".length");
  const differences = collectConditionalConflicts(Array(200).fill(0), Array(200).fill(1));
  assert.equal(differences.length, 100);
  assert.equal(differences[0].path, "[0]");
});
