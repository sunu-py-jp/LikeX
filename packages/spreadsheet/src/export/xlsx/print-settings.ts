import { SPREADSHEET_PRINT_DEFAULTS } from "../../model/print-settings";
import type { SpreadsheetPrintSettings } from "../../model/types";

/** Emits the supported print settings in worksheet schema order, before drawings. */
export function printSettingsXml(settings: SpreadsheetPrintSettings | undefined): string {
  if (!settings) return "";
  const defaults = SPREADSHEET_PRINT_DEFAULTS, margins = settings.margins ?? defaults.margins;
  const paper = { A4: 9, A3: 8, Letter: 1 }[settings.paperSize ?? defaults.paperSize];
  const breaks = (name: string, values: readonly number[] | undefined, maximum: number) => values?.length
    ? `<${name} count="${values.length}" manualBreakCount="${values.length}">${values.map(id => `<brk id="${id}" min="0" max="${maximum}" man="1"/>`).join("")}</${name}>` : "";
  return `<pageMargins left="${margins.left}" right="${margins.right}" top="${margins.top}" bottom="${margins.bottom}" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="${paper}" orientation="${settings.orientation ?? defaults.orientation}" scale="${settings.scale ?? defaults.scale}" pageOrder="downThenOver"/>` +
    breaks("rowBreaks", settings.rowBreaks, 16_383) + breaks("colBreaks", settings.columnBreaks, 1_048_575);
}
