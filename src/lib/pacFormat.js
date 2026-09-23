// Two known archive formats for ch.pac-family files.
//
// ── V2 — "DPK8" (SvR 2010, 2011) ─────────────────────────────────────────
// Header (16 bytes): magic "DPK8", u32 h1 (unclear), u32 h2 (data region
// size), u32 h3 (constant, observed 7).
// Table at 0x800, tagged "EMD "/"EMD2"/"EMD3". Entries are 12 bytes:
// 8-digit ASCII ID + u16 LE block index + u16 LE size in bytes.
// Real offset = BASE_V2 + block_index * BLOCK. Each entry stores its own
// absolute address, independent of every other entry — verified against
// real files: every computed offset lands exactly on a "PAC " sub-header.
//
// ── V1 — "DPAC" (older titles, pre-2010) ────────────────────────────────
// Header (16 bytes): magic "DPAC", same u32 h1/h2/h3 layout as V2.
// Table at 0x800, tagged "EMD ". Entries are only 4 bytes: u16 ID
// (e.g. 0x0201) + u16 size-in-256-byte-units. There is NO offset field —
// each entry's real position is a running total: start at BASE_V1, and
// after each entry add align_up(size_units * 256, 2048) to get the next
// entry's offset. Verified against real files: simulating this cumulative
// walk lands on every single "PAC " sub-header in order, exactly.
//
// This matters for injection: in V2, entries are independently addressed,
// so you can append new data at EOF and repoint just one entry. In V1,
// every entry after the one you change shifts, because position is only
// ever implicit/cumulative — a resize means rebuilding the whole data
// region in table order, not a simple append-and-repoint.

export const BASE = 0x4000;
export const BLOCK = 0x800; // 2048
export const TABLE_START = 0x808;
const V1_SIZE_UNIT = 256;

export function alignUp(n, align) {
  return Math.ceil(n / align) * align;
}

function readHeader(bytes, view) {
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const h1 = view.getUint32(4, true);
  const h2 = view.getUint32(8, true);
  const h3 = view.getUint32(12, true);
  const tableTag = String.fromCharCode(bytes[0x800], bytes[0x801], bytes[0x802], bytes[0x803]);
  return { magic, h1, h2, h3, tableTag };
}

function parseV2(buf, bytes, view, header) {
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
  return { ...header, format: 'v2', entries, fileLength: bytes.length };
}

function parseV1(buf, bytes, view, header) {
  const entries = [];
  let pos = TABLE_START;
  let zeroStreak = 0;
  let cursor = BASE;
  while (pos + 4 <= bytes.length) {
    const idv = view.getUint16(pos, true);
    const val = view.getUint16(pos + 2, true);
    if (idv === 0 && val === 0) {
      zeroStreak += 1;
      if (zeroStreak > 4) break;
      pos += 4;
      continue;
    }
    zeroStreak = 0;
    const id = idv.toString(16).padStart(4, '0');
    const size = val * V1_SIZE_UNIT;
    const offset = cursor;
    entries.push({ id, val, size, offset, tablePos: pos });
    cursor = alignUp(cursor + size, BLOCK);
    pos += 4;
  }
  return { ...header, format: 'v1', entries, fileLength: bytes.length };
}

export function parseArchive(buf) {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const header = readHeader(bytes, view);

  if (header.magic === 'DPK8') return parseV2(buf, bytes, view, header);
  if (header.magic === 'DPAC') return parseV1(buf, bytes, view, header);

  throw new Error(
    `Not a recognized ch.pac-family file (magic was "${header.magic}", expected "DPK8" or "DPAC").`
  );
}

/**
 * Build a new archive buffer with `entry` repointed at a freshly appended payload.
 * V2 ONLY — each entry stores its own absolute address, so the new payload can
 * simply be appended at the true end of the file (block-aligned) and just that
 * entry's table record repointed at it; nothing else in the archive moves.
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

/**
 * Extract every entry's raw bytes into a { filename: Uint8Array } map,
 * ready to hand to JSZip (or anything else that wants the raw pieces).
 * Works for both formats — extraction only ever needs offset + size.
 */
export function extractAllEntries(archiveBuf, entries) {
  const files = {};
  for (const e of entries) {
    files[`${e.id}.pac`] = new Uint8Array(archiveBuf, e.offset, e.size);
  }
  return files;
}

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

export function hex(n) {
  return '0x' + n.toString(16).toUpperCase();
}
