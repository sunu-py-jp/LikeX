/** Render the small Mermaid relationship/state diagrams used in the guides as accessible tables. */
export function relationshipTable(source, escape) {
  const lines = source.trim().split('\n').map(line => line.trim()).filter(Boolean);
  const state = lines[0] === 'stateDiagram-v2';
  if (!state && !/^flowchart (TD|LR)$/.test(lines[0])) throw new Error('Unsupported documentation diagram. Add a reviewed renderer for this Mermaid syntax.');
  const nodes = new Map(), edges = [];
  for (const line of lines.slice(1)) {
    const match = line.match(/^(\[\*\]|\w+)(?:\[(.*?)\])?\s*-->(?:\|([^|]*)\|)?\s*(\[\*\]|\w+)(?:\[(.*?)\])?(?::\s*(.*))?$/);
    if (!match) throw new Error(`Unsupported documentation relationship: ${line}`);
    const [, from, fromLabel, relationship, to, toLabel, action] = match;
    if (fromLabel) nodes.set(from, fromLabel);
    if (toLabel) nodes.set(to, toLabel);
    edges.push({ from, to, label: action || relationship || '' });
  }
  const label = id => escape(id === '[*]' ? '開始' : nodes.get(id) ?? id);
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${state ? '編集モードの遷移' : 'データの参照関係'}"><table><caption>${state ? '編集モードの遷移' : 'データの参照関係'}</caption><thead><tr><th scope="col">${state ? '現在の状態' : '参照元'}</th><th scope="col">${state ? '操作・結果' : '関係'}</th><th scope="col">${state ? '次の状態' : '参照先'}</th></tr></thead><tbody>${edges.map(edge => `<tr><td>${label(edge.from)}</td><td>${escape(edge.label || '参照')}</td><td>${label(edge.to)}</td></tr>`).join('')}</tbody></table></div>`;
}
