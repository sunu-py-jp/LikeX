import type { SpreadsheetProps, SpreadsheetSheetColorMode, SpreadsheetWorkbook } from "../src";
import type { SpreadsheetThumbnailProps } from "../src/thumbnail";

declare const workbook: SpreadsheetWorkbook;
const modes: readonly SpreadsheetSheetColorMode[] = ["light", "dark", "inherit"];
const independent: SpreadsheetProps = { colorMode: "dark", sheetColorMode: "light" };
const darkSheet: SpreadsheetProps = { colorMode: "light", sheetColorMode: "dark", readOnly: true };
const inherited: SpreadsheetProps = { colorMode: "system", sheetColorMode: "inherit" };
const preview: SpreadsheetThumbnailProps = { workbook, colorMode: "system", sheetColorMode: modes[2] };
// @ts-expect-error System preferences are resolved by the surrounding UI color mode.
const invalidMode: SpreadsheetSheetColorMode = "system";
// @ts-expect-error Sheet appearance is a closed string union.
const invalidEditor: SpreadsheetProps = { sheetColorMode: true };
// @ts-expect-error Thumbnails use the same closed sheet color modes.
const invalidPreview: SpreadsheetThumbnailProps = { workbook, sheetColorMode: "auto" };
void [modes, independent, darkSheet, inherited, preview, invalidMode, invalidEditor, invalidPreview];
