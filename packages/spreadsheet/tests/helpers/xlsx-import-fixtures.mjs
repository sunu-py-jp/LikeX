import { deflateRawSync } from 'node:zlib';

export const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
export const xml = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
export function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
export function zip(entries, { method = 8, descriptor = false } = {}) {
  const local = [], directory = []; let offset = 0;
  for (const [name, content] of Array.isArray(entries) ? entries : Object.entries(entries)) {
    const filename = Buffer.from(name), bytes = Buffer.from(content), compressed = method === 8 ? deflateRawSync(bytes) : bytes;
    const crc = crc32(bytes), flags = 0x800 | (descriptor ? 8 : 0);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6); header.writeUInt16LE(method, 8);
    if (!descriptor) { header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(bytes.length, 22); }
    header.writeUInt16LE(filename.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(flags, 8); cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(compressed.length, 20); cd.writeUInt32LE(bytes.length, 24); cd.writeUInt16LE(filename.length, 28); cd.writeUInt32LE(offset, 42);
    const tail = descriptor ? Buffer.alloc(16) : Buffer.alloc(0); if (descriptor) { tail.writeUInt32LE(0x08074b50); tail.writeUInt32LE(crc, 4); tail.writeUInt32LE(compressed.length, 8); tail.writeUInt32LE(bytes.length, 12); }
    local.push(header, filename, compressed, tail); directory.push(cd, filename); offset += header.length + filename.length + compressed.length + tail.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(directory.length / 2, 8); end.writeUInt16LE(directory.length / 2, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}
export function fixture({ sheets = [{ name: 'Sheet 1', xml: '<sheetData/>' }], workbookExtra = '', workbookAttributes = '', parts = {}, links = [] } = {}) {
  const entries = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="${rel}officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${main}" xmlns:r="${rel.slice(0, -1)}">${workbookAttributes}<sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="s${i}"${s.state ? ` state="${s.state}"` : ''}/>`).join('')}</sheets>${workbookExtra}</workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="s${i}" Type="${rel}worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}${links.map(({ id, type, target, external }) => `<Relationship Id="${id}" Type="${rel}${type}" Target="${xml(target)}"${external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`,
    ...Object.fromEntries(sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, `<worksheet xmlns="${main}" xmlns:r="${rel.slice(0, -1)}">${s.xml}</worksheet>`])), ...parts,
  };
  return entries;
}
