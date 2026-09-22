import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedPackageFile } from '../lib/package-files.mjs';

test('skill packages contain only their explicit instructions, references and executable entry', () => {
  for (const moduleName of ['spreadsheet', 'slide', 'document']) {
    const prefix = `skills/likex-${moduleName}/`;
    for (const file of ['SKILL.md', 'references/schema-guide.md', 'references/commands.md',
      'references/commands.schema.json', `references/${{ slide: 'slon', spreadsheet: 'spon', document: 'dcon' }[moduleName]}.schema.json`, 'scripts/document.mjs'])
      assert.equal(allowedPackageFile(prefix + file, moduleName), true, file);
    for (const file of ['.env', 'credentials.json', 'scripts/debug.mjs', '../.env', 'references/sample.spon', 'references/archive/secrets.md'])
      assert.equal(allowedPackageFile(prefix + file, moduleName), false, file);
    assert.equal(allowedPackageFile(prefix + 'SKILL.md', 'explorer'), false);
    assert.equal(allowedPackageFile(prefix + 'SKILL.md', 'core'), false);
  }
});

test('standard distribution files remain valid and traversal paths never pass', () => {
  for (const file of ['dist/index.js', 'dist/types/model-entry.d.ts', 'README.md', 'LICENSE', 'src/docs/README.md'])
    assert.equal(allowedPackageFile(file, 'spreadsheet'), true);
  for (const file of ['dist/../.env', '/dist/index.js', 'dist\\index.js', 'dist//index.js', 'src/model/types.ts'])
    assert.equal(allowedPackageFile(file, 'spreadsheet'), false);
});

test('only Slide distributes its dedicated image export instructions and CLI', () => {
  for (const moduleName of ['slide', 'spreadsheet', 'document']) {
    for (const relative of ['references/image-export.md', 'scripts/render-images.mjs'])
      assert.equal(allowedPackageFile(`skills/likex-${moduleName}/${relative}`, moduleName), moduleName === 'slide');
  }
});
