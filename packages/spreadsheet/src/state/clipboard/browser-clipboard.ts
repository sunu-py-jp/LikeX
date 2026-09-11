import { parseTsv } from "../../model/tsv";

export const CLIPBOARD_MIME_TYPE = "application/x-likex-spreadsheet";
export const clipboardTokenFromHtml = (html: string) => /data-likex-spreadsheet="([a-zA-Z0-9-]+)"/.exec(html)?.[1] ?? "";
/** Browser clipboards can normalize CRLF to LF without changing the copied content. */
export const clipboardTextMatches = (copied: string, pasted: string) => copied === pasted || copied.replaceAll("\r\n", "\n") === pasted.replaceAll("\r\n", "\n");
type BrowserClipboardValue = { text: string; token: string; kind?: "cells" | "drawing" };

export function isOtherTextControl(target: EventTarget | null) {
  const control = (target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
  return !!control && !control.classList.contains("lxs-cell-input");
}

/** Keep native events and the asynchronous browser API on the same transferable HTML format. */
export function spreadsheetClipboardHtml(value: BrowserClipboardValue): string {
  const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  // Drawing labels are arbitrary text, not a serialized cell matrix. Do not
  // apply TSV quoting or row/column limits to their quotes, tabs or newlines.
  if (value.kind === "drawing") return `<pre data-likex-spreadsheet="${escape(value.token)}">${escape(value.text)}</pre>`;
  const rows = parseTsv(value.text).map(row => `<tr>${row.map(text => `<td>${escape(text)}</td>`).join("")}</tr>`).join("");
  return `<table data-likex-spreadsheet="${escape(value.token)}"><tbody>${rows}</tbody></table>`;
}

/** Returns whether the browser retained the token needed for internal copy/cut semantics. */
export async function writeBrowserClipboard(value: BrowserClipboardValue): Promise<boolean> {
  if (!navigator.clipboard?.writeText) throw new Error("このブラウザではコピーのショートカットを使用してください");
  if (navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([value.text], { type: "text/plain" }), "text/html": new Blob([spreadsheetClipboardHtml(value)], { type: "text/html" }) })]);
    return true;
  }
  await navigator.clipboard.writeText(value.text);
  return false;
}

export async function readBrowserClipboard() {
  if (!navigator.clipboard?.readText) throw new Error("このブラウザでは貼り付けのショートカットを使用してください");
  let text = "", token = "", hasText = false;
  if (navigator.clipboard.read) {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes("text/plain")) { text = await (await item.getType("text/plain")).text(); hasText = true; }
      if (item.types.includes("text/html")) token = clipboardTokenFromHtml(await (await item.getType("text/html")).text());
    }
  } else { text = await navigator.clipboard.readText(); hasText = true; }
  return { text, token, hasText };
}
