import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
const demos = {
  explorer: lazy(() => import("./explorer-demo")),
  spreadsheet: lazy(() => import("./spreadsheet-demo")),
  slide: lazy(() => import("./slide-demo")),
  document: lazy(() => import("./document-demo")),
  board: lazy(() => import("./board-demo")),
  diagram: lazy(() => import("./diagram-demo")),
  calendar: lazy(() => import("./calendar-demo")),
  whiteboard: lazy(() => import("./whiteboard-demo")),
  aichat: lazy(() => import("./aichat-demo")),
  chat: lazy(() => import("./chat-demo")),
  dataview: lazy(() => import("./dataview-demo")),
  form: lazy(() => import("./form-demo")),
};
const pathname = window.location.pathname.replace(/^\/+|\/+$/g, ""), key = pathname === "slides" ? "slide" : pathname;
const name = Object.hasOwn(demos, key) ? key as keyof typeof demos : "explorer";
const Demo = demos[name];
document.title = `LikeX — ${name}`;
const root = document.getElementById("root");
if (!root) throw new Error("Playgroundの表示先が見つかりません");
createRoot(root).render(<StrictMode><Suspense fallback={<p role="status">読み込み中…</p>}><Demo /></Suspense></StrictMode>);
