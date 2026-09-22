import { createChatMessage, normalizeChat, serializeChat } from "./chat";
import { CHAT_LIMITS, choice, identifier, list, record, string } from "./validation";
import type { ChatCommand, ChatCommandResult, ChatModel } from "./types";
const commandKeys: Record<ChatCommand["type"], readonly string[]> = {
  "chat.update": ["type", "title"], "chat.replace": ["type", "chat"],
  "participant.add": ["type", "participant"], "participant.update": ["type", "participantId", "patch"],
  "conversation.add": ["type", "id", "kind", "title", "memberIds"], "conversation.update": ["type", "conversationId", "title", "memberIds"], "conversation.delete": ["type", "conversationId"],
  "conversation.read": ["type", "conversationId", "participantId", "messageId"],
  "message.add": ["type", "conversationId", "message"], "message.update": ["type", "conversationId", "messageId", "patch"], "message.delete": ["type", "conversationId", "messageId", "cascadeReplies"],
  "reaction.toggle": ["type", "conversationId", "messageId", "participantId", "emoji"],
};
/** Atomic, immutable commands. Host authorization is deliberately outside this pure model API. */
export function executeChatCommands(input: ChatModel, commands: ChatCommand | readonly ChatCommand[]): ChatCommandResult {
  const original = normalizeChat(input), batch = Array.isArray(commands) ? list(commands, "Commands", CHAT_LIMITS.commands) : [commands];
  let chat = original;
  const results: ChatCommandResult["results"] = [];
  for (const value of batch) {
    const raw = record(value, "Chat command");
    const type = choice(raw.type, Object.keys(commandKeys) as ChatCommand["type"][], "Command");
    record(raw, "Chat command", commandKeys[type]);
    const command = raw as ChatCommand;
    if (command.type === "chat.replace") { chat = normalizeChat(command.chat); results.push({ type }); continue; }
    if (command.type === "chat.update") { chat = normalizeChat({ ...chat, title: command.title }); results.push({ type }); continue; }
    if (command.type === "participant.add") {
      chat = normalizeChat({ ...chat, participants: [...chat.participants, command.participant] }); results.push({ type, participantId: command.participant.id }); continue;
    }
    if (command.type === "participant.update") {
      const participantId = identifier(command.participantId);
      if (!chat.participants.some(item => item.id === participantId)) throw new Error("Participant not found.");
      record(command.patch, "Participant patch", ["name", "avatarUrl", "status"]);
      chat = normalizeChat({ ...chat, participants: chat.participants.map(item => item.id === participantId ? { ...item, ...command.patch } : item) });
      results.push({ type, participantId }); continue;
    }
    if (command.type === "conversation.add") {
      const conversation = { id: command.id === undefined ? crypto.randomUUID() : identifier(command.id), kind: command.kind, title: command.title === undefined ? "新しい会話" : string(command.title, "Conversation title", 1000, false), memberIds: command.memberIds, messages: [] };
      chat = normalizeChat({ ...chat, conversations: [...chat.conversations, conversation] }); results.push({ type, conversationId: conversation.id }); continue;
    }
    const conversationId = identifier(command.conversationId), conversation = chat.conversations.find(item => item.id === conversationId);
    if (!conversation) throw new Error("Conversation not found.");
    if (command.type === "conversation.delete") { chat = normalizeChat({ ...chat, conversations: chat.conversations.filter(item => item.id !== conversationId) }); results.push({ type, conversationId }); continue; }
    if (command.type === "conversation.update") {
      const memberIds = command.memberIds ?? conversation.memberIds;
      const updated = { ...conversation, title: command.title ?? conversation.title, memberIds,
        ...(conversation.readMarkers ? { readMarkers: conversation.readMarkers.filter(item => memberIds.includes(item.participantId)) } : {}) };
      chat = normalizeChat({ ...chat, conversations: chat.conversations.map(item => item.id === conversationId ? updated : item) }); results.push({ type, conversationId }); continue;
    }
    if (command.type === "conversation.read") {
      const participantId = identifier(command.participantId), messageId = identifier(command.messageId);
      if (!conversation.memberIds.includes(participantId)) throw new Error("Read marker participant is not a member.");
      const nextIndex = conversation.messages.findIndex(item => item.id === messageId);
      if (nextIndex < 0) throw new Error("Message not found.");
      const previous = conversation.readMarkers?.find(item => item.participantId === participantId);
      const previousIndex = previous ? conversation.messages.findIndex(item => item.id === previous.messageId) : -1;
      if (nextIndex > previousIndex) {
        const readMarkers = [...(conversation.readMarkers ?? []).filter(item => item.participantId !== participantId), { participantId, messageId }];
        chat = normalizeChat({ ...chat, conversations: chat.conversations.map(item => item.id === conversationId ? { ...item, readMarkers } : item) });
      }
      results.push({ type, conversationId, messageId, participantId }); continue;
    }
    let messages = conversation.messages, readMarkers = conversation.readMarkers;
    let messageId: string;
    if (command.type === "message.add") {
      const message = createChatMessage(command.message); messageId = message.id;
      if (!conversation.memberIds.includes(message.authorId)) throw new Error("Message author is not a conversation member.");
      messages = [...messages, message];
    } else {
      messageId = identifier(command.messageId);
      const target = messages.find(item => item.id === messageId);
      if (!target) throw new Error("Message not found.");
      if (command.type === "reaction.toggle") {
        const participantId = identifier(command.participantId), emoji = string(command.emoji, "Reaction emoji", 64, false);
        if (!conversation.memberIds.includes(participantId)) throw new Error("Reaction participant is not a conversation member.");
        const reactions = [...(target.reactions ?? [])], existing = reactions.findIndex(item => item.emoji === emoji);
        if (existing < 0) reactions.push({ emoji, participantIds: [participantId] });
        else {
          const reaction = reactions[existing]!;
          const participantIds = reaction.participantIds.includes(participantId) ? reaction.participantIds.filter(id => id !== participantId) : [...reaction.participantIds, participantId];
          if (participantIds.length) reactions[existing] = { emoji, participantIds }; else reactions.splice(existing, 1);
        }
        messages = messages.map(item => item.id === messageId ? { ...item, reactions } : item);
      } else if (command.type === "message.update") {
        record(command.patch, "Message patch", ["text", "attachments", "editedAt"]);
        const effectiveChange = command.patch.text !== undefined && command.patch.text !== target.text || command.patch.attachments !== undefined && JSON.stringify(command.patch.attachments) !== JSON.stringify(target.attachments ?? []) || command.patch.editedAt !== undefined && command.patch.editedAt !== target.editedAt;
        if (effectiveChange) {
          const editedAt = command.patch.editedAt ?? new Date(Math.max(Date.now(), new Date(target.createdAt).getTime())).toISOString();
          messages = messages.map(item => item.id === messageId ? { ...item, ...command.patch, editedAt } : item);
        }
      } else {
        if (command.cascadeReplies !== undefined && typeof command.cascadeReplies !== "boolean") throw new Error("cascadeReplies must be boolean.");
        const deleted = new Set([messageId]);
        for (const item of messages) if (item.replyTo === messageId) {
          if (!command.cascadeReplies) throw new Error("This message has replies; cascadeReplies is required to delete the thread.");
          deleted.add(item.id);
        }
        messages = messages.filter(item => !deleted.has(item.id));
        readMarkers = readMarkers?.flatMap(marker => {
          if (!deleted.has(marker.messageId)) return [marker];
          const index = conversation.messages.findIndex(item => item.id === marker.messageId);
          const preceding = conversation.messages.slice(0, index).reverse().find(item => !deleted.has(item.id));
          return preceding ? [{ ...marker, messageId: preceding.id }] : [];
        });
      }
    }
    chat = normalizeChat({ ...chat, conversations: chat.conversations.map(item => item.id === conversationId ? { ...item, messages, ...(readMarkers !== undefined ? { readMarkers } : {}) } : item) }); results.push({ type, conversationId, messageId });
  }
  const changed = serializeChat(chat) !== serializeChat(original);
  return Object.freeze({ chat: changed ? chat : original, changed, results: Object.freeze(results.map(item => Object.freeze(item))) as ChatCommandResult["results"] });
}
