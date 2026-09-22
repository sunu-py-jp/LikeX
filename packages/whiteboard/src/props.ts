import type { CSSProperties, Ref } from "react";
import type { ModelEditorOptions } from "./core";
import type { WhiteboardCommand, WhiteboardModel } from "./model/types";
export type WhiteboardFeature = "elements" | "images" | "move" | "resize" | "formatting" | "import" | "export" | "history";
export type WhiteboardFeatures = Partial<Record<WhiteboardFeature, boolean>>;
export type WhiteboardHandle = { getModel(): WhiteboardModel; execute(commands: WhiteboardCommand | readonly WhiteboardCommand[]): Promise<WhiteboardModel | null>; select(ids: readonly string[]): void; getSelection(): readonly string[]; undo(): Promise<boolean>; redo(): Promise<boolean>; save(): Promise<boolean>; discard(): void; importJson(input: string | Blob): Promise<WhiteboardModel | null>; exportJson(): string; exportSvg(): string };
export type WhiteboardProps = ModelEditorOptions<WhiteboardModel, WhiteboardFeature> & { ref?: Ref<WhiteboardHandle>; initialWhiteboard?: WhiteboardModel; title?: string; primaryColor?: string; colorMode?: "light" | "dark" | "system"; warnOnUnsavedChanges?: boolean; onSelectionChange?: (ids: readonly string[]) => void; className?: string; style?: CSSProperties; "aria-label"?: string };
