export type BoardLabel = { id: string; name: string; color: string };
export type BoardMember = { id: string; name: string };
export type BoardCard = { id: string; title: string; description: string; labelIds: string[]; assigneeIds: string[]; dueDate: string | null };
export type BoardColumn = { id: string; title: string; color: string; cards: BoardCard[] };
export type BoardModel = { format: "likex.board"; version: 1; id: string; title: string; columns: BoardColumn[]; labels: BoardLabel[]; members: BoardMember[] };
export type BoardCardInput = Partial<BoardCard> & Pick<BoardCard, "title">;
export type BoardColumnInput = Partial<Omit<BoardColumn, "cards">> & Pick<BoardColumn, "title"> & { cards?: BoardCardInput[] };
export type BoardInput = Partial<Omit<BoardModel, "format" | "version" | "columns">> & { columns?: BoardColumnInput[] };
export type BoardCommand =
  | { type: "board.rename"; title: string }
  | { type: "board.replace"; board: BoardModel }
  | { type: "column.add"; column: BoardColumnInput; index?: number }
  | { type: "column.update"; columnId: string; patch: Partial<Pick<BoardColumn, "title" | "color">> }
  | { type: "column.move"; columnId: string; index: number }
  | { type: "column.delete"; columnId: string }
  | { type: "card.add"; columnId: string; card: BoardCardInput; index?: number }
  | { type: "card.update"; cardId: string; patch: Partial<Omit<BoardCard, "id">> }
  | { type: "card.move"; cardId: string; columnId: string; index?: number }
  | { type: "card.delete"; cardId: string }
  | { type: "label.add"; label: Omit<BoardLabel, "id"> & { id?: string } }
  | { type: "label.update"; labelId: string; patch: Partial<Omit<BoardLabel, "id">> }
  | { type: "label.delete"; labelId: string }
  | { type: "member.add"; member: Omit<BoardMember, "id"> & { id?: string } }
  | { type: "member.update"; memberId: string; name: string }
  | { type: "member.delete"; memberId: string };
export type BoardCommandResult = { board: BoardModel; changed: boolean; createdIds: string[] };
export type BoardCardLocation = { card: BoardCard; columnId: string; index: number };
export type BoardCardFilter = { query?: string; labelId?: string; assigneeId?: string; columnId?: string };

export type BoardFeature = "rename" | "columns" | "cards" | "move" | "labels" | "members" | "import" | "export" | "history";
