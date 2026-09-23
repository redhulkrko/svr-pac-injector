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

/**
 * Wrestler name lookup, keyed by a two-digit filename identifier (e.g. the
 * "07" in ch-07.pac) and the wrestler's own 2-digit ID within that identifier
 * (V1/DPAC entries only — the ID's first 2 hex digits are the wrestler, the
 * last 2 are the attire/variant slot).
 */
const VARIANT_TYPE_LABELS = { '1': 'Match', '2': 'Story Mode', '4': 'Entrance' };
const ATTIRE_PREFIX_LABELS = { '1': 'Alt. Attire 1', '2': 'Alt. Attire 2', '9': 'Alt. Attire 3' };

export function extractIdentifierFromFilename(filename) {
  const m = /-(\d{2})\.[^.]+$/.exec(filename);
  return m ? m[1] : null;
}

export function buildWrestlerLookup(wrestlerRecords) {
  const lookup = new Map(); // identifier -> Map(wrestlerId -> name)
  for (const rec of wrestlerRecords || []) {
    if (!rec || rec.identifier == null || rec.id == null) continue;
    const identifier = String(rec.identifier);
    const id = String(rec.id).padStart(2, '0').toLowerCase();
    if (!lookup.has(identifier)) lookup.set(identifier, new Map());
    lookup.get(identifier).set(id, rec.name);
  }
  return lookup;
}

/**
 * Adds a `displayName` field to each entry when its wrestler is found in the
 * lookup for the given identifier.
 *
 * V1 (DPAC): ID is 4 hex digits — first 2 = wrestler, last 2 = attire/variant
 * slot. Known variant codes get a "(Match)" / "(Story Mode)" / "(Entrance)"
 * label via VARIANT_LABELS.
 *
 * V2 (DPK8): ID is 8 decimal digits — first 4 = wrestler, last 4 = variant.
 * The variant-code meaning isn't mapped for this format yet, so the name is
 * shown without a bracketed label until that scheme is known.
 *
 * Entries whose wrestler isn't in the lookup for that identifier get
 * `displayName: null`.
 */
/**
 * Builds the bracketed label for a V1 variant code (2 hex chars).
 * First digit = attire slot (0 = default, 1/2/9 = alt attire 1/2/3).
 * Second digit = clip type (1 = Match, 2 = Story Mode, 4 = Entrance).
 * e.g. "01" -> "Match", "11" -> "Alt. Attire 1 - Match", "00" -> null.
 */
function buildV1VariantLabel(variant) {
  if (!variant || variant.length !== 2) return null;
  const [attireDigit, typeDigit] = variant;
  const attireLabel = ATTIRE_PREFIX_LABELS[attireDigit] || null;
  const typeLabel = VARIANT_TYPE_LABELS[typeDigit] || null;
  const parts = [attireLabel, typeLabel].filter(Boolean);
  return parts.length ? parts.join(' - ') : null;
}

export function annotateWithNames(entries, format, lookup, identifier) {
  if (identifier == null || !lookup) {
    return entries.map((e) => ({ ...e, displayName: null }));
  }
  const byWrestler = lookup.get(String(identifier));
  if (!byWrestler) {
    return entries.map((e) => ({ ...e, displayName: null }));
  }

  if (format === 'v1') {
    return entries.map((e) => {
      if (e.id.length !== 4) return { ...e, displayName: null };
      const wrestlerId = e.id.slice(0, 2);
      const variant = e.id.slice(2, 4);
      const name = byWrestler.get(wrestlerId);
      if (!name) return { ...e, displayName: null };
      const label = buildV1VariantLabel(variant);
      return { ...e, displayName: label ? `${name} (${label})` : name };
    });
  }

  if (format === 'v2') {
    return entries.map((e) => {
      if (e.id.length !== 8) return { ...e, displayName: null };
      const wrestlerId = e.id.slice(0, 4);
      const name = byWrestler.get(wrestlerId);
      return { ...e, displayName: name || null };
    });
  }

  return entries.map((e) => ({ ...e, displayName: null }));
}

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

export function hex(n) {
  return '0x' + n.toString(16).toUpperCase();
}
