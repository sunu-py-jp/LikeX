import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const { describeUploadRejections } = await importTypeScript('../src/model/upload-notification.ts');
const { validateUploadFiles, resolveUploadOptions, ExplorerUploadValidationError } =
  await importTypeScript('../src/model/upload.ts');

function rejected(names, options) {
  return validateUploadFiles(names.map(name => ({
    name, relativePath: `資料/${name}`, file: new File(['sample'], name),
  })), resolveUploadOptions({ ...options, invalidFileBehavior: 'skip' })).rejections;
}

test('a large rejected batch lists names and reasons, with one shared extension hint', () => {
  const names = Array.from({ length: 100 }, (_, i) => `長いファイル名-${i}.png`);
  const rejections = rejected(names, { allowedExtensions: ['.md', '.csv'] });
  const before = JSON.stringify(rejections);
  const notice = describeUploadRejections(rejections);
  assert.equal(notice.details.length, 100);
  assert.deepEqual(notice.details[0], {
    message: '資料/長いファイル名-0.png', kind: 'error', description: '許可されていない拡張子です',
  });
  assert.equal(notice.hint, '許可されている拡張子: .md、 .csv');
  assert.ok(notice.details.every(detail => !detail.description.includes('.md')));
  assert.equal(JSON.stringify(rejections), before);
  assert.match(new ExplorerUploadValidationError(rejections).message, /許可: .md、.csv/,
    'host errors retain their complete explanation');
});

test('multiple reasons remain visible for one file, and size-only errors have no extension hint', () => {
  const mixed = describeUploadRejections(rejected(['image.png'], {
    allowedExtensions: ['.md'], maxFileSizeBytes: 1,
  }));
  assert.equal(mixed.details.length, 1);
  assert.match(mixed.details[0].description, /許可されていない拡張子です\n.*上限1バイト/);
  const sizeOnly = describeUploadRejections(rejected(['readme.md'], { maxFileSizeBytes: 1 }));
  assert.equal(sizeOnly.hint, undefined);
  assert.match(sizeOnly.details[0].description, /上限1バイト/);
});

test('empty extension permissions and zero rejected files have explicit, non-repeated output', () => {
  const emptyPolicy = describeUploadRejections(rejected(['readme.md'], { allowedExtensions: [] }));
  assert.equal(emptyPolicy.hint, '許可されている拡張子はありません');
  assert.deepEqual(describeUploadRejections([]), { details: [], hint: undefined });
});
