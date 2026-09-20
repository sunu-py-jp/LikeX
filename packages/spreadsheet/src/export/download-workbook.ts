/** A generated file is independent from persistence; browsers own the final disk write. */
export function workbookDownloadName(value: string, format: "xlsx" | "spon"): string {
  const base = value.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_").replace(/\.(xlsx|spon|json)$/i, "").trim().replace(/[. ]+$/, "").slice(0, 160);
  return `${base || "spreadsheet"}.${format}`;
}

export function downloadWorkbook(blob: Blob, name: string, format: "xlsx" | "spon", ownerDocument: Document): void {
  const view = ownerDocument.defaultView;
  if (!view) throw new Error("ダウンロード先のウィンドウを確認できませんでした");
  const url = URL.createObjectURL(blob), anchor = ownerDocument.createElement("a");
  try {
    anchor.href = url; anchor.download = workbookDownloadName(name, format); anchor.hidden = true;
    ownerDocument.body.append(anchor); anchor.click();
  } finally {
    anchor.remove();
    // Do not revoke before the browser has consumed the click's download URL.
    view.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
