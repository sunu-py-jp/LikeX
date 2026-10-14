import { useEffect, useState } from "react";
import { ExplorerPreviewError } from "@likex/explorer";
import Spreadsheet, { importSpreadsheetXlsx, type SpreadsheetWorkbook } from "@likex/spreadsheet";
import "../../../../packages/spreadsheet/src/styles.css";

/** The host owns file loading and keeps the original exception for diagnostics. */
export function ExcelPreviewExample({ file, name }: { file: Blob; name: string }) {
  const [result, setResult] = useState<{ file: Blob; workbook?: SpreadsheetWorkbook; error?: unknown }>();
  useEffect(() => {
    const abort = new AbortController();
    void importSpreadsheetXlsx(file, { signal: abort.signal }).then(({ workbook }) => {
      if (!abort.signal.aborted) setResult({ file, workbook });
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) setResult({ file, error });
    });
    return () => abort.abort();
  }, [file]);
  const current = result?.file === file ? result : undefined;
  if (current?.workbook) return <Spreadsheet key={name} title={name} initialWorkbook={current.workbook}
    readOnly ribbonDisplayMode="hidden" style={{ height: "60dvh" }} />;
  return <section aria-label={`${name}のプレビュー`} style={{ minHeight: 280 }}>
    <header style={{ padding: "12px 16px", color: "white", background: "#326746", fontWeight: 600 }}>{name}</header>
    <div style={{ padding: "80px 20px", textAlign: "center" }}>
      {current ? <ExplorerPreviewError error={current.error}
        message="このExcelファイルはスプレッドシートで表示できません。ダウンロードして確認してください。" />
        : <p role="status">Excelを読み込んでいます…</p>}
    </div>
  </section>;
}
