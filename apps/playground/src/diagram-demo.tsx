import { useState } from "react";
import LikeDiagram, { createDiagram } from "@likex/diagram";
import "../../../packages/diagram/src/styles.css";
import { getDemoComponentTheme } from "./demo/component-theme";
export default function DiagramDemo() {
  const [initialDiagram] = useState(() => createDiagram({ title: "申請フロー", nodes: [
    { id: "start", shape: "ellipse", text: "申請を受け付ける", x: 80, y: 170, width: 170, height: 80, fill: "#edf4fb" },
    { id: "check", shape: "diamond", text: "内容を確認", x: 320, y: 150, width: 180, height: 120, fill: "#fff5dc" },
    { id: "approve", text: "承認して通知", x: 590, y: 100, width: 180, height: 85, fill: "#e8f2e9" },
    { id: "retry", text: "修正を依頼", x: 590, y: 300, width: 180, height: 85, fill: "#f8e9e7" },
  ], edges: [ { id: "e1", sourceId: "start", targetId: "check" }, { id: "e2", sourceId: "check", targetId: "approve", label: "問題なし" }, { id: "e3", sourceId: "check", targetId: "retry", label: "要確認" } ] }));
  const [theme] = useState(() => getDemoComponentTheme("system"));
  return <LikeDiagram initialDiagram={initialDiagram} onSave={async model => model} {...theme} style={{ height: "100dvh" }} />;
}
