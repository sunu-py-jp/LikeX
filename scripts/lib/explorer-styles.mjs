import assert from 'node:assert/strict';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import valueParser from 'postcss-value-parser';

export const explorerMarker = '[data-likex-explorer]';
const layerOrder = ['properties', 'theme', 'base', 'components', 'utilities'];
const selectors = selectorParser();
const scope = selectors.astSync(`:where(${explorerMarker}, ${explorerMarker} *)`).first.first;
const resetScope = selectors.astSync(`:is(${explorerMarker}, ${explorerMarker} *)`).first.first;
const outerRoot = `${explorerMarker}:not(:where(${explorerMarker} ${explorerMarker}))`;

function layerOf(node) {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor.type === 'atrule' && ancestor.name === 'layer') return ancestor.params;
  }
}

function insideKeyframes(node) {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor.type === 'atrule' && /^(?:-webkit-)?keyframes$/.test(ancestor.name)) return true;
  }
  return false;
}

function isDocumentRoot(selector) {
  return selector.nodes.length === 1 && ((selector.first.type === 'tag' && selector.first.value === 'html') ||
    (selector.first.type === 'pseudo' && [':root', ':host'].includes(selector.first.value)));
}

function scopedSelector(selector, reset) {
  const original = selector.clone();
  // A scope guard belongs to the target element, before its pseudo-element.
  // Applying it only to an ancestor would miss a portal/root's own utilities.
  let targetStart = 0;
  original.nodes.forEach((node, index) => { if (node.type === 'combinator') targetStart = index + 1; });
  const pseudoIndex = original.nodes.findIndex((node, index) => index >= targetStart && selectorParser.isPseudoElement(node));
  if (!reset) {
    if (pseudoIndex < 0) original.append(scope.clone());
    else original.insertBefore(original.nodes[pseudoIndex], scope.clone());
    return original.toString();
  }
  // Exactly one attribute's specificity: generic host button/input styles do
  // not undo Preflight, while our later single-class utilities can override it.
  const suffix = pseudoIndex < 0 ? [] : original.nodes.slice(pseudoIndex).map(node => node.clone());
  const head = original.clone();
  if (pseudoIndex >= 0) head.nodes.slice(pseudoIndex).forEach(node => node.remove());
  const result = selectorParser.selector();
  if (head.nodes.length && !(head.nodes.length === 1 && head.first.type === 'universal')) {
    result.append(selectorParser.pseudo({ value: ':where', nodes: [head] }));
  }
  result.append(resetScope.clone());
  suffix.forEach(node => result.append(node));
  return result.toString();
}

/** Scope compiled Tailwind CSS without changing the public TSX source. */
export function scopeExplorerStyles(css) {
  const root = postcss.parse(css);
  const keyframes = new Map();
  root.walkAtRules(/^(?:-webkit-)?keyframes$/, rule => {
    const name = valueParser(rule.params).nodes.filter(node => node.type !== 'space');
    assert.ok(name.length === 1 && ['word', 'string'].includes(name[0].type), `Unsupported keyframe name: ${rule.params}`);
    keyframes.set(name[0].value, `lxe-${name[0].value}`);
  });
  function namespaceValue(value, animation = false) {
    const parsed = valueParser(value);
    parsed.walk(node => {
      if (node.type === 'word' && node.value.startsWith('--tw-')) node.value = `--lxe-tw-${node.value.slice(5)}`;
      if (animation && ['word', 'string'].includes(node.type) && keyframes.has(node.value)) node.value = keyframes.get(node.value);
    });
    return parsed.toString();
  }
  root.walkAtRules(rule => {
    rule.params = namespaceValue(rule.params, /^(?:-webkit-)?keyframes$/.test(rule.name));
  });
  root.walkDecls(declaration => {
    if (declaration.prop.startsWith('--tw-')) declaration.prop = `--lxe-tw-${declaration.prop.slice(5)}`;
    declaration.value = namespaceValue(declaration.value,
      /^(?:-webkit-)?animation(?:-name)?$/.test(declaration.prop) || declaration.prop.startsWith('--lxe-animate-'));
  });
  root.walkRules(rule => {
    if (insideKeyframes(rule)) return;
    const layer = layerOf(rule);
    assert.ok(layerOrder.includes(layer), `Put maintained CSS in a known Tailwind layer: ${rule.selector}`);
    const reset = layer === 'base' || layer === 'properties';
    const scoped = [];
    selectors.astSync(rule.selector, { lossless: false }).each(selector => {
      if (isDocumentRoot(selector)) scoped.push(layer === 'base' ? outerRoot : explorerMarker);
      else scoped.push(scopedSelector(selector, reset));
    });
    rule.selector = [...new Set(scoped)].join(', ');
  });

  // Unlayered component CSS works in plain apps whose generic styles are also
  // unlayered. Preserve Tailwind's cascade order when removing its layers:
  // fallback custom-property initialization must precede every utility.
  const output = postcss.root();
  const layers = new Map(layerOrder.map(name => [name, []]));
  const metadata = [];
  for (const node of root.nodes) {
    if (node.type === 'comment') { output.append(node.clone()); continue; }
    if (node.type === 'atrule' && node.name === 'layer') {
      const names = postcss.list.comma(node.params);
      assert.ok(names.every(name => layers.has(name)), `Unexpected Tailwind layer: ${node.params}`);
      if (node.nodes) {
        assert.equal(names.length, 1, 'A layer block must have one name.');
        layers.get(node.params).push(...node.nodes.map(child => child.clone()));
      }
    } else {
      assert.ok(node.type === 'atrule' && /^(?:property|(?:-webkit-)?keyframes)$/.test(node.name),
        `Unexpected stylesheet rule outside Tailwind layers: ${node.toString().slice(0, 80)}`);
      metadata.push(node.clone());
    }
  }
  for (const name of layerOrder) output.append(layers.get(name));
  output.append(metadata);
  output.walkAtRules('layer', rule => { throw new Error(`Unexpected nested layer: ${rule.params}`); });
  return output.toString().trim() + '\n';
}
