import { serializeStableJson } from "../json";
import type { BoardCard, BoardCardInput, BoardCardFilter, BoardCardLocation, BoardColumn, BoardCommand, BoardCommandResult, BoardInput, BoardModel } from "./types";
export const BOARD_LIMITS = Object.freeze({ columns: 100, cards: 10_000, labels: 100, members: 1000, commands: 1000, jsonLength: 16 * 1024 * 1024 });
const models = new WeakSet<BoardModel>(), serialized = new WeakMap<BoardModel, string>();
function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label} must be an object.`);
  for (const key of Reflect.ownKeys(value)) if (typeof key !== "string" || !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")) throw new Error(`${label} has an unknown property.`);
  return value as Record<string, unknown>;
}
function str(value: unknown, label: string, limit = 500, empty = false): string { if (typeof value !== "string" || value.length > limit || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${label} is invalid.`); return value; }
function id(value: unknown): string { const result = str(value, "ID", 200); if (/\s/.test(result)) throw new Error("IDs cannot contain whitespace."); return result; }
function array(value: unknown, limit: number): unknown[] { if (!Array.isArray(value) || value.length > limit) throw new Error("The item count exceeds its limit."); return value; }
function color(value: unknown): string { if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Colors use #RRGGBB."); return value.toLowerCase(); }
function date(value: unknown): string | null { if (value == null || value === "") return null; if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("Due date must be a valid YYYY-MM-DD date."); return value; }
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export function normalizeBoard(input: unknown): BoardModel {
  if (models.has(input as BoardModel)) return input as BoardModel;
  const raw = object(input, ["format", "version", "id", "title", "columns", "labels", "members"], "Board");
  if (raw.format !== "likex.board" || raw.version !== 1) throw new Error("Unsupported LikeBoard file format.");
  const ids = new Set<string>(); const unique = (value: unknown) => { const key = id(value); if (ids.has(key)) throw new Error(`Duplicate resource ID: ${key}.`); ids.add(key); return key; };
  const labels = array(raw.labels, BOARD_LIMITS.labels).map(item => { const value = object(item, ["id", "name", "color"], "Label"); return { id: unique(value.id), name: str(value.name, "Label name", 100), color: color(value.color) }; });
  const members = array(raw.members, BOARD_LIMITS.members).map(item => { const value = object(item, ["id", "name"], "Member"); return { id: unique(value.id), name: str(value.name, "Member name", 100) }; });
  const labelIds = new Set(labels.map(label => label.id)), memberIds = new Set(members.map(member => member.id));
  let totalCards = 0;
  const references = (value: unknown, allowed: Set<string>) => { const result = array(value, allowed.size).map(id); if (new Set(result).size !== result.length || result.some(key => !allowed.has(key))) throw new Error("The card references an unknown or duplicate resource."); return result; };
  const columns: BoardColumn[] = array(raw.columns, BOARD_LIMITS.columns).map(item => {
    const value = object(item, ["id", "title", "color", "cards"], "Column");
    const cards: BoardCard[] = array(value.cards, BOARD_LIMITS.cards).map(child => { if (++totalCards > BOARD_LIMITS.cards) throw new Error("Too many cards."); const card = object(child, ["id", "title", "description", "labelIds", "assigneeIds", "dueDate"], "Card"); return { id: unique(card.id), title: str(card.title, "Card title"), description: str(card.description, "Card description", 50_000, true), labelIds: references(card.labelIds, labelIds), assigneeIds: references(card.assigneeIds, memberIds), dueDate: date(card.dueDate) }; });
    return { id: unique(value.id), title: str(value.title, "Column title", 200), color: color(value.color), cards };
  });
  const board = freeze<BoardModel>({ format: "likex.board", version: 1, id: id(raw.id), title: str(raw.title, "Board title"), columns, labels, members }); models.add(board); return board;
}
function cardInput(card: BoardCardInput): BoardCard { return { ...card, id: card.id ?? crypto.randomUUID(), description: card.description ?? "", labelIds: card.labelIds ?? [], assigneeIds: card.assigneeIds ?? [], dueDate: card.dueDate ?? null }; }
export function createBoard(input: BoardInput = {}): BoardModel {
  object(input, ["id", "title", "columns", "labels", "members"], "Board input");
  const columns = input.columns ?? [{ title: "未着手" }, { title: "進行中" }, { title: "完了" }];
  return normalizeBoard({ format: "likex.board", version: 1, id: input.id ?? crypto.randomUUID(), title: input.title ?? "新しいボード", labels: input.labels ?? [], members: input.members ?? [], columns: columns.map(column => ({ id: crypto.randomUUID(), color: "#64748b", ...column, cards: (column.cards ?? []).map(card => cardInput(card)) })) });
}
export function parseBoard(json: string): BoardModel { if (typeof json !== "string" || json.length > BOARD_LIMITS.jsonLength) throw new Error("The board file is too large."); return normalizeBoard(JSON.parse(json)); }
export function serializeBoard(input: BoardModel): string { const board = normalizeBoard(input); let json = serialized.get(board); if (!json) { json = serializeStableJson(board, { space: 2, maxLength: BOARD_LIMITS.jsonLength }) + "\n"; serialized.set(board, json); } return json; }
export function getColumn(board: BoardModel, columnId: string): BoardColumn | undefined { return normalizeBoard(board).columns.find(column => column.id === columnId); }
export function getCard(board: BoardModel, cardId: string): BoardCardLocation | undefined { for (const column of normalizeBoard(board).columns) { const index = column.cards.findIndex(card => card.id === cardId); if (index >= 0) return { card: column.cards[index], columnId: column.id, index }; } return undefined; }
export function getCards(board: BoardModel, filter: BoardCardFilter = {}): BoardCardLocation[] {
  const query = filter.query?.normalize("NFKC").toLocaleLowerCase() ?? "";
  return normalizeBoard(board).columns.flatMap(column => column.cards.map((card, index) => ({ card, columnId: column.id, index }))).filter(item => (!filter.columnId || item.columnId === filter.columnId) && (!filter.labelId || item.card.labelIds.includes(filter.labelId)) && (!filter.assigneeId || item.card.assigneeIds.includes(filter.assigneeId)) && (!query || `${item.card.title}\n${item.card.description}`.normalize("NFKC").toLocaleLowerCase().includes(query)));
}
const commandKeys: Record<BoardCommand["type"], string[]> = {
  "board.rename": ["type", "title"], "board.replace": ["type", "board"], "column.add": ["type", "column", "index"], "column.update": ["type", "columnId", "patch"], "column.move": ["type", "columnId", "index"], "column.delete": ["type", "columnId"], "card.add": ["type", "columnId", "card", "index"], "card.update": ["type", "cardId", "patch"], "card.move": ["type", "cardId", "columnId", "index"], "card.delete": ["type", "cardId"], "label.add": ["type", "label"], "label.update": ["type", "labelId", "patch"], "label.delete": ["type", "labelId"], "member.add": ["type", "member"], "member.update": ["type", "memberId", "name"], "member.delete": ["type", "memberId"],
};
function at(value: number | undefined, length: number) { if (value === undefined) return length; if (!Number.isSafeInteger(value) || value < 0 || value > length) throw new Error("Position is outside the destination."); return value; }
export function executeBoardCommands(input: BoardModel, command: BoardCommand | readonly BoardCommand[]): BoardCommandResult {
  const before = normalizeBoard(input), commands = Array.isArray(command) ? command : [command];
  if (commands.length > BOARD_LIMITS.commands) throw new Error("Too many commands.");
  let board = structuredClone(before); const createdIds: string[] = [];
  const column = (key: string) => { const value = board.columns.find(item => item.id === key); if (!value) throw new Error("Column not found."); return value; };
  const locate = (key: string) => { for (const col of board.columns) { const index = col.cards.findIndex(card => card.id === key); if (index >= 0) return { col, index, card: col.cards[index] }; } throw new Error("Card not found."); };
  for (const cmd of commands as readonly BoardCommand[]) {
    if (!cmd || !commandKeys[cmd.type]) throw new Error("Unsupported board command."); object(cmd, commandKeys[cmd.type], "Command");
    switch (cmd.type) {
      case "board.rename": board.title = cmd.title; break;
      case "board.replace": board = structuredClone(normalizeBoard(cmd.board)); break;
      case "column.add": { object(cmd.column, ["id", "title", "color", "cards"], "Column"); const value = { id: crypto.randomUUID(), color: "#64748b", ...cmd.column, cards: (cmd.column.cards ?? []).map(card => cardInput(card)) } as BoardColumn; board.columns.splice(at(cmd.index, board.columns.length), 0, value); createdIds.push(value.id); break; }
      case "column.update": object(cmd.patch, ["title", "color"], "Column patch"); Object.assign(column(cmd.columnId), cmd.patch); break;
      case "column.move": { const value = column(cmd.columnId); board.columns.splice(board.columns.indexOf(value), 1); board.columns.splice(at(cmd.index, board.columns.length), 0, value); break; }
      case "column.delete": board.columns.splice(board.columns.indexOf(column(cmd.columnId)), 1); break;
      case "card.add": { object(cmd.card, ["id", "title", "description", "labelIds", "assigneeIds", "dueDate"], "Card"); const value = cardInput(cmd.card) as BoardCard, col = column(cmd.columnId); col.cards.splice(at(cmd.index, col.cards.length), 0, value); createdIds.push(value.id); break; }
      case "card.update": object(cmd.patch, ["title", "description", "labelIds", "assigneeIds", "dueDate"], "Card patch"); Object.assign(locate(cmd.cardId).card, cmd.patch); break;
      case "card.move": { const source = locate(cmd.cardId), target = column(cmd.columnId); source.col.cards.splice(source.index, 1); target.cards.splice(at(cmd.index, target.cards.length), 0, source.card); break; }
      case "card.delete": { const source = locate(cmd.cardId); source.col.cards.splice(source.index, 1); break; }
      case "label.add": { object(cmd.label, ["id", "name", "color"], "Label"); const value = { id: crypto.randomUUID(), ...cmd.label }; board.labels.push(value); createdIds.push(value.id); break; }
      case "label.update": { object(cmd.patch, ["name", "color"], "Label patch"); const value = board.labels.find(item => item.id === cmd.labelId); if (!value) throw new Error("Label not found."); Object.assign(value, cmd.patch); break; }
      case "label.delete": { const index = board.labels.findIndex(item => item.id === cmd.labelId); if (index < 0) throw new Error("Label not found."); board.labels.splice(index, 1); board.columns.forEach(col => col.cards.forEach(card => { card.labelIds = card.labelIds.filter(key => key !== cmd.labelId); })); break; }
      case "member.add": { object(cmd.member, ["id", "name"], "Member"); const value = { id: crypto.randomUUID(), ...cmd.member }; board.members.push(value); createdIds.push(value.id); break; }
      case "member.update": { const value = board.members.find(item => item.id === cmd.memberId); if (!value) throw new Error("Member not found."); value.name = cmd.name; break; }
      case "member.delete": { const index = board.members.findIndex(item => item.id === cmd.memberId); if (index < 0) throw new Error("Member not found."); board.members.splice(index, 1); board.columns.forEach(col => col.cards.forEach(card => { card.assigneeIds = card.assigneeIds.filter(key => key !== cmd.memberId); })); break; }
    }
    board = structuredClone(normalizeBoard(board));
  }
  const result = normalizeBoard(board), changed = serializeBoard(before) !== serializeBoard(result);
  return { board: changed ? result : before, changed, createdIds };
}
