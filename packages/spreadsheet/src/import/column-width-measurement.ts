import { DEFAULT_XLSX_COLUMN_WIDTH_METRICS } from "../xlsx-column-width";
import type { ImportContext, SpreadsheetExcelColumnWidthFont, SpreadsheetExcelColumnWidthMetrics, SpreadsheetExcelImportOptions } from "./types";

export const DEFAULT_XLSX_COLUMN_WIDTH_FONT: SpreadsheetExcelColumnWidthFont = Object.freeze({ fontFamily: "Calibri", fontSize: 11 / 0.75, bold: false, italic: false });

/** Resolve host measurements before parsing sheet or drawing coordinates. No DOM is required. */
export async function prepareColumnWidthMeasurement(options: SpreadsheetExcelImportOptions, context: ImportContext): Promise<void> {
  const font = context.columnWidthFont ?? DEFAULT_XLSX_COLUMN_WIDTH_FONT;
  const { signal, columnWidthMeasurement } = options;
  signal?.throwIfAborted();
  let measured: SpreadsheetExcelColumnWidthMetrics | undefined;
  if (columnWidthMeasurement) {
    let abort: (() => void) | undefined;
    try {
      const measurement = Promise.resolve().then(() => { signal?.throwIfAborted(); return columnWidthMeasurement(font); });
      const aborted = signal ? new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }) : undefined;
      measured = await (aborted ? Promise.race([measurement, aborted]) : measurement);
    } finally {
      if (abort) signal?.removeEventListener("abort", abort);
    }
  }
  signal?.throwIfAborted();
  if (measured !== undefined) {
    const width = measured?.maximumDigitWidth, ratio = measured?.pixelRatio;
    if (!Number.isFinite(width) || width <= 0 || width > 4096 || !Number.isFinite(ratio) || ratio < 0.25 || ratio > 8 || Math.round(width) < 1)
      throw new Error("Excelの列幅測定結果が不正です: maximumDigitWidthは0より大きく4096以下、pixelRatioは0.25〜8の有限値を指定してください");
    context.columnWidthMetrics = Object.freeze({ maximumDigitWidth: Math.round(width), pixelRatio: ratio });
    return;
  }
  context.columnWidthMetrics = DEFAULT_XLSX_COLUMN_WIDTH_METRICS;
  if (font.fontFamily.toLocaleLowerCase("en-US") !== "calibri" || font.fontSize !== DEFAULT_XLSX_COLUMN_WIDTH_FONT.fontSize || font.bold || font.italic)
    context.warn({ code: "adjusted", message: `標準フォント「${font.fontFamily}」の列幅を測定できないため、Calibri 11pt・96dpi相当の列幅へ近似しました` });
}
