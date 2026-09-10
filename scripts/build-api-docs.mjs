import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { renderMarkdown, selectMarkdown, relativeUrl } from './api-docs/render.mjs';
import { components, renderPage } from './api-docs/template.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repo, 'docs/APIDocs');
const check = process.argv.includes('--check');
const slash = value => value.split(path.sep).join('/');
async function metadataFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'assets') files.push(...await metadataFiles(path.join(dir, entry.name)));
    if (entry.isFile() && entry.name === 'page.json') files.push(path.join(dir, entry.name));
  }
  return files;
}
const pages = [];
for (const file of await metadataFiles(root)) {
  const data = JSON.parse(await readFile(file, 'utf8'));
  const directory = slash(path.relative(root, path.dirname(file)));
  const component = directory.split('/')[0] || null;
  if (component && !components.some(c => c.id === component)) throw new Error(`Unknown component: ${component}`);
  if (!data.title || !data.summary || (!data.source && !data.sources)) throw new Error(`Incomplete page metadata: ${file}`);
  const sources = data.sources ?? [data.source];
  const page = { ...data, id: directory || 'index', component, sources, output: directory ? `${directory}/index.html` : 'index.html', markdown: [] };
  for (const source of sources) {
    const resolved = path.resolve(repo, source);
    if (!resolved.startsWith(repo + path.sep) || !source.endsWith('.md')) throw new Error(`Invalid Markdown source: ${source}`);
    const markdown = selectMarkdown(await readFile(resolved, 'utf8'), data.sections);
    page.markdown.push({ source, markdown });
  }
  // First render establishes all heading anchors before cross-page links are resolved.
  const usedIds = new Map();
  page.headings = page.markdown.flatMap(part => renderMarkdown(part.markdown, { usedIds }).headings);
  for (const shot of page.screenshots ?? []) {
    if (!shot.src.startsWith('assets/screenshots/') || shot.src.includes('..') || !shot.alt || !shot.caption) throw new Error(`Invalid screenshot metadata in ${file}`);
    const bytes = await readFile(path.join(root, shot.src));
    if (bytes.toString('hex', 0, 8) === '89504e470d0a1a0a') { shot.width = bytes.readUInt32BE(16); shot.height = bytes.readUInt32BE(20); }
    else { shot.width ??= 1024; shot.height ??= 576; }
  }
  pages.push(page);
}
pages.sort((a, b) => (a.component ? components.findIndex(c => c.id === a.component) + 1 : 0) - (b.component ? components.findIndex(c => c.id === b.component) + 1 : 0) || (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
const bySource = new Map();
for (const page of pages) for (const source of page.sources) { const list = bySource.get(source) ?? []; list.push(page); bySource.set(source, list); }
const rootPage = pages.find(page => page.id === 'index');
if (!rootPage) throw new Error('docs/APIDocs/page.json is required');
function rewriteLink(page, source, href) {
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null;
  const [file, fragment] = href.split('#');
  const target = file ? slash(path.relative(repo, path.resolve(repo, path.dirname(source), decodeURIComponent(file)))) : source;
  if (target.startsWith('../')) throw new Error(`Link escapes repository: ${source}: ${href}`);
  let candidates = bySource.get(target) ?? [];
  // Module guide indexes lead to the first page of that component.
  if (!candidates.length && /packages\/(explorer|spreadsheet)\/src\/docs\/README\.md$/.test(target)) candidates = pages.filter(p => p.component === target.split('/')[1]).slice(0, 1);
  if (fragment && candidates.length) {
    const id = decodeURIComponent(fragment);
    const owner = candidates.find(candidate => candidate.headings.some(h => h.id === id) || candidate.markdown.some(part => part.markdown.includes(`id="${id}"`)));
    if (owner) { return `${relativeUrl(page.output, owner.output)}#${encodeURIComponent(id)}`; }
  }
  if (candidates.length) {
    const destination = candidates.find(candidate => !candidate.sections?.length) ?? candidates[0];
    // A filtered source may intentionally remove the old section; point at its page rather than a broken anchor.
    return relativeUrl(page.output, destination.output);
  }
  if (target.startsWith('docs/APIDocs/') && !target.endsWith('.md')) return relativeUrl(page.output, target.slice('docs/APIDocs/'.length)) + (fragment ? `#${fragment}` : '');
  return `https://github.com/sunu-py-jp/LikeX/blob/main/${target}${fragment ? `#${fragment}` : ''}`;
}
const outputs = new Map();
for (const page of pages) {
  const usedIds = new Map();
  page.html = page.markdown.map(part => renderMarkdown(part.markdown, { usedIds, rewriteLink: href => rewriteLink(page, part.source, href) }).html).join('\n');
  outputs.set(page.output, renderPage(page, pages));
}
const searchData = pages.filter(page => page.component).map(page => ({ id: page.id, text: [page.title, page.summary, ...(page.keywords ?? []), ...page.markdown.map(part => part.markdown)].join('\n') }));
outputs.set('assets/search-index.js', `/* Generated by npm run docs:build. */\nglobalThis.LikeXDocsSearch = ${JSON.stringify(searchData).replace(/</g, '\\u003c')};\n`);
outputs.set('pages.json', JSON.stringify(pages.map(page => ({ id: page.id, title: page.title, component: page.component, section: page.section, output: page.output, sources: page.sources, keywords: page.keywords ?? [], headings: page.headings })), null, 2) + '\n');
const stale = [];
for (const [file, text] of outputs) {
  const target = path.join(root, file);
  if (check) { let current; try { current = await readFile(target, 'utf8'); } catch { /* handled below */ } if (current !== text) stale.push(file); }
  else { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, text); }
}
if (stale.length) throw new Error(`API documentation is stale. Run npm run docs:build:\n${stale.join('\n')}`);
// Validate local files and named anchors in the generated HTML, including no-JS/file:// navigation.
for (const [file, text] of outputs) {
  if (!file.endsWith('.html')) continue;
  for (const match of text.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const value = match[1].replaceAll('&amp;', '&');
    if (/^(https?:|mailto:)/i.test(value)) continue;
    const [name, fragment] = value.split('#');
    const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURIComponent(name || path.posix.basename(file))));
    const target = outputs.get(relative) ?? await readFile(path.join(root, relative), relative.endsWith('.html') ? 'utf8' : undefined);
    if (fragment && typeof target === 'string' && !target.includes(`id="${decodeURIComponent(fragment)}"`)) throw new Error(`Broken anchor: ${file} → ${value}`);
  }
}
console.log(`${check ? 'Verified' : 'Generated'} ${pages.length} API pages; local links, screenshots and anchors are valid.`);
