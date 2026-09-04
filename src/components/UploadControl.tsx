import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ingestFiles } from '../lib/ingest';
import { filesFromDataTransfer } from '../lib/dropFiles';
import './UploadControl.css';

/**
 * Wraps the map area with a drag-and-drop zone for whole folders, plus a folder-picker button
 * (`<input type="file" webkitdirectory multiple>`). Both paths feed the same ingest pipeline.
 */
export function UploadControl({ children }: { children: ReactNode }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) ingestFiles(files);
    e.target.value = '';
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const files = await filesFromDataTransfer(e.dataTransfer);
    if (files.length > 0) ingestFiles(files);
  }

  return (
    <div
      className="upload-control"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}

      <div className="upload-control__panel">
        <input
          ref={inputRef}
          type="file"
          // @ts-expect-error non-standard attribute, supported by Chrome/Edge/Firefox
          webkitdirectory="true"
          directory="true"
          multiple
          onChange={handleFileInputChange}
          aria-label="Select a photo folder"
          style={{ display: 'none' }}
        />
        <button type="button" onClick={() => inputRef.current?.click()}>
          Select folder…
        </button>
      </div>

      {isDragOver && (
        <div className="upload-control__overlay" aria-hidden="true">
          Drop folder to import
        </div>
      )}
    </div>
  );
}
