import type { CSSProperties, Ref } from "react";
import type { ModelEditorOptions } from "./core";
import type { BoardCardLocation, BoardCommand, BoardModel } from "./model";
export type { BoardFeature } from "./model/types";
import type { BoardFeature } from "./model/types";
export type BoardHandle = { getBoard(): BoardModel; execute(command: BoardCommand | readonly BoardCommand[]): Promise<BoardModel | null>; undo(): Promise<boolean>; redo(): Promise<boolean>; save(): Promise<boolean>; discard(): void; importNative(input: string | Blob): Promise<BoardModel | null>; exportNative(): Blob };
export type BoardProps = ModelEditorOptions<BoardModel, BoardFeature> & { ref?: Ref<BoardHandle>; initialBoard?: BoardModel; title?: string; primaryColor?: string; colorMode?: "light" | "dark" | "system"; onCardOpen?: (context: BoardCardLocation & { board: BoardModel }) => void; className?: string; style?: CSSProperties; "aria-label"?: string };
