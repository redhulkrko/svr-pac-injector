import { useState, useMemo, useCallback } from 'react';
import JSZip from 'jszip';
import DropZone from './components/DropZone';
import { parseArchive, injectEntry, extractAllEntries, fmtBytes, hex } from './lib/pacFormat';

export default function App() {
  const [theme, setTheme] = useState('dark');

  const [archiveFile, setArchiveFile] = useState(null); // {name, size}
  const [archiveBuf, setArchiveBuf] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [parseError, setParseError] = useState(null);

  const [payloadFile, setPayloadFile] = useState(null);
  const [payloadBuf, setPayloadBuf] = useState(null);

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [checkedIds, setCheckedIds] = useState(() => new Set());

  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState(null);

  const handleArchiveFile = useCallback(async (file) => {
    setError(null); setResult(null); setParseError(null); setSelectedId(null); setCheckedIds(new Set());
    const buf = await file.arrayBuffer();
    setArchiveFile({ name: file.name, size: file.size });
    setArchiveBuf(buf);
    try {
      setParsed(parseArchive(buf));
    } catch (e) {
      setParsed(null);
      setParseError(e.message);
    }
  }, []);

  const clearArchive = () => {
    setArchiveFile(null); setArchiveBuf(null); setParsed(null);
    setParseError(null); setSelectedId(null); setCheckedIds(new Set()); setResult(null); setError(null);
  };

  const handlePayloadFile = useCallback(async (file) => {
    setResult(null); setError(null);
    const buf = await file.arrayBuffer();
    setPayloadFile({ name: file.name, size: file.size });
    setPayloadBuf(buf);
  }, []);

  const clearPayload = () => {
    setPayloadFile(null); setPayloadBuf(null); setResult(null); setError(null);
  };

  const filteredEntries = useMemo(() => {
    if (!parsed) return [];
    const q = search.trim();
    if (!q) return parsed.entries;
    return parsed.entries.filter((e) => e.id.includes(q));
  }, [parsed, search]);

  const selectedEntry = useMemo(() => {
    if (!parsed || !selectedId) return null;
    return parsed.entries.find((e) => e.id === selectedId) || null;
  }, [parsed, selectedId]);

  const isV2 = parsed?.format === 'v2';
  const canInject = Boolean(isV2 && parsed && selectedEntry && payloadBuf && archiveBuf);

  const doInject = () => {
    setError(null); setResult(null);
    try {
      const { buffer, newOffset, newBlk } = injectEntry(archiveBuf, selectedEntry, payloadBuf);
      const blob = new Blob([buffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const baseName = archiveFile.name.replace(/(\.[^.]+)$/, '');
      const ext = (archiveFile.name.match(/\.[^.]+$/) || ['.pac'])[0];
      const filename = baseName + '_modded' + ext;
      setResult({
        blobUrl: url,
        filename,
        info: {
          entryId: selectedEntry.id,
          oldOffset: selectedEntry.offset,
          oldSize: selectedEntry.size,
          newOffset,
          newBlk,
          newSize: payloadBuf.byteLength,
          totalSize: buffer.byteLength,
        },
      });
    } catch (e) {
      setError(e.message);
    }
  };

  const toggleChecked = (id) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleCheckAllFiltered = () => {
    setCheckedIds((prev) => {
      const allChecked = filteredEntries.length > 0 && filteredEntries.every((e) => prev.has(e.id));
      const next = new Set(prev);
      if (allChecked) {
        filteredEntries.forEach((e) => next.delete(e.id));
      } else {
        filteredEntries.forEach((e) => next.add(e.id));
      }
      return next;
    });
  };

  const downloadZip = async (entriesToZip, filenameSuffix) => {
    const files = extractAllEntries(archiveBuf, entriesToZip);
    const zip = new JSZip();
    for (const [filename, bytes] of Object.entries(files)) {
      zip.file(filename, bytes);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const baseName = archiveFile.name.replace(/(\.[^.]+)$/, '');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}_${filenameSuffix}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const extractAll = async () => {
    if (!archiveBuf || !parsed) return;
    setExtracting(true);
    setExtractError(null);
    try {
      await downloadZip(parsed.entries, 'extracted');
    } catch (e) {
      setExtractError(e.message);
    } finally {
      setExtracting(false);
    }
  };

  const extractChecked = async () => {
    if (!archiveBuf || !parsed || checkedIds.size === 0) return;
    setExtracting(true);
    setExtractError(null);
    try {
      const chosen = parsed.entries.filter((e) => checkedIds.has(e.id));
      await downloadZip(chosen, 'selected');
    } catch (e) {
      setExtractError(e.message);
    } finally {
      setExtracting(false);
    }
  };

  const extractSelected = () => {
    if (!archiveBuf || !selectedEntry) return;
    const bytes = new Uint8Array(archiveBuf, selectedEntry.offset, selectedEntry.size);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedEntry.id + '.pac';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  return (
    <div className="app" data-theme={theme}>
      <header className="top">
        <div>
          <h1>
            ch<span>.pac</span> injector
          </h1>
          <div className="sub">SvR 2010 (PSP) — character archive patcher</div>
        </div>
        <button className="theme-toggle" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </header>

      {/* Step 1 */}
      <div className="panel">
        <h2><span className="step-num">1</span>Load your archive</h2>
        <DropZone
          label="Drop ch.pac, CH2.PAC or CH3.PAC here"
          hint="click to browse · stays in your browser, nothing is uploaded"
          fileInfo={archiveFile}
          onFile={handleArchiveFile}
          onClear={clearArchive}
        />
        {parseError && <div className="warn">{parseError}</div>}
        {parsed && (
          <div className="selected-summary" style={{ marginTop: 14 }}>
            <div className="kv">
              <div className="k">FORMAT</div>
              <div className="v">
                {parsed.magic} / {parsed.tableTag} ({isV2 ? 'block-addressed' : 'sequential'})
              </div>
            </div>
            <div className="kv">
              <div className="k">ENTRIES</div>
              <div className="v">{parsed.entries.length}</div>
            </div>
            <div className="kv">
              <div className="k">FILE SIZE</div>
              <div className="v">{fmtBytes(parsed.fileLength)}</div>
            </div>
          </div>
        )}
        {parsed && !isV2 && (
          <div className="warn" style={{ marginTop: 14, color: 'var(--text-dim)', background: 'var(--panel-2)', borderColor: 'var(--line)' }}>
            This is the older <code>DPAC</code> format — extraction is fully supported below, but
            injection isn't (entries here don't carry their own offset, so a resize means rebuilding
            the whole data region, not just this one). Steps 3–4 are disabled for this file.
          </div>
        )}
      </div>

      {/* Step 2 */}
      <div className={'panel' + (parsed ? '' : ' disabled-panel')}>
        <h2><span className="step-num">2</span>Pick the entry to overwrite</h2>
        {!parsed ? (
          <div className="placeholder">Load an archive first.</div>
        ) : (
          <>
            <div className="action-row" style={{ marginTop: 0, marginBottom: 12 }}>
              <input
                className="search"
                style={{ marginBottom: 0, flex: 1 }}
                placeholder="Filter by ID, e.g. 0200 or 00010201"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="ghost" onClick={extractChecked} disabled={extracting || checkedIds.size === 0}>
                {extracting ? 'Zipping…' : `Extract selected (${checkedIds.size})`}
              </button>
              <button className="ghost" onClick={extractAll} disabled={extracting}>
                {extracting ? 'Zipping…' : `Extract all (${parsed.entries.length})`}
              </button>
            </div>
            {extractError && <div className="warn">{extractError}</div>}
            <div className="entry-table-wrap">
              <table className="entries">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>
                      <input
                        type="checkbox"
                        checked={filteredEntries.length > 0 && filteredEntries.every((e) => checkedIds.has(e.id))}
                        onChange={toggleCheckAllFiltered}
                      />
                    </th>
                    <th>ID</th>
                    {isV2 && <th className="num">BLOCK</th>}
                    <th className="num">OFFSET</th>
                    <th className="num">SIZE</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((e) => (
                    <tr
                      key={e.id}
                      className={e.id === selectedId ? 'selected' : ''}
                      onClick={() => { setSelectedId(e.id); setResult(null); setError(null); }}
                    >
                      <td onClick={(ev) => ev.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={checkedIds.has(e.id)}
                          onChange={() => toggleChecked(e.id)}
                        />
                      </td>
                      <td>{e.id}</td>
                      {isV2 && <td className="num">{e.blk}</td>}
                      <td className="num">{hex(e.offset)}</td>
                      <td className="num">{e.size} B</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {selectedEntry && (
              <div className="selected-summary">
                <div className="kv">
                  <div className="k">SELECTED</div>
                  <div className="v">{selectedEntry.id}</div>
                </div>
                <div className="kv">
                  <div className="k">CURRENT OFFSET</div>
                  <div className="v">{hex(selectedEntry.offset)}</div>
                </div>
                <div className="kv">
                  <div className="k">CURRENT SIZE</div>
                  <div className="v">{selectedEntry.size} bytes</div>
                </div>
                <button className="ghost" onClick={extractSelected} style={{ marginLeft: 'auto' }}>
                  Extract current bytes
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Step 3 */}
      <div className={'panel' + (selectedEntry && isV2 ? '' : ' disabled-panel')}>
        <h2><span className="step-num">3</span>Upload the replacement .pac</h2>
        {!isV2 ? (
          <div className="placeholder">Not available for this archive format (see note above).</div>
        ) : !selectedEntry ? (
          <div className="placeholder">Pick a target entry first.</div>
        ) : (
          <DropZone
            label="Drop your replacement sub-archive (e.g. 0001.pac)"
            hint="this is what will be written into the selected slot"
            fileInfo={payloadFile}
            onFile={handlePayloadFile}
            onClear={clearPayload}
          />
        )}
      </div>

      {/* Step 4 */}
      <div className={'panel' + (canInject ? '' : ' disabled-panel')}>
        <h2><span className="step-num">4</span>Inject &amp; download</h2>
        <div className="placeholder" style={{ marginBottom: 6 }}>
          {!isV2 && parsed
            ? 'Not available for this archive format.'
            : canInject
            ? `New data is appended at the true end of the file (2048-byte aligned) and entry ${selectedEntry.id} is repointed to it — nothing else in the archive is touched.`
            : 'Complete steps 1–3 first.'}
        </div>
        <div className="action-row">
          <button className="primary" disabled={!canInject} onClick={doInject}>
            Inject and build new copy
          </button>
          {result && (
            <a href={result.blobUrl} download={result.filename} className="ghost" style={{ textDecoration: 'none' }}>
              Download {result.filename}
            </a>
          )}
        </div>
        {error && <div className="warn">{error}</div>}
        {result && (
          <div className="ok">
            {result.info.entryId}: {result.info.oldSize} B @ {hex(result.info.oldOffset)} →{' '}
            {result.info.newSize} B @ {hex(result.info.newOffset)} (block {result.info.newBlk})
            <br />
            New file size: {fmtBytes(result.info.totalSize)}
          </div>
        )}
      </div>

      <div className="footnote">
        Two archive formats are auto-detected from the header magic. <code>DPK8</code> (SvR 2010/2011):
        table at <code>0x800</code>, 12-byte entries (8-digit ASCII ID + u16 block index + u16 size),
        real offset = <code>0x4000 + block × 2048</code> — each entry independently addressed, so
        injection just appends and repoints. <code>DPAC</code> (older titles): 4-byte entries (u16 ID +
        u16 size-in-256-byte-units), no offset field — each entry's position is a running total from
        the one before it, so this tool extracts from it but doesn't inject into it yet. Both verified
        byte-for-byte against real files. Injection payloads are written in as-is (need to already be
        in the internal format the game expects), and the V2 size field is capped at 65535 bytes — a
        format limit, not a tool limit.
      </div>
    </div>
  );
}
