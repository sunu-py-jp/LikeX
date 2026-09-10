import type { ExplorerNotification } from "./notifications";
import type { ExplorerUploadRejection } from "./upload";

/** Presentation only: preserve full validation messages for Error and host events. */
export function describeUploadRejections(
  rejections: readonly ExplorerUploadRejection[],
): Pick<ExplorerNotification, "details" | "hint"> {
  const allowedExtensions = new Set<string>();
  let hasExtensionError = false;
  const details = rejections.map(rejection => ({
    message: rejection.relativePath,
    kind: "error" as const,
    description: rejection.reasons.map(reason => {
      if (reason.code !== "extension-not-allowed") return reason.message;
      hasExtensionError = true;
      reason.allowedExtensions.forEach(extension => allowedExtensions.add(extension));
      return "許可されていない拡張子です";
    }).join("\n"),
  }));
  const hint = hasExtensionError
    ? allowedExtensions.size
      ? `許可されている拡張子: ${[...allowedExtensions].join("、 ")}`
      : "許可されている拡張子はありません"
    : undefined;
  return { details, hint };
}
