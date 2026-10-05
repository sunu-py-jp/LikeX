import type { ReactNode, Ref } from "react";
import type { ExplorerProps } from "./props";
import type { ExplorerNavigationHandle } from "./model/navigation";
import type { ExplorerPickerItem, ExplorerPickerKind } from "./model/picker";

export type ExplorerPickerConfirmContext = Readonly<{ signal: AbortSignal }>;
export type ExplorerPickerHandle = Pick<ExplorerNavigationHandle,
  "navigate" | "selectFiles" | "selectEntries" | "openContainingFolder"> & Readonly<{
  confirm(): Promise<boolean>;
  selectCurrentFolder(): Promise<boolean>;
  cancel(): void;
}>;

/** A read-only picker over the host's virtual file hierarchy. */
export type ExplorerPickerProps = Omit<ExplorerProps,
  "ref" | "onSave" | "onEditRequest" | "readOnly" | "selection" |
  "selectedFileMode" | "warnOnUnsavedChanges" | "getContextMenuItems" |
  "contextMenuExecutionMode" | "onDownloadRequest" | "onPreviewRequest"> & {
  ref?: Ref<ExplorerPickerHandle>;
  kind?: ExplorerPickerKind;
  multiple?: boolean;
  /** Initial cached targets. Unknown IDs fail without a partial selection. Read once on mount. */
  initialSelectedIds?: readonly string[];
  /** Observes the effective selection, including its initial state; does not confirm it. */
  onSelectionChange?: (items: readonly ExplorerPickerItem[]) => void;
  /** A rejected promise leaves the picker open. Respect signal for host-owned asynchronous work. */
  onConfirm: (items: readonly ExplorerPickerItem[], context: ExplorerPickerConfirmContext) => void | Promise<void>;
  onCancel?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional content below the selection controls. Strings are plain text; nodes may include interactive UI. */
  footerMessage?: ReactNode;
};

export type ExplorerPickerDialogProps = ExplorerPickerProps & {
  open: boolean;
  onOpenChange(open: boolean): void;
  dialogTitle?: string;
  dialogDescription?: string;
};
