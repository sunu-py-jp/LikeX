import { useCallback, useState } from "react";
import LikeDocument, { parseDocument, serializeDocument, type DocumentModel } from "@likex/document";
import "../../../packages/document/src/styles.css";
import { createDemoDocument } from "./demo/document-model";
import { getDemoComponentTheme } from "./demo/component-theme";

export default function DocumentDemo() {
  const [initialDocument] = useState(createDemoDocument);
  const [theme] = useState(() => getDemoComponentTheme("system"));
  const save = useCallback((document: DocumentModel) => parseDocument(serializeDocument(document)), []);
  return <LikeDocument initialDocument={initialDocument} onSave={save} {...theme} exportFileName="プロジェクト提案書.dcon" style={{ height: "100dvh", width: "100%" }} />;
}
