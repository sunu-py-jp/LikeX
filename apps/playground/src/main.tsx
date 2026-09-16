import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const ExplorerDemo = lazy(() => import("./explorer-demo"));
const SpreadsheetDemo = lazy(() => import("./spreadsheet-demo"));
const SlideDemo = lazy(() => import("./slide-demo"));
const isSpreadsheet = window.location.pathname.replace(/\/$/, "") === "/spreadsheet";
const isSlide = ["/slide", "/slides"].includes(window.location.pathname.replace(/\/$/, ""));
document.title = isSlide ? "LikeSlide — スライド編集" : isSpreadsheet ? "LikeX Spreadsheet — スプレッドシート" : "LikeX Explorer — ファイルワークスペース";

const root = document.getElementById("root");
if (!root) throw new Error("Playgroundの表示先が見つかりません");

createRoot(root).render(
  <StrictMode>
    <Suspense fallback={<p role="status">読み込み中…</p>}>
      {isSlide ? <SlideDemo /> : isSpreadsheet ? <SpreadsheetDemo /> : <ExplorerDemo />}
    </Suspense>
  </StrictMode>,
);
