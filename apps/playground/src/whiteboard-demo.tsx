import { useState } from "react";
import LikeWhiteboard, { createWhiteboard } from "@likex/whiteboard";
import "../../../packages/whiteboard/src/styles.css";
import { getDemoComponentTheme } from "./demo/component-theme";
export default function WhiteboardDemo() {
  const [initialWhiteboard] = useState(() => createWhiteboard({ title: "アイデアを整理する", elements: [
    { id: "title", kind: "text", text: "次のプロジェクト", x: 85, y: 50, width: 550, height: 70, fontSize: 28 },
    { id: "note1", kind: "sticky", text: "利用者の声\n\n必要な情報に\nすぐたどり着ける", x: 90, y: 155, width: 230, height: 230, fill: "#fff2a8" },
    { id: "note2", kind: "sticky", text: "まず試すこと\n\n検索をシンプルに\n画面を見ながら検証", x: 360, y: 155, width: 230, height: 230, fill: "#d6eddb", stroke: "#b2d2bb" },
    { id: "note3", kind: "sticky", text: "あとで考える\n\nチーム内の共有\n表示のカスタマイズ", x: 630, y: 155, width: 230, height: 230, fill: "#dceafa", stroke: "#b6cde7" },
    { id: "caption", kind: "text", text: "付箋を選んで、自由に並べ替えてみてください。", x: 100, y: 440, width: 720, height: 70, fontSize: 16, textColor: "#697486" },
  ] }));
  const [theme] = useState(() => getDemoComponentTheme("system"));
  return <LikeWhiteboard initialWhiteboard={initialWhiteboard} onSave={async model => model} {...theme} style={{ height: "100dvh" }} />;
}
