import { useCallback, useState } from "react";
import LikeAIChat, { createAIChat, createAIChatMessage, parseAIChat, serializeAIChat, type AIChatModel, type AIChatSendHandler } from "@likex/aichat";
import "../../../packages/aichat/src/styles.css";
import { getDemoComponentTheme } from "./demo/component-theme";
const sample = () => createAIChat({ id: "demo-aichat", title: "LikeAIChat", conversations: [
  { id: "planning", title: "新しいサービスのアイデア", messages: [
    createAIChatMessage({ id: "question-1", role: "user", content: "小さなチームで新しいサービスを始めたいです。最初に整理することを教えてください。", createdAt: "2026-09-22T01:30:00.000Z" }),
    createAIChatMessage({ id: "answer-1", role: "assistant", content: "まずは、チームで次の3つをそろえるところから始めましょう。\n\n1. 誰の、どんな困りごとを解決するか\n一人の具体的な利用者を思い浮かべ、その人が今どう対処しているかを調べます。\n\n2. 最初に届ける小さな価値\n必要な機能をすべて揃える前に、最も大切な体験をひとつ形にします。\n\n3. 学びを確かめる方法\n5人ほどに使ってもらい、実際の行動と感想を聞きます。\n\nどんな分野のサービスを考えていますか？", replyTo: "question-1", createdAt: "2026-09-22T01:30:12.000Z", references: [{ id: "brief", title: "プロジェクトの進め方", description: "課題の発見 → 小さな試作 → 利用者の声" }] }),
  ] },
  { id: "writing", title: "文章の下書き", messages: [] },
  { id: "research", title: "リサーチのメモ", messages: [] },
] });
const respond: AIChatSendHandler = async function* (request, { signal }) {
  const reply = `「${request.prompt.content.slice(0, 90)}」について、まず目的と対象を一文で書き出してみましょう。\n\n・今わかっていること\n・まだ確認したいこと\n・今日できる小さな一歩\n\nこの3つに分けると、次に進むための具体的な行動が見えてきます。\n\nこれはデモ用の応答です。実際のサービスでは、利用側の onSend から応答を返せます。`;
  for (let index = 0; index < reply.length; index += 5) {
    if (signal.aborted) return;
    await new Promise<void>(resolve => { const timer = setTimeout(done, 38); function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); } signal.addEventListener("abort", done, { once: true }); });
    if (signal.aborted) return;
    yield reply.slice(index, index + 5);
  }
};
export default function AIChatDemo() {
  const [initialAIChat] = useState(sample), [theme] = useState(() => getDemoComponentTheme("light"));
  const save = useCallback((aichat: AIChatModel) => parseAIChat(serializeAIChat(aichat)), []);
  return <LikeAIChat initialAIChat={initialAIChat} onSave={save} onSend={respond} onAttachmentUpload={files => files.map(file => ({ id: crypto.randomUUID(), name: file.name, mediaType: file.type || "application/octet-stream", size: file.size }))} {...theme} primaryColor={theme.primaryColor ?? "#397263"} exportFileName="conversation.json" style={{ height: "100dvh", width: "100%", borderRadius: 0 }} />;
}
