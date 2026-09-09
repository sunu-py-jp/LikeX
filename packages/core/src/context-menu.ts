import type { MaybePromise, OperationContext } from "./contracts";

/** Controls concurrent local changes while a host prepares a context-menu result. */
export type ContextMenuExecutionMode = "block" | "confirm" | "reject-if-changed";

/** A proposed change. Only the owning component may validate and apply it. */
export type ContextMenuResult<TChange> = Readonly<{
  change: TChange;
  description?: string;
}>;

export type ContextMenuItem<TContext, TChange, TIcon = never> = Readonly<{
  id: string;
  label: string;
  icon?: TIcon;
  disabled?: boolean;
  /** Prepare a change, or return nothing for an external action with no local write. */
  onSelect: (context: TContext, operation: OperationContext) => MaybePromise<ContextMenuResult<TChange> | void>;
}>;

/** Runs synchronously when a menu is opened; return [] when no items apply. */
export type ContextMenuProvider<TContext, TChange, TIcon = never> = (
  context: TContext,
) => readonly ContextMenuItem<TContext, TChange, TIcon>[];

export type ContextMenuExecutionState = Readonly<{
  phase: "idle" | "preparing" | "confirming" | "applying";
  mode: ContextMenuExecutionMode;
  requestId: string | null;
  itemId: string | null;
  label: string;
  description: string;
  error: string | null;
  blocksChanges: boolean;
}>;

export type ContextMenuExecutionEvent = Readonly<{
  type: "context-menu";
  status: "start" | "confirmation-required" | "success" | "cancelled" | "error";
  requestId: string;
  itemId: string;
  label: string;
  message?: string;
}>;

export type ContextMenuExecutionOutcome = "success" | "cancelled" | "confirmation-required" | "failed" | "busy";

/** Isolate the visible definition so later host mutations cannot replace an open menu's action. */
export function resolveContextMenuItems<TContext, TChange, TIcon = never>(
  provider: ContextMenuProvider<TContext, TChange, TIcon> | undefined,
  context: TContext,
): readonly ContextMenuItem<TContext, TChange, TIcon>[] {
  if (!provider) return [];
  const items = provider(context);
  if (!Array.isArray(items)) throw new Error("メニューの項目を配列で返してください");
  const ids = new Set<string>();
  return Object.freeze(items.map(item => {
    if (!item || typeof item.id !== "string" || !item.id.trim() || ids.has(item.id) ||
      typeof item.label !== "string" || !item.label.trim() || typeof item.onSelect !== "function" ||
      (item.disabled !== undefined && typeof item.disabled !== "boolean")) {
      throw new Error("メニューのID・表示名・処理を正しく指定してください。IDは重複できません");
    }
    ids.add(item.id);
    return Object.freeze({ ...item });
  }));
}
