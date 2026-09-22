import { createAIChatMessage, normalizeAIChat, serializeAIChat } from "./aichat";
import { AICHAT_LIMITS, choice, identifier, list, record, string } from "./validation";
import type { AIChatCommand, AIChatCommandResult, AIChatModel } from "./types";
const commandKeys: Record<AIChatCommand["type"], readonly string[]> = {
  "aichat.update": ["type", "title"], "aichat.replace": ["type", "aichat"],
  "conversation.add": ["type", "id", "title"], "conversation.update": ["type", "conversationId", "title"], "conversation.delete": ["type", "conversationId"],
  "message.add": ["type", "conversationId", "message"], "message.update": ["type", "conversationId", "messageId", "patch"], "message.delete": ["type", "conversationId", "messageId", "cascadeReplies"],
  "message.respond": ["type", "conversationId", "messageId", "content", "status", "error"],
};
export function executeAIChatCommands(input: AIChatModel, commands: AIChatCommand | readonly AIChatCommand[]): AIChatCommandResult {
  const original = normalizeAIChat(input), batch = Array.isArray(commands) ? list(commands, "Commands", AICHAT_LIMITS.commands) : [commands];
  let aichat = original;
  const results: AIChatCommandResult["results"] = [];
  for (const value of batch) {
    const raw = record(value, "AIChat command");
    const type = choice(raw.type, Object.keys(commandKeys) as AIChatCommand["type"][], "Command");
    record(raw, "AIChat command", commandKeys[type]);
    const command = raw as AIChatCommand;
    if (command.type === "aichat.replace") { aichat = normalizeAIChat(command.aichat); results.push({ type }); continue; }
    if (command.type === "aichat.update") { aichat = normalizeAIChat({ ...aichat, title: command.title }); results.push({ type }); continue; }
    if (command.type === "conversation.add") {
      const conversation = { id: command.id === undefined ? crypto.randomUUID() : identifier(command.id), title: command.title === undefined ? "新しい会話" : string(command.title, "Conversation title", 1000, false), messages: [] };
      aichat = normalizeAIChat({ ...aichat, conversations: [...aichat.conversations, conversation] }); results.push({ type, conversationId: conversation.id }); continue;
    }
    const conversationId = identifier(command.conversationId), conversation = aichat.conversations.find(item => item.id === conversationId);
    if (!conversation) throw new Error("Conversation not found.");
    if (command.type === "conversation.delete") { aichat = normalizeAIChat({ ...aichat, conversations: aichat.conversations.filter(item => item.id !== conversationId) }); results.push({ type, conversationId }); continue; }
    if (command.type === "conversation.update") {
      aichat = normalizeAIChat({ ...aichat, conversations: aichat.conversations.map(item => item.id === conversationId ? { ...item, title: command.title } : item) }); results.push({ type, conversationId }); continue;
    }
    let messages = conversation.messages;
    let messageId: string;
    if (command.type === "message.add") {
      const message = createAIChatMessage(command.message); messageId = message.id; messages = [...messages, message];
    } else {
      messageId = identifier(command.messageId);
      if (!messages.some(item => item.id === messageId)) throw new Error("Message not found.");
      if (command.type === "message.respond") {
        const target = messages.find(item => item.id === messageId)!;
        if (target.role !== "assistant") throw new Error("Only assistant messages can receive a response.");
        messages = messages.map(item => item.id === messageId ? { ...item, content: command.content, status: command.status, error: command.error } : item);
      } else if (command.type === "message.update") {
        record(command.patch, "Message patch", ["content", "status", "error", "attachments", "references", "toolCalls"]);
        messages = messages.map(item => item.id === messageId ? { ...item, ...command.patch } : item);
      } else {
        if (command.cascadeReplies !== undefined && typeof command.cascadeReplies !== "boolean") throw new Error("cascadeReplies must be boolean.");
        const deleted = new Set([messageId]);
        if (command.cascadeReplies) for (const item of messages) if (item.replyTo && deleted.has(item.replyTo)) deleted.add(item.id);
        messages = messages.filter(item => !deleted.has(item.id));
      }
    }
    aichat = normalizeAIChat({ ...aichat, conversations: aichat.conversations.map(item => item.id === conversationId ? { ...item, messages } : item) }); results.push({ type, conversationId, messageId });
  }
  const changed = serializeAIChat(aichat) !== serializeAIChat(original);
  return Object.freeze({ aichat: changed ? aichat : original, changed, results: Object.freeze(results) as AIChatCommandResult["results"] });
}
