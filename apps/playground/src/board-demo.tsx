import { useState } from "react";
import LikeBoard, { createBoard, parseBoard, serializeBoard, type BoardModel } from "../../../packages/board/src";
import { getDemoComponentTheme } from "./demo/component-theme";
export function createDemoBoard() {
  return createBoard({ id: "demo-board", title: "プロダクト改善", labels: [{ id: "design", name: "デザイン", color: "#8b5cf6" }, { id: "engineering", name: "開発", color: "#3b82f6" }, { id: "research", name: "リサーチ", color: "#d97706" }], members: [{ id: "sato", name: "佐藤" }, { id: "yamada", name: "山田" }, { id: "suzuki", name: "鈴木" }], columns: [
    { id: "backlog", title: "バックログ", color: "#94a3b8", cards: [
      { id: "b1", title: "検索結果の表示を見直す", description: "検索キーワードの強調と、情報の並び順を整理する。", labelIds: ["design"], assigneeIds: ["sato"] },
      { id: "b2", title: "利用者インタビューの準備", description: "直近で利用を始めたチームに、最初に迷った操作を聞く。", labelIds: ["research"], assigneeIds: ["suzuki"], dueDate: "2026-10-02" },
      { id: "b3", title: "通知設定の整理", labelIds: ["design", "engineering"] },
    ] },
    { id: "progress", title: "進行中", color: "#3b82f6", cards: [
      { id: "p1", title: "ファイル一覧の読み込みを改善", description: "表示に必要な範囲から読み込み、待ち時間を短くする。", labelIds: ["engineering"], assigneeIds: ["yamada"], dueDate: "2026-09-28" },
      { id: "p2", title: "モバイルのメニューを調整", description: "片手でも押しやすいサイズと配置へ。", labelIds: ["design"], assigneeIds: ["sato", "yamada"], dueDate: "2026-09-30" },
    ] },
    { id: "review", title: "レビュー", color: "#d97706", cards: [{ id: "r1", title: "初回ガイドの文言を更新", description: "利用者の操作の順番に合わせて説明する。", labelIds: ["design"], assigneeIds: ["suzuki"], dueDate: "2026-09-25" }] },
    { id: "done", title: "完了", color: "#059669", cards: [{ id: "d1", title: "キーボード操作を追加", labelIds: ["engineering"], assigneeIds: ["yamada"] }, { id: "d2", title: "よくある質問を整理", labelIds: ["research"], assigneeIds: ["suzuki"] }] },
  ] });
}
export default function BoardDemo() {
  const [board] = useState(createDemoBoard), [theme] = useState(() => getDemoComponentTheme("system"));
  return <LikeBoard initialBoard={board} {...theme} onSave={(value: BoardModel) => parseBoard(serializeBoard(value))} style={{ height: "100dvh", width: "100%" }} />;
}
