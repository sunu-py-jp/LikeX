import { useCallback, useState } from "react";
import LikeAIChat, { createAIChat, createAIChatMessage, parseAIChat, serializeAIChat, type AIChatContentPart, type AIChatModel, type AIChatPartRenderers, type AIChatSendHandler } from "@likex/aichat";
import "../../../packages/aichat/src/styles.css";
import "./aichat-demo.css";
import { getDemoComponentTheme } from "./demo/component-theme";
const resultParts: AIChatContentPart[] = [
  { id: "sales-query", type: "demo.tool", data: { name: "売上を集計", status: "complete", input: { range: "売上速報!B2:F6" }, result: { rows: 4, total: 264000 } } },
  { id: "sales-image", type: "demo.image", data: { src: "/aichat-sales-preview.svg", alt: "4商品の売上を示す横棒グラフ", caption: "画像も、利用側が定義した表示パーツとして挿入できます。" } },
  { id: "sales-summary", type: "demo.sales-card", data: { title: "売上速報", total: 264000, items: 4 } },
];
function dataOf(part: AIChatContentPart) { return part.data && typeof part.data === "object" && !Array.isArray(part.data) ? part.data : {}; }
const partRenderers: AIChatPartRenderers = {
  "demo.tool": part => {
    const data = dataOf(part);
    return <details className="aichat-demo-tool"><summary><span>{String(data.name ?? "ツール")}</span><small>{data.status === "complete" ? "完了" : "実行中"}</small></summary><pre>{JSON.stringify({ input: data.input, result: data.result }, null, 2)}</pre></details>;
  },
  "demo.image": part => {
    const data = dataOf(part);
    // This example only displays the demo's own image. A host can define its own URL policy.
    if (data.src !== "/aichat-sales-preview.svg" || typeof data.alt !== "string") return <p>画像情報を確認できません。</p>;
    // Vite hosts this local SVG; the reusable renderer does not depend on Next.js image loading.
    // eslint-disable-next-line @next/next/no-img-element
    return <figure className="aichat-demo-image"><img src={data.src} alt={data.alt} width={560} height={250} /><figcaption>{typeof data.caption === "string" ? data.caption : ""}</figcaption></figure>;
  },
  "demo.sales-card": part => {
    const data = dataOf(part);
    return <section className="aichat-demo-sales"><span>{typeof data.title === "string" ? data.title : "集計結果"}</span><strong>{typeof data.total === "number" ? `¥${data.total.toLocaleString("ja-JP")}` : "—"}</strong><small>{typeof data.items === "number" ? `${data.items} 商品の売上合計` : ""} · 利用側で定義したカード</small></section>;
  },
};
const sample = () => createAIChat({ id: "demo-aichat", title: "LikeAIChat", conversations: [
  { id: "rich-content", title: "画像・ツール・カード", messages: [
    createAIChatMessage({ id: "rich-question", role: "user", content: "売上データを確認して、集計結果を画像とカードで見せて。", createdAt: "2026-09-22T01:20:00.000Z" }),
    createAIChatMessage({ id: "rich-answer", role: "assistant", content: "4商品の売上を集計しました。ツールの入出力は展開して確認できます。\nこの会話はローカルのサンプルデータです。", parts: resultParts, replyTo: "rich-question", createdAt: "2026-09-22T01:20:01.000Z" }),
  ] },
  { id: "planning", title: "新しいサービスのアイデア", messages: [
    createAIChatMessage({ id: "question-1", role: "user", content: "小さなチームで新しいサービスを始めたいです。最初に整理することを教えてください。", createdAt: "2026-09-22T01:30:00.000Z" }),
    createAIChatMessage({ id: "answer-1", role: "assistant", content: "まずは、チームで次の3つをそろえるところから始めましょう。\n\n1. 誰の、どんな困りごとを解決するか\n一人の具体的な利用者を思い浮かべ、その人が今どう対処しているかを調べます。\n\n2. 最初に届ける小さな価値\n必要な機能をすべて揃える前に、最も大切な体験をひとつ形にします。\n\n3. 学びを確かめる方法\n5人ほどに使ってもらい、実際の行動と感想を聞きます。\n\nどんな分野のサービスを考えていますか？", replyTo: "question-1", createdAt: "2026-09-22T01:30:12.000Z", references: [{ id: "brief", title: "プロジェクトの進め方", description: "課題の発見 → 小さな試作 → 利用者の声" }] }),
  ] },
  { id: "writing", title: "文章の下書き", messages: [] },
  { id: "research", title: "リサーチのメモ", messages: [] },
] });
const respond: AIChatSendHandler = async function* (request, { signal }) {
  const rich = request.conversation.id === "rich-content";
  if (rich) yield { type: "part", part: { id: "sales-query", type: "demo.tool", data: { name: "売上を集計", status: "running", input: { range: "売上速報!B2:F6" } } } };
  const reply = rich ? "サンプルデータを集計しました。同じIDのツールパーツを実行中から完了へ更新し、画像と集計カードを追加しています。" : `「${request.prompt.content.slice(0, 90)}」について、まず目的と対象を一文で書き出してみましょう。\n\n・今わかっていること\n・まだ確認したいこと\n・今日できる小さな一歩\n\nこの3つに分けると、次に進むための具体的な行動が見えてきます。\n\nこれはデモ用の応答です。実際のサービスでは、利用側の onSend から応答を返せます。`;
  for (let index = 0; index < reply.length; index += 5) {
    if (signal.aborted) return;
    await new Promise<void>(resolve => { const timer = setTimeout(done, 38); function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); } signal.addEventListener("abort", done, { once: true }); });
    if (signal.aborted) return;
    yield reply.slice(index, index + 5);
  }
  if (rich) for (const part of resultParts) { if (signal.aborted) return; yield { type: "part", part }; }
};
export default function AIChatDemo() {
  const [initialAIChat] = useState(sample), [theme] = useState(() => getDemoComponentTheme("light"));
  const save = useCallback((aichat: AIChatModel) => parseAIChat(serializeAIChat(aichat)), []);
  return <LikeAIChat initialAIChat={initialAIChat} initialConversationId="rich-content" partRenderers={partRenderers} onSave={save} onSend={respond} onAttachmentUpload={files => files.map(file => ({ id: crypto.randomUUID(), name: file.name, mediaType: file.type || "application/octet-stream", size: file.size }))} {...theme} primaryColor={theme.primaryColor ?? "#397263"} exportFileName="conversation.json" style={{ height: "100dvh", width: "100%", borderRadius: 0 }} />;
}
