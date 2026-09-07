/** Shared locale rules for names, sorting and dates. */
export const nameKey = (name: string) => name.normalize("NFC").toLocaleLowerCase("ja-JP");
/** Last extension without a dot; a lone dotfile name has no extension. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).normalize("NFC").toLowerCase() : "";
}
export const naturalNameOrder = new Intl.Collator("ja", { numeric: true });
export const folderNameOrder = new Intl.Collator("ja");
export const entryDateFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
});
