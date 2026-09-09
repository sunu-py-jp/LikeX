/** A generated file is independent from persistence; browsers own the final disk write. */
export function excelDownloadName(value: string): string {
  const base = value.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_").replace(/\.xlsx$/i, "").trim().replace(/[. ]+$/, "").slice(0, 160);
  return `${base || "spreadsheet"}.xlsx`;
}

export function downloadXlsx(blob: Blob, name: string, ownerDocument: Document): void {
  const view = ownerDocument.defaultView;
  if (!view) throw new Error("ダウンロード先のウィンドウを確認できませんでした");
  const url = URL.createObjectURL(blob), anchor = ownerDocument.createElement("a");
  try {
    anchor.href = url; anchor.download = excelDownloadName(name); anchor.hidden = true;
    ownerDocument.body.append(anchor); anchor.click();
  } finally {
    anchor.remove();
    // Do not revoke before the browser has consumed the click's download URL.
    view.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
