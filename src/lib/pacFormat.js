// Format notes (reverse-engineered from real ch.pac / CH2.PAC / CH3.PAC files):
//
// Header (16 bytes):
//   [0..4)  magic "DPK8"
//   [4..8)  u32 h1 (unclear meaning — not touched)
//   [8..12) u32 h2 — byte size of the model-data region
//   [12..16) u32 h3 — constant (observed: 7)
//
// Table (starts at 0x800):
//   [0x800..0x804) tag "EMD " / "EMD2" / "EMD3" (one per file)
//   [0x804..0x808) u32 (unclear meaning — not touched)
//   then entries, 12 bytes each, until a non-numeric-ASCII 8-byte chunk:
//     [0..8)  8-digit ASCII ID, e.g. "00010201"
//     [8..10) u16 LE block index
//     [10..12) u16 LE size in bytes
//
// Real byte offset of an entry's data = BASE + block_index * BLOCK
// Verified: every entry's computed offset lands exactly on a "PAC " sub-archive header.

export const BASE = 0x4000;
export const BLOCK = 0x800; // 2048
export const TABLE_START = 0x808;

export function parseArchive(buf) {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'DPK8') {
    throw new Error('Not a recognized ch.pac-family file (missing "DPK8" header).');
  }
  const h1 = view.getUint32(4, true);
  const h2 = view.getUint32(8, true);
  const h3 = view.getUint32(12, true);
  const tableTag = String.fromCharCode(bytes[0x800], bytes[0x801], bytes[0x802], bytes[0x803]);

  const entries = [];
  let pos = TABLE_START;
  while (pos + 12 <= bytes.length) {
    let isDigits = true;
    for (let i = 0; i < 8; i++) {
      const b = bytes[pos + i];
      if (b < 48 || b > 57) { isDigits = false; break; }
    }
    if (!isDigits) break;
    const id = String.fromCharCode(...bytes.subarray(pos, pos + 8));
    const blk = view.getUint16(pos + 8, true);
    const size = view.getUint16(pos + 10, true);
    const offset = BASE + blk * BLOCK;
    entries.push({ id, blk, size, offset, tablePos: pos });
    pos += 12;
  }

  return { magic, h1, h2, h3, tableTag, entries, fileLength: bytes.length };
}

export function alignUp(n, align) {
  return Math.ceil(n / align) * align;
}

/**
 * Build a new archive buffer with `entry` repointed at a freshly appended payload.
 * The new payload is appended at the true end of the file (block-aligned), so
 * nothing else in the archive is disturbed.
 */
export function injectEntry(originalBuf, entry, payloadBuf) {
  const origBytes = new Uint8Array(originalBuf);
  const newStart = alignUp(origBytes.length, BLOCK);
  const blk = (newStart - BASE) / BLOCK;

  if (blk > 0xffff) {
    throw new Error('File too large — the new block index would overflow the 16-bit field.');
  }
  if (payloadBuf.byteLength > 0xffff) {
    throw new Error(
      'Payload too large — the size field is 16-bit (max 65535 bytes). ' +
      'This game format cannot address a single sub-file bigger than that.'
    );
  }

  const totalLen = newStart + payloadBuf.byteLength;
  const out = new Uint8Array(totalLen);
  out.set(origBytes, 0);
  out.set(new Uint8Array(payloadBuf), newStart);

  const view = new DataView(out.buffer);
  view.setUint16(entry.tablePos + 8, blk, true);
  view.setUint16(entry.tablePos + 10, payloadBuf.byteLength, true);

  return { buffer: out.buffer, newOffset: newStart, newBlk: blk };
}

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

export function hex(n) {
  return '0x' + n.toString(16).toUpperCase();
}
