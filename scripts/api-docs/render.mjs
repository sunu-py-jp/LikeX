import path from 'node:path';
import ts from 'typescript';
import { Marked } from 'marked';
import { relationshipTable } from './relationships.mjs';

export const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
export const slug = value => value.replace(/<[^>]+>/g, '').replace(/[`*_]/g, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
export const relativeUrl = (from, to) => path.posix.relative(path.posix.dirname(from), to) || 'index.html';

export function selectMarkdown(markdown, sections) {
  const text = markdown.replace(/^# .+\r?\n/, '');
  const tokens = new Marked().lexer(text);
  if (!sections?.length) return tokens.filter(token => !(token.type === 'paragraph' && /^\[(?:利用ガイドへ戻る|ドキュメント一覧|利用ガイド|ガイド一覧)\]\([^\n]+\)\s*$/.test(token.raw))).map(token => token.raw).join('');
  const found = new Set(), selected = [], definitions = [];
  let keep = false, anchors = [];
  for (const token of tokens) {
    if (token.type === 'def') { definitions.push(token.raw); continue; }
    if (/^<a\s+id="[\p{L}\p{N}_-]+"\s*><\/a>$/u.test(token.raw.trim())) { anchors.push(token.raw); continue; }
    if (token.type === 'space') { if (anchors.length) anchors.push(token.raw); else if (keep) selected.push(token.raw); continue; }
    if (token.type === 'heading' && token.depth === 2) {
      keep = sections.includes(token.text);
      if (keep) found.add(token.text);
    }
    if (keep) selected.push(...anchors, token.raw);
    anchors = [];
  }
  for (const section of sections) if (!found.has(section)) throw new Error(`Missing Markdown section: ${section}`);
  return selected.join('') + '\n' + definitions.join('\n');
}

function highlight(code, language) {
  if (!/^(ts|tsx|js|jsx|typescript|javascript|json)$/.test(language)) return escapeHtml(code);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, code);
  const pieces = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const text = escapeHtml(scanner.getTokenText());
    const kind = token >= ts.SyntaxKind.FirstKeyword && token <= ts.SyntaxKind.LastKeyword ? 'keyword'
      : [ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail].includes(token) ? 'string'
      : token === ts.SyntaxKind.NumericLiteral ? 'number'
      : [ts.SyntaxKind.SingleLineCommentTrivia, ts.SyntaxKind.MultiLineCommentTrivia].includes(token) ? 'comment' : '';
    pieces.push(kind ? `<span class="syntax-${kind}">${text}</span>` : text);
  }
  return pieces.join('');
}

export function renderMarkdown(markdown, { rewriteLink = value => value, usedIds = new Map() } = {}) {
  const headings = [];
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({ renderer: {
    heading({ tokens, depth, text }) {
      const base = slug(text), count = usedIds.get(base) ?? 0;
      usedIds.set(base, count + 1);
      const id = `${base}${count ? `-${count}` : ''}`;
      headings.push({ id, title: text.replace(/[`*_]/g, ''), depth });
      return `<h${depth} id="${escapeHtml(id)}">${this.parser.parseInline(tokens)}<a class="heading-link" href="#${encodeURIComponent(id)}" aria-label="この見出しへのリンク">#</a></h${depth}>\n`;
    },
    code({ text, lang }) {
      const language = (lang ?? '').split(/\s/)[0];
      if (language === 'mermaid') return relationshipTable(text, escapeHtml);
      return `<div class="code-example"><div class="code-toolbar"><span>${escapeHtml(language || 'code')}</span><button type="button" data-copy-code aria-label="コードをコピー">コピー</button></div><pre tabindex="0"><code>${highlight(text, language)}</code></pre></div>\n`;
    },
    link({ href, tokens, title }) {
      const url = rewriteLink(href);
      if (!url) return this.parser.parseInline(tokens);
      return `<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${this.parser.parseInline(tokens)}</a>`;
    },
    image({ href, text, title }) {
      const url = rewriteLink(href);
      return url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}" loading="lazy"${title ? ` title="${escapeHtml(title)}"` : ''}>` : escapeHtml(text);
    },
    html({ text }) {
      // Source Markdown is repository-owned. Only named anchors are needed by these guides.
      const anchor = text.trim().match(/^<a\s+id="([\p{L}\p{N}_-]+)"\s*>(?:<\/a>)?$/u);
      if (anchor) return `<a id="${escapeHtml(anchor[1])}">${text.includes("</a>") ? "</a>" : ""}`;
      return text.trim() === "</a>" ? "</a>" : escapeHtml(text);
    },
    table(token) {
      const head = token.header.map(cell => `<th scope="col">${this.parser.parseInline(cell.tokens)}</th>`).join('');
      const rows = token.rows.map(row => `<tr>${row.map(cell => `<td>${this.parser.parseInline(cell.tokens)}</td>`).join('')}</tr>`).join('');
      return `<div class="table-scroll" tabindex="0" role="region" aria-label="APIの一覧表"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    },
  } });
  return { html: marked.parse(markdown), headings };
}
