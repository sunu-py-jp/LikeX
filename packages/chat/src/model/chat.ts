import { serializeStableJson } from "../json";
import { CHAT_LIMITS, choice, date, freeze, identifier, list, record, safeUrl, string } from "./validation";
import type { ChatAttachment, ChatInput, ChatMessage, ChatMessageInput, ChatModel, ChatParticipant, ChatReaction } from "./types";
const models = new WeakSet<ChatModel>();
function unique<T extends { id: string }>(items: T[], label: string): T[] { if (new Set(items.map(item => item.id)).size !== items.length) throw new Error(`Duplicate ${label} IDs.`); return items; }
function ids(input: unknown, label: string): string[] {
  const result = list(input, label, CHAT_LIMITS.members).map(identifier);
  if (new Set(result).size !== result.length) throw new Error(`Duplicate ${label}.`);
  return result;
}
export function normalizeChatAttachment(input: unknown): ChatAttachment {
  const raw = record(input, "Attachment", ["id", "name", "mediaType", "size", "url"]);
  if (!Number.isSafeInteger(raw.size) || Number(raw.size) < 0 || Number(raw.size) > 2 ** 40) throw new Error("Attachment size must be a nonnegative byte count.");
  return { id: identifier(raw.id), name: string(raw.name, "Attachment name", 1000, false), mediaType: string(raw.mediaType, "Media type", 200), size: raw.size as number, ...(raw.url !== undefined ? { url: safeUrl(raw.url) } : {}) };
}
function participant(input: unknown): ChatParticipant {
  const raw = record(input, "Participant", ["id", "name", "avatarUrl", "status"]);
  return { id: identifier(raw.id), name: string(raw.name, "Participant name", 1000, false), ...(raw.avatarUrl !== undefined ? { avatarUrl: safeUrl(raw.avatarUrl) } : {}), ...(raw.status !== undefined ? { status: choice(raw.status, ["online", "away", "offline"] as const, "Participant status") } : {}) };
}
function reaction(input: unknown): ChatReaction {
  const raw = record(input, "Reaction", ["emoji", "participantIds"]);
  const participantIds = ids(raw.participantIds, "Reaction participants");
  if (!participantIds.length) throw new Error("A reaction requires a participant.");
  return { emoji: string(raw.emoji, "Reaction emoji", 64, false), participantIds };
}
function message(input: unknown): ChatMessage {
  const raw = record(input, "Message", ["id", "authorId", "text", "createdAt", "editedAt", "replyTo", "attachments", "reactions"]);
  const attachments = raw.attachments === undefined ? undefined : unique(list(raw.attachments, "Attachments", CHAT_LIMITS.metadataItems).map(normalizeChatAttachment), "attachment");
  const reactions = raw.reactions === undefined ? undefined : list(raw.reactions, "Reactions", CHAT_LIMITS.metadataItems).map(reaction);
  if (reactions && new Set(reactions.map(item => item.emoji)).size !== reactions.length) throw new Error("Duplicate reaction emoji.");
  const text = string(raw.text, "Message text", CHAT_LIMITS.contentLength);
  if (!text.trim() && !attachments?.length) throw new Error("A message requires text or an attachment.");
  const createdAt = date(raw.createdAt), editedAt = raw.editedAt === undefined ? undefined : date(raw.editedAt);
  if (editedAt && editedAt < createdAt) throw new Error("Edit timestamp cannot precede creation.");
  return { id: identifier(raw.id), authorId: identifier(raw.authorId), text, createdAt,
    ...(editedAt !== undefined ? { editedAt } : {}), ...(raw.replyTo !== undefined ? { replyTo: identifier(raw.replyTo) } : {}),
    ...(attachments !== undefined ? { attachments } : {}), ...(reactions !== undefined ? { reactions } : {}) };
}
export function createChatMessage(input: ChatMessageInput): ChatMessage {
  const raw = record(input, "Message input", ["id", "authorId", "text", "createdAt", "editedAt", "replyTo", "attachments", "reactions"]);
  return freeze(message({ ...raw, id: raw.id ?? crypto.randomUUID(), createdAt: raw.createdAt ?? new Date().toISOString() }));
}
export function normalizeChat(input: unknown): ChatModel {
  if (models.has(input as ChatModel)) return input as ChatModel;
  const raw = record(input, "Chat");
  if (raw.format === "likex.chat" && raw.version === 1) throw new Error("Legacy LikeChat v1 is an AI conversation. Use @likex/aichat parseAIChat to migrate it; it cannot be imported as human team messaging.");
  if (raw.format !== "likex.chat" || raw.version !== 2) throw new Error("Unsupported LikeChat format or version; human messaging requires likex.chat version 2.");
  record(raw, "Chat", ["format", "version", "id", "title", "participants", "conversations"]);
  const participants = unique(list(raw.participants, "Participants", CHAT_LIMITS.participants).map(participant), "participant");
  if (!participants.length) throw new Error("At least one participant is required.");
  const participantIds = new Set(participants.map(item => item.id));
  let count = 0, characters = 0;
  const allIds = new Set<string>();
  const conversations = unique(list(raw.conversations, "Conversations", CHAT_LIMITS.conversations).map(value => {
    const rawConversation = record(value, "Conversation", ["id", "kind", "title", "memberIds", "messages", "readMarkers"]);
    const kind = choice(rawConversation.kind, ["direct", "group", "space"], "Conversation kind"), memberIds = ids(rawConversation.memberIds, "Conversation members");
    if (memberIds.some(id => !participantIds.has(id))) throw new Error("Conversation member not found.");
    if (!memberIds.length || kind === "direct" && memberIds.length !== 2 || kind === "group" && memberIds.length < 2) throw new Error("Direct conversations require two members; groups require at least two; spaces require at least one.");
    const messages = list(rawConversation.messages, "Messages", CHAT_LIMITS.messages).map(message);
    const previous = new Map<string, ChatMessage>();
    for (const item of messages) {
      if (allIds.has(item.id)) throw new Error("Message IDs must be unique across the chat."); allIds.add(item.id);
      if (!participantIds.has(item.authorId)) throw new Error("Message author not found.");
      if (item.replyTo && (!previous.has(item.replyTo) || previous.get(item.replyTo)!.replyTo)) throw new Error("Replies must reference an earlier top-level message in the same conversation.");
      if (item.reactions?.some(reaction => reaction.participantIds.some(id => !participantIds.has(id)))) throw new Error("Reaction participant not found.");
      previous.set(item.id, item); count++; characters += item.text.length;
      characters += (item.attachments ?? []).reduce((sum, attachment) => sum + attachment.name.length + (attachment.url?.length ?? 0), 0);
    }
    const readMarkers = rawConversation.readMarkers === undefined ? undefined : list(rawConversation.readMarkers, "Read markers", CHAT_LIMITS.members).map(value => {
      const marker = record(value, "Read marker", ["participantId", "messageId"]);
      const participantId = identifier(marker.participantId), messageId = identifier(marker.messageId);
      if (!memberIds.includes(participantId) || !previous.has(messageId)) throw new Error("Read marker references a missing member or message.");
      return { participantId, messageId };
    });
    if (readMarkers && new Set(readMarkers.map(item => item.participantId)).size !== readMarkers.length) throw new Error("Duplicate read marker participant.");
    return { id: identifier(rawConversation.id), kind, title: string(rawConversation.title, "Conversation title", 1000, false), memberIds, messages, ...(readMarkers !== undefined ? { readMarkers } : {}) };
  }), "conversation");
  if (count > CHAT_LIMITS.messages || characters > CHAT_LIMITS.totalContentLength) throw new Error("Chat messages exceed the total content limit.");
  const result = freeze<ChatModel>({ format: "likex.chat", version: 2, id: identifier(raw.id), title: string(raw.title, "Chat title", 1000), participants, conversations });
  models.add(result); return result;
}
export function createChat(input: ChatInput = {}): ChatModel {
  record(input, "Chat input", ["id", "title", "participants", "conversations"]);
  const participants = input.participants ?? [{ id: "me", name: "あなた" }];
  return normalizeChat({ format: "likex.chat", version: 2, id: input.id ?? crypto.randomUUID(), title: input.title ?? "チャット", participants,
    conversations: input.conversations ?? [{ id: "conversation-1", kind: "space", title: "全般", memberIds: participants.map(item => item.id), messages: [] }] });
}
export function parseChat(json: string): ChatModel {
  if (typeof json !== "string" || json.length > CHAT_LIMITS.jsonLength || new TextEncoder().encode(json).byteLength > CHAT_LIMITS.jsonBytes) throw new Error("Chat JSON exceeds its size limit.");
  return normalizeChat(JSON.parse(json));
}
export function serializeChat(chat: ChatModel): string {
  const json = serializeStableJson(normalizeChat(chat), { space: 2, maxLength: CHAT_LIMITS.jsonLength });
  if (new TextEncoder().encode(json).byteLength > CHAT_LIMITS.jsonBytes) throw new Error("Chat JSON exceeds its size limit.");
  return json;
}
export function getConversation(chat: ChatModel, conversationId: string) { return normalizeChat(chat).conversations.find(item => item.id === conversationId); }
export function getConversations(chat: ChatModel) { return normalizeChat(chat).conversations; }
export function getMessages(chat: ChatModel, conversationId: string) { const conversation = getConversation(chat, conversationId); if (!conversation) throw new Error("Conversation not found."); return conversation.messages; }
export function getMessage(chat: ChatModel, conversationId: string, messageId: string) { return getMessages(chat, conversationId).find(item => item.id === messageId); }
export function getParticipants(chat: ChatModel) { return normalizeChat(chat).participants; }
export function getParticipant(chat: ChatModel, participantId: string) { return getParticipants(chat).find(item => item.id === participantId); }
export function getThreadMessages(chat: ChatModel, conversationId: string, rootId: string) { return getMessages(chat, conversationId).filter(item => item.replyTo === rootId); }
export function getUnreadCount(chat: ChatModel, conversationId: string, participantId: string) {
  const conversation = getConversation(chat, conversationId); if (!conversation || !conversation.memberIds.includes(participantId)) return 0;
  const marker = conversation.readMarkers?.find(item => item.participantId === participantId);
  const index = marker ? conversation.messages.findIndex(item => item.id === marker.messageId) : -1;
  return conversation.messages.slice(index + 1).filter(item => item.authorId !== participantId).length;
}
