/** Notification failures belong to the host and must not roll back an accepted local edit. */
export function notifySpreadsheetHost<T>(callback: ((value: T) => void) | undefined, value: T) {
  const failed = (cause: unknown) => console.error("[LikeX Spreadsheet] Notification callback failed", cause);
  try { void Promise.resolve(callback?.(value)).catch(failed); } catch (cause) { failed(cause); }
}
