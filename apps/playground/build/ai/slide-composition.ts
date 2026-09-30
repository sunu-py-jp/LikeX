import { getSlideCompositionLayouts, getSlideCompositionPresets } from "@likex/slide/model";
import { commandSchemas, commandVariant, type JSONSchema } from "./command-schema.ts";

/** The wire contract comes from the public command, including its optional-null conversion. */
export function slideCompositionParameters(repository: string): JSONSchema {
  const { strict } = commandSchemas(repository, "slide");
  const { type: _type, ...properties } = commandVariant(strict, "slide.compose").properties!;
  void _type;
  const fields = { ...properties, dryRun: { type: "boolean" }, resolvesFailureIds: { type: "array", items: { type: "string" }, maxItems: 32 } };
  const definitions: Record<string, JSONSchema> = {};
  const collect = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const schema = value as JSONSchema;
    if (schema.$ref) {
      const name = schema.$ref.split("/").at(-1)!;
      if (!definitions[name]) { definitions[name] = strict.$defs![name]; collect(definitions[name]); }
    }
    for (const child of Object.values(value)) collect(child);
  };
  collect(fields);
  return { type: "object", properties: fields, required: Object.keys(fields), additionalProperties: false, $defs: definitions };
}

/** Also retain the intended page and content when boundary validation itself fails. */
export function slideCompositionCommands(input: Record<string, unknown>): Record<string, unknown>[] {
  const { dryRun: _dryRun, resolvesFailureIds: _failures, ...command } = input;
  void _dryRun; void _failures;
  return [{ ...command, type: "slide.compose" }];
}

/** Compact catalog: limits and presets come from the same public model that enforces them. */
export function slideCompositionDesigns() {
  return {
    presets: getSlideCompositionPresets(),
    compositions: getSlideCompositionLayouts(),
    guidance: "Choose one preset for the whole deck and the most useful composition per page. Existing imported master/layout appearance takes priority. Composition replaces all local content on one page; preserve other pages and use text/format tools for small edits. Bounds and measured text density are validated atomically. Shorten wording without dropping requested facts, or propose extra pages when needed. Preview each changed page after its final edit.",
  };
}
