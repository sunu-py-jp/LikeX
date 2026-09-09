import { notifyHost } from "../core";

/** The component name remains local; failure isolation is shared across LikeX. */
export function notifySpreadsheetHost<T>(callback: ((value: T) => void) | undefined, value: T) {
  notifyHost(callback, value);
}
