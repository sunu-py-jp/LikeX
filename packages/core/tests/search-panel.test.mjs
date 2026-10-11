import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchPanelState, isSearchPanelQuery } from '../src/search-panel.ts';

test('search initial state is opt-in, literal and independently allocated', () => {
  assert.deepEqual(createSearchPanelState(), { open: false, query: '', focus: 0 });
  assert.deepEqual(createSearchPanelState({ initialSearchQuery: 'a.* b' }), { open: false, query: 'a.* b', focus: 0 });
  assert.deepEqual(createSearchPanelState({ initialSearchOpen: true, initialSearchQuery: '売上' }), { open: true, query: '売上', focus: 0 });
  assert.notEqual(createSearchPanelState(), createSearchPanelState());
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
