import type { JSONSchema } from "./command-schema.ts";

const writeTools = new Set(["apply_commands", "update_slide_text", "format_slide_elements", "add_svg_image", "update_svg_image"]);

/** The LLM must bind each write to an immutable read; an implicit latest baseline is unsafe. */
export function liveToolDefinitions<T extends { name: string; description: string; parameters: JSONSchema }>(definitions: T[]): T[] {
  return definitions.filter(tool => tool.name !== "create_document").map(tool => writeTools.has(tool.name) ? { ...tool,
    description: tool.description + " Each successful write is applied immediately. REQUIRED baseRevision: copy the readRevision of the read that supplied this edit's original values. On conflict, inspect the target again and reconsider before resubmitting. No partial batch is applied on conflict.",
    parameters: { ...tool.parameters, properties: { ...tool.parameters.properties, baseRevision: { type: "string", minLength: 1, maxLength: 100 } },
      required: [...(tool.parameters.required ?? []), "baseRevision"] },
  } : tool);
}
