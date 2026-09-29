import { parseSlideDeck } from "@likex/slide/model";
import { invalidArgument } from "./tool-errors.ts";

type Command = Record<string, unknown>;
const supported = {
  text: ["fontFamily", "fontSize", "bold", "italic", "textColor", "align", "verticalAlign", "fill", "opacity"],
  shape: ["fontSize", "textColor", "fill", "stroke", "strokeWidth", "opacity"],
  line: ["stroke", "strokeWidth", "opacity", "startArrow", "endArrow"],
  image: ["opacity"],
};

/** Keep one logical field vocabulary for failure recovery before target-specific mapping. */
export function slideFormatCommands(input: Record<string, unknown>): Command[] | undefined {
  if (!Array.isArray(input.elementIds)) return undefined;
  const format = input.format && typeof input.format === "object" && !Array.isArray(input.format) ? input.format as Command : {};
  const patch = Object.fromEntries(Object.entries(format).filter(([, value]) => value !== null));
  return input.elementIds.map(elementId => ({ type: "element.update", slideId: input.slideId, elementId, patch: { ...patch } }));
}

/** Only translate field names. Native element.update still validates and applies the entire batch. */
export function mapSlideFormatCommands(document: string, commands: Command[]): Command[] {
  const deck = parseSlideDeck(document);
  return commands.map((command, index) => {
    const element = deck.slides.find(slide => slide.id === command.slideId)?.elements.find(item => item.id === command.elementId);
    // Reference preflight reports unknown IDs with the existing repair hints.
    if (!element) return command;
    const patch = command.patch as Command;
    const fields = supported[element.type === "shape" && element.shape === "line" ? "line" : element.type];
    for (const key of Object.keys(patch)) if (!fields.includes(key)) invalidArgument(`commands[${index}].patch.${key}`, {
      elementType: element.type, supportedFields: fields,
      hint: "Every selected element must support every requested format field. Split compatible selections; never silently omit a requested field.",
    }, key, "unsupported_format");
    return { ...command, patch: Object.fromEntries(Object.entries(patch).map(([key, value]) => [key === "textColor" && element.type === "text" ? "color" : key, value])) };
  });
}
