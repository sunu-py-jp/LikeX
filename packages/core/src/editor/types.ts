import type { MaybePromise, OperationContext, SaveHandler } from "../contracts";

export type ModelEditorNotice = Readonly<{ kind: "error" | "success" | "info"; text: string }>;
export type ModelEditorEvent<M> =
  | { type: "change"; source: "command" | "import" | "undo" | "redo" | "save" | "discard"; model: M }
  | { type: "save"; phase: "start" | "success" | "cancelled" | "error"; error?: string }
  | { type: "edit-mode"; mode: "view" | "requesting" | "edit" };
export type ModelEditorOptions<M, F extends string = string> = {
  onSave?: SaveHandler<M>;
  onBeforeSave?: (model: M) => MaybePromise<boolean | void>;
  onEditRequest?: (request: { model: M }, context: OperationContext) => MaybePromise<boolean>;
  onChange?: (model: M) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onEvent?: (event: ModelEditorEvent<M>) => MaybePromise<void>;
  readOnly?: boolean;
  features?: Partial<Record<F, boolean>>;
};
export type ModelEditorAdapter<M, C, F extends string = string> = {
  normalize(input: unknown): M;
  serialize(model: M): string;
  execute(model: M, commands: readonly C[]): M;
  features: readonly F[];
  /** Every feature required by this command. Return all applicable keys for compound operations. */
  getCommandFeatures(command: C): readonly F[];
};
export type ModelEditorSnapshot<M, F extends string = string> = Readonly<{
  model: M; dirty: boolean; canUndo: boolean; canRedo: boolean;
  readOnly: boolean; editable: boolean; features: Readonly<Record<F, boolean>>;
  busy: "permission" | "save" | "prepare" | "task" | null;
  editMode: "view" | "requesting" | "edit"; notice: ModelEditorNotice | null;
}>;
export type ModelEditorExecuteOptions = { historyGroup?: string; source?: "command" | "import" };
export type ModelEditorTaskContext<M, C> = OperationContext & {
  /** Snapshot at the start of the task. apply always uses the latest task-owned model. */
  model: M;
  apply(commands: C | readonly C[], options?: ModelEditorExecuteOptions): M | null;
};
