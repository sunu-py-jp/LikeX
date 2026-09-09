import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const ExplorerDemo = lazy(() => import("./explorer-demo"));
const SpreadsheetDemo = lazy(() => import("./spreadsheet-demo"));
const isSpreadsheet = window.location.pathname.replace(/\/$/, "") === "/spreadsheet";

const root = document.getElementById("root");
if (!root) throw new Error("Playgroundの表示先が見つかりません");

createRoot(root).render(
  <StrictMode>
    <Suspense fallback={<p role="status">読み込み中…</p>}>
      {isSpreadsheet ? <SpreadsheetDemo /> : <ExplorerDemo />}
    </Suspense>
  </StrictMode>,
);
