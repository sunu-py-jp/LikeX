import { useCallback, useState } from "react";
import LikeChat, { createChat, createChatMessage, parseChat, serializeChat, type ChatModel } from "@likex/chat";
import "../../../packages/chat/src/styles.css";
import { getDemoComponentTheme } from "./demo/component-theme";
const message = (id: string, authorId: string, text: string, minute: string, extra = {}) => createChatMessage({ id, authorId, text, createdAt: `2026-09-22T0${minute}:00.000Z`, ...extra });
const sample = () => createChat({ id: "team-chat", title: "LikeChat", participants: [
  { id: "me", name: "高橋 葵", status: "online" }, { id: "yui", name: "佐藤 結衣", status: "online" },
  { id: "ren", name: "田中 蓮", status: "online" }, { id: "haru", name: "山本 春香", status: "away" },
  { id: "kento", name: "鈴木 健人", status: "offline" },
], conversations: [
  { id: "design", title: "プロダクトデザイン", kind: "space", memberIds: ["me", "yui", "ren", "haru"], messages: [
    message("d1", "yui", "おはようございます！\n新しいダッシュボードのデザイン案をまとめました。午後のレビューまでに、気になるところがあればこのスレッドで教えてください。", "0:12", { attachments: [{ id: "brief", name: "ダッシュボード_レビュー資料.pdf", mediaType: "application/pdf", size: 245760 }], reactions: [{ emoji: "👍", participantIds: ["me", "ren"] }] }),
    message("d2", "ren", "見ました！情報の優先順位がわかりやすくなってますね。\nモバイルの余白だけ、レビューで一緒に確認したいです。", "0:18", { replyTo: "d1" }),
    message("d3", "yui", "ありがとうございます。モバイル版も用意しておきます！", "0:22", { replyTo: "d1" }),
    message("d4", "me", "レビューは14時からでお願いします。\n今回はこちらの3点を確認しましょう。\n・ナビゲーションのわかりやすさ\n・カードの情報量\n・スマートフォンでの操作", "0:30", { reactions: [{ emoji: "✅", participantIds: ["yui", "haru"] }] }),
    message("d5", "haru", "了解です！ユーザーテストのメモも共有しますね。", "0:35"),
  ], readMarkers: [{ participantId: "me", messageId: "d4" }] },
  { id: "dm-yui", title: "佐藤 結衣", kind: "direct", memberIds: ["me", "yui"], messages: [message("y1", "yui", "昨日のフィードバック、ありがとうございました！\nボタンのラベルを少し変えてみたので、あとで見てもらえますか？", "1:05"), message("y2", "me", "もちろんです。レビューの前に確認しますね。", "1:09")], readMarkers: [{ participantId: "me", messageId: "y2" }] },
  { id: "dm-ren", title: "田中 蓮", kind: "direct", memberIds: ["me", "ren"], messages: [message("r1", "ren", "APIの型定義を更新しました。フロント側で使うデータも確認お願いします。", "1:15")] },
  { id: "dm-haru", title: "山本 春香", kind: "direct", memberIds: ["me", "haru"], messages: [message("h1", "haru", "テストの日程、来週の火曜と木曜で調整しています。", "0:45")], readMarkers: [{ participantId: "me", messageId: "h1" }] },
  { id: "project", title: "Webサイト リニューアル", kind: "space", memberIds: ["me", "yui", "ren", "kento"], messages: [message("p1", "kento", "今週の進捗を共有します。トップページの実装が完了し、下層ページに着手しました。", "0:50"), message("p2", "me", "共有ありがとうございます！プレビュー環境で確認します。", "1:00")], readMarkers: [{ participantId: "me", messageId: "p2" }] },
  { id: "lounge", title: "チームラウンジ", kind: "space", memberIds: ["me", "yui", "ren", "haru", "kento"], messages: [message("l1", "ren", "オフィス近くに新しいカフェができていました ☕\n次の出社日に行ってみませんか？", "1:20", { reactions: [{ emoji: "❤️", participantIds: ["yui", "haru"] }] })] },
] });
export default function ChatDemo() {
  const [initialChat] = useState(sample), [theme] = useState(() => getDemoComponentTheme("light"));
  const save = useCallback((chat: ChatModel) => parseChat(serializeChat(chat)), []);
  return <LikeChat initialChat={initialChat} initialConversationId="design" currentUserId="me" onSave={save}
    onSend={async (_request, { signal }) => { if (signal.aborted) throw new Error("送信を中止しました"); }}
    onAttachmentUpload={files => files.map(file => ({ id: crypto.randomUUID(), name: file.name, mediaType: file.type || "application/octet-stream", size: file.size }))}
    features={{ import: false, export: false, history: false }} {...theme} style={{ height: "100dvh", width: "100%", borderRadius: 0 }} />;
}
