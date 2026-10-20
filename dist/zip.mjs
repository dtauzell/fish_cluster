// A small ZIP writer using stored entries: PNGs are already compressed.
// No network dependency. ZIP64 archives are deliberately rejected.
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let result = 0xffffffff;
  for (const byte of bytes) result = crcTable[(result ^ byte) & 255] ^ (result >>> 8);
  return (result ^ 0xffffffff) >>> 0;
}
function header(size) {
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  return { bytes, u16: (offset, value) => view.setUint16(offset, value, true),
    u32: (offset, value) => view.setUint32(offset, value, true) };
}

export async function createZip(entries) {
  if (entries.length > 65535) throw new Error('Too many files for one ZIP. Export a smaller dataset.');
  const files = [], directory = [], seen = new Set();
  let offset = 0, directorySize = 0;
  for (const entry of entries) {
    if (seen.has(entry.name) || entry.name.startsWith('/') || entry.name.split('/').includes('..')) throw new Error('Invalid ZIP filename.');
    seen.add(entry.name);
    const name = encoder.encode(entry.name);
    const bytes = entry.content instanceof Blob ? new Uint8Array(await entry.content.arrayBuffer())
      : typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content;
    if (name.length > 65535 || offset + bytes.length + name.length + 30 > 0xffffffff) throw new Error('Dataset is too large for one ZIP.');
    const checksum = crc32(bytes);
    const local = header(30);
    local.u32(0, 0x04034b50); local.u16(4, 20); local.u16(6, 0x0800); local.u16(12, 33);
    local.u32(14, checksum); local.u32(18, bytes.length); local.u32(22, bytes.length); local.u16(26, name.length);
    files.push(local.bytes, name, bytes);
    const central = header(46);
    central.u32(0, 0x02014b50); central.u16(4, 20); central.u16(6, 20); central.u16(8, 0x0800); central.u16(14, 33);
    central.u32(16, checksum); central.u32(20, bytes.length); central.u32(24, bytes.length);
    central.u16(28, name.length); central.u32(42, offset);
    directory.push(central.bytes, name);
    directorySize += 46 + name.length;
    offset += 30 + name.length + bytes.length;
  }
  if (offset + directorySize > 0xffffffff) throw new Error('Dataset is too large for one ZIP.');
  const end = header(22);
  end.u32(0, 0x06054b50); end.u16(8, entries.length); end.u16(10, entries.length);
  end.u32(12, directorySize); end.u32(16, offset);
  return new Blob([...files, ...directory, end.bytes], { type: 'application/zip' });
}
