import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ExplorerDemo from "./explorer-demo";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Playgroundの表示先が見つかりません");

createRoot(root).render(
  <StrictMode>
    <ExplorerDemo />
  </StrictMode>,
);
