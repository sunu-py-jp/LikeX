// Test-only writer for Office drawing records ([MS-ODRAW]).
const u16 = value => [value & 255, (value >>> 8) & 255];
const u32 = value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
const flat = parts => parts.flatMap(part => typeof part === 'number' ? [part] : [...part]);
/** Record header: version in the low four bits, instance above it, then type and payload length. */
export const artRecord = (version, instance, type, ...payload) => { const data = flat(payload); return Uint8Array.from([...u16(version | instance << 4), ...u16(type), ...u32(data.length), ...data]); };
export const artContainer = (type, ...children) => artRecord(15, 0, type, ...children);
export const SHAPE = Object.freeze({ group: 0x001, child: 0x002, patriarch: 0x004, flipHorizontal: 0x040, flipVertical: 0x080, connector: 0x100, hasAnchor: 0x200, background: 0x400, hasType: 0x800 });
export const shapeHeader = (id, shapeType, flags = SHAPE.hasAnchor | SHAPE.hasType) => artRecord(2, shapeType, 0xf00a, u32(id), u32(flags));
/** Property table: [id, value] pairs, or [id, bytes] for complex values, [id, value, 'blip'] for picture references. */
export function artProperties(entries, type = 0xf00b) {
  const fixed = entries.flatMap(([id, value, kind]) => [...u16(id | (value instanceof Uint8Array || Array.isArray(value) ? 0x8000 : 0) | (kind === 'blip' ? 0x4000 : 0)),
    ...u32(value instanceof Uint8Array || Array.isArray(value) ? value.length : value)]);
  return artRecord(3, entries.length, type, fixed, ...entries.filter(([, value]) => value instanceof Uint8Array || Array.isArray(value)).map(([, value]) => [...value]));
}
export const bounds = (type, left, top, right, bottom) => artRecord(0, 0, type, u32(left), u32(top), u32(right), u32(bottom));
export const groupBounds = (...edges) => artRecord(1, 0, 0xf009, ...edges.map(u32));
export const childAnchor = (...edges) => bounds(0xf00f, ...edges);
export const utf16 = text => [...text].flatMap(character => u16(character.charCodeAt(0))).concat([0, 0]);
/** Picture records: a 16-byte identifier (two for the odd instances), a tag byte, then the image. */
export const blip = (type, instance, data) => artRecord(0, instance, type, new Array(instance & 1 ? 32 : 16).fill(0xab), 0xff, data);
export const pngBlip = (data, twoIds = false) => blip(0xf01e, twoIds ? 0x6e1 : 0x6e0, data);
export const jpegBlip = (data, twoIds = false) => blip(0xf01d, twoIds ? 0x46b : 0x46a, data);
/** Store entry: 36 header bytes (size at 20, delay offset at 28, name length at 33), then an optional embedded picture. */
export function blipEntry({ embedded, size = embedded?.length ?? 0, delayOffset = 0xffffffff, name = [] } = {}) {
  const header = new Array(36).fill(0);
  header.splice(20, 4, ...u32(size)); header.splice(24, 4, ...u32(1)); header.splice(28, 4, ...u32(delayOffset)); header[33] = name.length;
  return artRecord(2, 6, 0xf007, header, name, embedded ?? []);
}
export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1, 8, 2, 0, 0, 0, 1, 2, 3, 4]);
export const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
