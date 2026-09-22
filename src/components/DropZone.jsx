import { useRef, useState } from 'react';
import { fmtBytes } from '../lib/pacFormat';

export default function DropZone({ label, hint, onFile, fileInfo, onClear }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);

  const handleFiles = (files) => {
    if (files && files[0]) onFile(files[0]);
  };

  if (fileInfo) {
    return (
      <div className="fileinfo">
        <span className="name">{fileInfo.name}</span>
        <span className="meta">{fmtBytes(fileInfo.size)}</span>
        <button className="clear" onClick={onClear} title="Remove">
          ✕
        </button>
      </div>
    );
  }

  return (
    <div
      className={'drop' + (drag ? ' drag' : '')}
      onClick={() => inputRef.current && inputRef.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
    >
      <input ref={inputRef} type="file" onChange={(e) => handleFiles(e.target.files)} />
      <div className="label">{label}</div>
      <div className="hint">{hint}</div>
    </div>
  );
}
