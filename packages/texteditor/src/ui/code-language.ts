import { HighlightStyle, type LanguageSupport } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { tags } from "@lezer/highlight";
import type { TextEditorMode } from "../model/types";
import { yamlScalarHighlighting } from "./yaml-scalar-highlighting";

const languages: Readonly<Record<Exclude<TextEditorMode, "text">, LanguageSupport>> = {
  markdown: markdown(), json: json(), xml: xml(), yaml: yaml(),
};

/** Changing the language only configures parsing and highlighting, never the source. */
export function textEditorLanguageExtension(mode: TextEditorMode): LanguageSupport | readonly [] {
  return mode === "text" ? [] : languages[mode];
}

/** YAML's parser deliberately leaves scalar typing to applications. Apply display-only colors. */
export function textEditorLanguageSupport(mode: TextEditorMode) {
  return mode === "yaml" ? [languages.yaml, yamlScalarHighlighting] : textEditorLanguageExtension(mode);
}

/** Stable, component-scoped classes let light/dark themes change without rebuilding the editor. */
export const textEditorHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, class: "lxte-syntax-comment" },
  { tag: tags.propertyName, class: "lxte-syntax-property" },
  { tag: tags.attributeName, class: "lxte-syntax-attribute" },
  { tag: tags.tagName, class: "lxte-syntax-tag" },
  { tag: [tags.string, tags.attributeValue, tags.character, tags.escape], class: "lxte-syntax-string" },
  { tag: tags.number, class: "lxte-syntax-number" },
  { tag: [tags.bool, tags.atom, tags.null], class: "lxte-syntax-atom" },
  { tag: tags.keyword, class: "lxte-syntax-keyword" },
  { tag: [tags.meta, tags.processingInstruction, tags.labelName, tags.typeName], class: "lxte-syntax-meta" },
  { tag: [tags.punctuation, tags.operator], class: "lxte-syntax-punctuation" },
  { tag: tags.heading, class: "lxte-syntax-heading" },
  { tag: tags.strong, class: "lxte-syntax-strong" },
  { tag: tags.emphasis, class: "lxte-syntax-emphasis" },
  { tag: tags.strikethrough, class: "lxte-syntax-strikethrough" },
  { tag: [tags.link, tags.url], class: "lxte-syntax-link" },
  { tag: tags.monospace, class: "lxte-syntax-code" },
  { tag: tags.invalid, class: "lxte-syntax-invalid" },
]);
