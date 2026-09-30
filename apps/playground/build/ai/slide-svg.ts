import { createSlideSvgSource } from "@likex/slide/model";
import type { JSONSchema } from "./command-schema.ts";
import { invalidArgument } from "./tool-errors.ts";

const identifier: JSONSchema = { type: "string", minLength: 1, maxLength: 200 };
const nullableText: JSONSchema = { anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }] };
const fields: Record<string, JSONSchema> = {
  slideId: identifier, elementId: identifier,
  svg: { type: "string", minLength: 1, maxLength: 256000 },
  x: { type: "number" }, y: { type: "number" },
  width: { type: "number", minimum: 0.001 }, height: { type: "number", minimum: 0.001 },
  name: nullableText, alt: nullableText,
  dryRun: { type: "boolean" }, resolvesFailureIds: { type: "array", items: { type: "string" }, maxItems: 32 },
};
export const slideSvgParameters: JSONSchema = { type: "object", properties: fields, required: Object.keys(fields), additionalProperties: false };
const updateFields = Object.fromEntries(["slideId", "elementId", "svg", "dryRun", "resolvesFailureIds"].map(key => [key, fields[key]]));
export const slideSvgUpdateParameters: JSONSchema = { type: "object", properties: updateFields, required: Object.keys(updateFields), additionalProperties: false };
type SvgMode = "add" | "update";

/** Keep the native target and image fields available even when SVG validation fails. */
export function slideSvgIntent(input: Record<string, unknown>, mode: SvgMode = "add"): Record<string, unknown>[] {
  if (mode === "update") return [{ type: "element.update", slideId: input.slideId, elementId: input.elementId, patch: { src: input.svg } }];
  return [{ type: "element.add", slideId: input.slideId, element: {
    type: "image", id: input.elementId, src: input.svg,
    x: input.x, y: input.y, width: input.width, height: input.height,
    ...(input.name == null ? {} : { name: input.name }), ...(input.alt == null ? {} : { alt: input.alt }),
  } }];
}

/** Raw model-authored markup never bypasses the public native SVG validator. */
export function slideSvgCommands(input: Record<string, unknown>, mode: SvgMode = "add"): Record<string, unknown>[] {
  let src: string;
  try { src = createSlideSvgSource(input.svg as string); }
  catch (error) {
    invalidArgument(`${mode === "update" ? "update" : "add"}_svg_image.svg`, error instanceof Error ? error.message.slice(0, 1000) : "valid self-contained static SVG", input.svg);
  }
  const [command] = slideSvgIntent(input, mode);
  if (mode === "update") return [{ ...command, patch: { src } }];
  return [{ ...command, element: { ...(command.element as Record<string, unknown>), src } }];
}
