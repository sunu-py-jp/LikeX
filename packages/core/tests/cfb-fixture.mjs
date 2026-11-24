// Test-only writer for compound files ([MS-CFB]). It lays out a minimal but valid file so the
// reader can be exercised without committing binary fixtures for every structural case.
const END = 0xfffffffe, FREE = 0xffffffff, FATSECT = 0xfffffffd, DIFSECT = 0xfffffffc, NOSTREAM = 0xffffffff;
const MINI = 64, CUTOFF = 4096;

/**
 * @param {{ path: string, content: Uint8Array }[]} streams "/" separates storages from the stream name.
 * @param {{ sectorSize?: 512 | 4096, headerDifatEntries?: number }} [options]
 * @returns {Uint8Array}
 */
export function createCompoundFile(streams, options = {}) {
  const { sectorSize = 512, headerDifatEntries = 109 } = options;
  const root = { name: 'Root Entry', type: 5, children: [] }, entries = [root];
  for (const { path, content } of streams) {
    const names = path.split('/');
    let parent = root;
    names.forEach((name, index) => {
      const last = index === names.length - 1;
      let node = parent.children.find(item => item.name === name);
      if (!node) { node = { name, type: last ? 2 : 1, children: [], content: last ? content : undefined }; parent.children.push(node); entries.push(node); }
      parent = node;
    });
  }
  entries.forEach((entry, id) => Object.assign(entry, { id, left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, start: END, size: 0 }));
  // A sorted right-leaning chain is a valid search tree; readers do not depend on its balance.
  const order = (a, b) => a.name.length - b.name.length || (a.name.toUpperCase() < b.name.toUpperCase() ? -1 : 1);
  for (const entry of entries) {
    const sorted = [...entry.children].sort(order);
    if (sorted.length) entry.child = sorted[0].id;
    sorted.forEach((item, index) => { if (sorted[index + 1]) item.right = sorted[index + 1].id; });
  }
  const sectorsFor = bytes => Math.ceil(bytes / sectorSize);
  const small = entries.filter(entry => entry.type === 2 && entry.content.length > 0 && entry.content.length < CUTOFF);
  const large = entries.filter(entry => entry.type === 2 && entry.content.length >= CUTOFF);
  const miniFat = [];
  for (const entry of small) {
    const count = Math.ceil(entry.content.length / MINI);
    entry.start = miniFat.length; entry.size = entry.content.length;
    for (let index = 0; index < count; index++) miniFat.push(index === count - 1 ? END : miniFat.length + 1);
  }
  const miniStream = new Uint8Array(miniFat.length * MINI);
  for (const entry of small) miniStream.set(entry.content, entry.start * MINI);
  const perSector = sectorSize / 4;
  const directorySectors = sectorsFor(entries.length * 128), miniFatSectors = sectorsFor(miniFat.length * 4), miniStreamSectors = sectorsFor(miniStream.length);
  const dataSectors = large.reduce((total, entry) => total + sectorsFor(entry.content.length), 0);
  let fatSectors = 1, difatSectors = 0;
  for (;;) {
    const total = fatSectors + difatSectors + directorySectors + miniFatSectors + miniStreamSectors + dataSectors;
    const neededFat = Math.ceil(total / perSector), neededDifat = neededFat > headerDifatEntries ? Math.ceil((neededFat - headerDifatEntries) / (perSector - 1)) : 0;
    if (neededFat === fatSectors && neededDifat === difatSectors) break;
    fatSectors = neededFat; difatSectors = neededDifat;
  }
  const total = fatSectors + difatSectors + directorySectors + miniFatSectors + miniStreamSectors + dataSectors;
  const fat = new Array(fatSectors * perSector).fill(FREE);
  let next = 0;
  const chain = count => { const first = next; for (let index = 0; index < count; index++) { fat[next] = index === count - 1 ? END : next + 1; next++; } return count ? first : END; };
  for (let index = 0; index < fatSectors; index++) fat[next++] = FATSECT;
  const firstDifat = difatSectors ? next : END;
  for (let index = 0; index < difatSectors; index++) fat[next++] = DIFSECT;
  const firstDirectory = chain(directorySectors), firstMiniFat = chain(miniFatSectors), firstMiniStream = chain(miniStreamSectors);
  root.start = firstMiniStream; root.size = miniStream.length;
  for (const entry of large) { entry.start = chain(sectorsFor(entry.content.length)); entry.size = entry.content.length; }
  const headerSize = sectorSize, file = new Uint8Array(headerSize + total * sectorSize), view = new DataView(file.buffer);
  const at = sector => headerSize + sector * sectorSize;
  file.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  view.setUint16(24, 0x3e, true); view.setUint16(26, sectorSize === 512 ? 3 : 4, true); view.setUint16(28, 0xfffe, true);
  view.setUint16(30, sectorSize === 512 ? 9 : 12, true); view.setUint16(32, 6, true);
  view.setUint32(40, sectorSize === 512 ? 0 : directorySectors, true); view.setUint32(44, fatSectors, true); view.setUint32(48, firstDirectory, true);
  view.setUint32(56, CUTOFF, true); view.setUint32(60, firstMiniFat, true); view.setUint32(64, miniFatSectors, true);
  view.setUint32(68, firstDifat, true); view.setUint32(72, difatSectors, true);
  for (let index = 0; index < 109; index++) view.setUint32(76 + index * 4, index < Math.min(fatSectors, headerDifatEntries) ? index : FREE, true);
  for (let index = 0; index < difatSectors; index++) {
    const base = at(firstDifat + index);
    for (let slot = 0; slot < perSector - 1; slot++) {
      const fatIndex = headerDifatEntries + index * (perSector - 1) + slot;
      view.setUint32(base + slot * 4, fatIndex < fatSectors ? fatIndex : FREE, true);
    }
    view.setUint32(base + (perSector - 1) * 4, index === difatSectors - 1 ? END : firstDifat + index + 1, true);
  }
  fat.forEach((value, index) => view.setUint32(at(0) + index * 4, value, true));
  for (let index = 0; index < directorySectors * (sectorSize / 128); index++) {
    const base = at(firstDirectory) + index * 128, entry = entries[index];
    if (!entry) { for (const offset of [68, 72, 76]) view.setUint32(base + offset, NOSTREAM, true); continue; }
    [...entry.name].forEach((character, position) => view.setUint16(base + position * 2, character.charCodeAt(0), true));
    view.setUint16(base + 64, (entry.name.length + 1) * 2, true);
    file[base + 66] = entry.type; file[base + 67] = 1;
    view.setUint32(base + 68, entry.left, true); view.setUint32(base + 72, entry.right, true); view.setUint32(base + 76, entry.child, true);
    view.setUint32(base + 116, entry.start, true); view.setUint32(base + 120, entry.size, true);
  }
  miniFat.forEach((value, index) => view.setUint32(at(firstMiniFat) + index * 4, value, true));
  for (let index = miniFat.length; index < miniFatSectors * perSector; index++) view.setUint32(at(firstMiniFat) + index * 4, FREE, true);
  if (miniStream.length) file.set(miniStream, at(firstMiniStream));
  for (const entry of large) file.set(entry.content, at(entry.start));
  return file;
}

/** Offsets needed by tests that corrupt a generated file. */
export const compoundFileLayout = Object.freeze({ headerFirstDirectory: 48, headerFatCount: 44, headerSectorShift: 30, headerMiniSectorShift: 32, headerDifat: 76,
  entry: Object.freeze({ nameLength: 64, type: 66, left: 68, right: 72, child: 76, start: 116, size: 120 }) });
