import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchPanelState, isSearchPanelQuery, getInitialSearchMode, normalizeExternalSearchResults } from '../src/search-panel.ts';

test('search initial state is opt-in, literal and independently allocated', () => {
  assert.deepEqual(createSearchPanelState(), { open: false, query: '', focus: 0 });
  assert.deepEqual(createSearchPanelState({ initialSearchQuery: 'a.* b' }), { open: false, query: 'a.* b', focus: 0 });
  assert.deepEqual(createSearchPanelState({ initialSearchOpen: true, initialSearchQuery: '売上' }), { open: true, query: '売上', focus: 0 });
  assert.notEqual(createSearchPanelState(), createSearchPanelState());
});

test('external search initial mode honors explicit choices without treating a title as a keyword', () => {
  assert.equal(getInitialSearchMode(), 'local');
  assert.equal(getInitialSearchMode({ initialSearchMode: 'external' }), 'local');
  const externalSearch = { title: '意味で検索', results: [] };
  assert.equal(getInitialSearchMode({ externalSearch }), 'external');
  assert.equal(getInitialSearchMode({ externalSearch, initialSearchQuery: '売上' }), 'local');
  assert.equal(getInitialSearchMode({ externalSearch, initialSearchMode: 'external', initialSearchQuery: '売上' }), 'external');
  assert.equal(getInitialSearchMode({ externalSearch, initialSearchMode: 'local' }), 'local');
  assert.equal(createSearchPanelState({ externalSearch }).query, '');
});

test('external result normalization preserves ranking and target identities; rejects malformed/duplicate identities', () => {
  const first = { id: 'b', title: '先に表示', target: { pageNumber: 2 } };
  const second = { id: 'a', snippet: '<b>plain text</b>', target: { pageNumber: 1 } };
  const source = Object.freeze([first, null, { id: ' ', target: {} }, { id: 'bad', title: 1, target: {} }, second,
    { id: 'b', target: { pageNumber: 3 } }, { id: 'missing' }]);
  const normalized = normalizeExternalSearchResults(source);
  assert.deepEqual(normalized, [first, second]);
  assert.equal(normalized[0], first);
  assert.deepEqual(normalizeExternalSearchResults(undefined), []);
  assert.deepEqual(normalizeExternalSearchResults({}), []);
});

test('shared search entry rejects nonstrings and overlong queries without coercion', () => {
  assert.equal(isSearchPanelQuery(''), true);
  assert.equal(isSearchPanelQuery('a'.repeat(4096)), true);
  for (const query of [null, {}, 4, true, 'a'.repeat(4097)]) {
    assert.equal(isSearchPanelQuery(query), false);
    assert.equal(createSearchPanelState({ initialSearchOpen: true, initialSearchQuery: query }).query, '');
  }
  assert.equal(createSearchPanelState({ initialSearchOpen: 'true' }).open, false);
});
