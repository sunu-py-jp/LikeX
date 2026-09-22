import { serializeStableJson } from "../json";
import { AICHAT_LIMITS, choice, date, freeze, identifier, list, record, safeUrl, string } from "./validation";
import type { AIChatAttachment, AIChatInput, AIChatMessage, AIChatMessageInput, AIChatModel, AIChatReference, AIChatToolCall } from "./types";
const models = new WeakSet<AIChatModel>();
function unique<T extends { id: string }>(items: T[], label: string): T[] { if (new Set(items.map(item => item.id)).size !== items.length) throw new Error(`Duplicate ${label} IDs.`); return items; }
export function normalizeAIChatAttachment(input: unknown): AIChatAttachment {
  const raw = record(input, "Attachment", ["id", "name", "mediaType", "size", "url"]);
  if (!Number.isSafeInteger(raw.size) || Number(raw.size) < 0 || Number(raw.size) > 2 ** 40) throw new Error("Attachment size must be a nonnegative byte count.");
  return { id: identifier(raw.id), name: string(raw.name, "Attachment name", 1000, false), mediaType: string(raw.mediaType, "Media type", 200), size: raw.size as number, ...(raw.url !== undefined ? { url: safeUrl(raw.url) } : {}) };
}
function reference(input: unknown): AIChatReference {
  const raw = record(input, "Reference", ["id", "title", "url", "description"]);
  return { id: identifier(raw.id), title: string(raw.title, "Reference title", 1000, false), ...(raw.url !== undefined ? { url: safeUrl(raw.url) } : {}), ...(raw.description !== undefined ? { description: string(raw.description, "Reference description", 20_000) } : {}) };
}
function toolCall(input: unknown): AIChatToolCall {
  const raw = record(input, "Tool call", ["id", "name", "status", "detail"]);
  return { id: identifier(raw.id), name: string(raw.name, "Tool name", 1000, false), status: choice(raw.status, ["pending", "running", "complete", "error"], "Tool status"), ...(raw.detail !== undefined ? { detail: string(raw.detail, "Tool details", 100_000) } : {}) };
}
function message(input: unknown): AIChatMessage {
  const raw = record(input, "Message", ["id", "role", "content", "createdAt", "status", "replyTo", "error", "attachments", "references", "toolCalls"]);
  return { id: identifier(raw.id), role: choice(raw.role, ["user", "assistant", "system", "tool"], "Message role"),
    content: string(raw.content, "Message content", AICHAT_LIMITS.contentLength), createdAt: date(raw.createdAt),
    status: choice(raw.status, ["complete", "streaming", "error", "cancelled"], "Message status"),
    ...(raw.replyTo !== undefined ? { replyTo: identifier(raw.replyTo) } : {}), ...(raw.error !== undefined ? { error: string(raw.error, "Message error", 10_000) } : {}),
    ...(raw.attachments !== undefined ? { attachments: unique(list(raw.attachments, "Attachments", AICHAT_LIMITS.metadataItems).map(normalizeAIChatAttachment), "attachment") } : {}),
    ...(raw.references !== undefined ? { references: unique(list(raw.references, "References", AICHAT_LIMITS.metadataItems).map(reference), "reference") } : {}),
    ...(raw.toolCalls !== undefined ? { toolCalls: unique(list(raw.toolCalls, "Tool calls", AICHAT_LIMITS.metadataItems).map(toolCall), "tool") } : {}) };
}
export function createAIChatMessage(input: AIChatMessageInput): AIChatMessage {
  const raw = record(input, "Message input", ["id", "role", "content", "createdAt", "status", "replyTo", "error", "attachments", "references", "toolCalls"]);
  return freeze(message({ ...raw, id: raw.id ?? crypto.randomUUID(), createdAt: raw.createdAt ?? new Date().toISOString(), status: raw.status ?? "complete" }));
}
function normalizeAIChatFormat(input: unknown, format: "likex.aichat" | "likex.chat"): AIChatModel {
  const raw = record(input, "AIChat", ["format", "version", "id", "title", "conversations"]);
  if (raw.format !== format || raw.version !== 1) throw new Error("Unsupported LikeAIChat format or version.");
  let count = 0, characters = 0;
  const allIds = new Set<string>();
  const conversations = unique(list(raw.conversations, "Conversations", AICHAT_LIMITS.conversations).map(item => {
    const conversation = record(item, "Conversation", ["id", "title", "messages"]);
    const messages = list(conversation.messages, "Messages", AICHAT_LIMITS.messages).map(message);
    const previous = new Set<string>();
    for (const item of messages) {
      if (allIds.has(item.id)) throw new Error("Message IDs must be unique across the aichat."); allIds.add(item.id);
      if (item.replyTo && !previous.has(item.replyTo)) throw new Error("Replies must reference an earlier message in the same conversation.");
      previous.add(item.id); count++; characters += item.content.length;
      characters += (item.error?.length ?? 0) + (item.references ?? []).reduce((sum, ref) => sum + ref.title.length + (ref.description?.length ?? 0), 0)
        + (item.toolCalls ?? []).reduce((sum, tool) => sum + tool.name.length + (tool.detail?.length ?? 0), 0);
    }
    return { id: identifier(conversation.id), title: string(conversation.title, "Conversation title", 1000, false), messages };
  }), "conversation");
  if (!conversations.length) throw new Error("At least one conversation is required.");
  if (count > AICHAT_LIMITS.messages || characters > AICHAT_LIMITS.totalContentLength) throw new Error("AIChat messages exceed the total content limit.");
  const result = freeze<AIChatModel>({ format: "likex.aichat", version: 1, id: identifier(raw.id), title: string(raw.title, "AIChat title", 1000), conversations });
  models.add(result); return result;
}
/** Validate the current AI format; legacy files must use the explicit migration or parser. */
export function normalizeAIChat(input: unknown): AIChatModel {
  if (models.has(input as AIChatModel)) return input as AIChatModel;
  return normalizeAIChatFormat(input, "likex.aichat");
}
/** Validate an original AI LikeChat v1 document and convert it without changing IDs or order. */
export function migrateLegacyAIChat(input: unknown): AIChatModel {
  return normalizeAIChatFormat(input, "likex.chat");
}
export function createAIChat(input: AIChatInput = {}): AIChatModel {
  record(input, "AIChat input", ["id", "title", "conversations"]);
  return normalizeAIChat({ format: "likex.aichat", version: 1, id: input.id ?? crypto.randomUUID(), title: input.title ?? "AIチャット", conversations: input.conversations ?? [{ id: "conversation-1", title: "新しい会話", messages: [] }] });
}
export function parseAIChat(json: string): AIChatModel {
  if (typeof json !== "string" || json.length > AICHAT_LIMITS.jsonLength || new TextEncoder().encode(json).byteLength > AICHAT_LIMITS.jsonBytes) throw new Error("AIChat JSON exceeds its size limit.");
  const input: unknown = JSON.parse(json);
  const raw = record(input, "AIChat", ["format", "version", "id", "title", "conversations"]);
  return raw.format === "likex.chat" ? migrateLegacyAIChat(raw) : normalizeAIChat(raw);
}
export function serializeAIChat(aichat: AIChatModel): string {
  const json = serializeStableJson(normalizeAIChat(aichat), { space: 2, maxLength: AICHAT_LIMITS.jsonLength });
  if (new TextEncoder().encode(json).byteLength > AICHAT_LIMITS.jsonBytes) throw new Error("AIChat JSON exceeds its size limit.");
  return json;
}
export function getAIChatConversation(aichat: AIChatModel, conversationId: string) { return normalizeAIChat(aichat).conversations.find(item => item.id === conversationId); }
export function getAIChatConversations(aichat: AIChatModel) { return normalizeAIChat(aichat).conversations; }
export function getAIChatMessages(aichat: AIChatModel, conversationId: string) { const conversation = getAIChatConversation(aichat, conversationId); if (!conversation) throw new Error("Conversation not found."); return conversation.messages; }
export function getAIChatMessage(aichat: AIChatModel, conversationId: string, messageId: string) { return getAIChatMessages(aichat, conversationId).find(item => item.id === messageId); }
