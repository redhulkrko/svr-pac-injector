# ch.pac Injector — SvR 2010 (PSP)

A browser-based tool for injecting/overwriting sub-archives inside the
`ch.pac` / `CH2.PAC` / `CH3.PAC` character archives from *Smackdown vs.
Raw 2010* (PSP). Everything runs client-side — no files are uploaded
anywhere.

A proper React + Vite project — not a single dumped-together file.

## Running it

```bash
npm install
npm run dev       # local dev server
npm run build     # production build -> dist/
npm run preview   # preview the production build
```

## What it does

1. Load a `ch.pac`-family archive.
2. Pick an entry from its file table (e.g. `00010201`).
3. Upload a replacement sub-archive (e.g. a custom `0001.pac`).
4. Inject — it appends your data at the true end of the file (2048-byte
   aligned) and repoints just that entry's table record at it, leaving
   everything else in the archive untouched.
5. Download the new archive.

## Format notes (reverse-engineered from real files)

- **Header**: 16 bytes, magic `DPK8`, followed by three `u32` fields
  (one of which is the byte size of the model-data region).
- **Table**: starts at offset `0x800`, tagged `EMD `, `EMD2`, or `EMD3`
  (one tag per file — `ch.pac` / `CH2.PAC` / `CH3.PAC` respectively).
- **Entries**: 12 bytes each — an 8-digit ASCII ID (e.g. `00010201`),
  a `u16` block index, and a `u16` size in bytes. The table ends at the
  first non-numeric-ASCII 8-byte chunk.
- **Real offset** of an entry's data: `0x4000 + block_index × 2048`.
- Verified against real `ch.pac` / `CH2.PAC` / `CH3.PAC` files: every
  single entry's computed offset lands exactly on a `PAC ` sub-archive
  header — no exceptions across 261 entries checked.

### Limits

- Size field is 16-bit, so a single injected sub-file is capped at
  65,535 bytes. This is a limit of the game's own format, not the tool.
- The tool writes your replacement bytes in as-is — it doesn't validate
  that they're a well-formed nested `PAC ` sub-archive. That's on the
  source file you provide.

## Credit

Built on format notes and community tooling from the SvR modding scene
(X-Packer, SvREditor, and various written tutorials), with the exact
byte layout confirmed directly against sample files.

## License

MIT — see [LICENSE](./LICENSE).
