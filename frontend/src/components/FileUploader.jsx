import React, { useState, useRef, useCallback } from 'react';
import { UploadCloud, X, FileText, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import styles from './FileUploader.module.css';
import { apiFetch } from '../lib/api';

const MAX_FILES = 10;
const MAX_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FileUploader = ({ onUploadSuccess }) => {
  const [pendingFiles, setPendingFiles] = useState([]);
  const [errors, setErrors] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const addFiles = useCallback((incoming) => {
    setErrors([]);
    setUploadResult(null);
    const newErrors = [];
    const valid = [];

    for (const file of Array.from(incoming)) {
      if (file.size > MAX_SIZE_BYTES) {
        newErrors.push(`"${file.name}" exceeds the 1 MB limit (${formatBytes(file.size)}).`);
        continue;
      }
      // Deduplicate by name + size + lastModified to avoid re-adding the same file
      const isDuplicate = pendingFiles.some(
        (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
      );
      if (isDuplicate) {
        newErrors.push(`"${file.name}" is already in the list.`);
        continue;
      }
      valid.push(file);
    }

    const combined = [...pendingFiles, ...valid];
    if (combined.length > MAX_FILES) {
      newErrors.push(`You can upload at most ${MAX_FILES} files. ${combined.length - MAX_FILES} file(s) were not added.`);
      setPendingFiles(combined.slice(0, MAX_FILES));
    } else {
      setPendingFiles(combined);
    }

    if (newErrors.length) setErrors(newErrors);
  }, [pendingFiles]);

  const removeFile = (name) => {
    setPendingFiles((prev) => prev.filter((f) => f.name !== name));
    setErrors([]);
    setUploadResult(null);
  };

  const handleInputChange = (e) => {
    if (e.target.files?.length) addFiles(e.target.files);
    // Reset input so the same file can be re-added after removal
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const handleUpload = async () => {
    if (!pendingFiles.length) return;
    setUploading(true);
    setErrors([]);
    setUploadResult(null);

    const form = new FormData();
    pendingFiles.forEach((f) => form.append('files', f));

    try {
      const res = await apiFetch('/api/files/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setErrors([data.detail || 'Upload failed.']);
      } else {
        setUploadResult(data);
        setPendingFiles([]);
        if (onUploadSuccess) onUploadSuccess(data);
      }
    } catch (err) {
      setErrors([err.message || 'Network error during upload.']);
    } finally {
      setUploading(false);
    }
  };

  const atLimit = pendingFiles.length >= MAX_FILES;

  return (
    <div className={styles.wrapper}>
      {/* Drop zone */}
      <div
        className={`${styles.dropzone} ${dragging ? styles.dragging : ''} ${atLimit ? styles.disabled : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!atLimit) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={atLimit ? undefined : handleDrop}
        onClick={() => !atLimit && inputRef.current?.click()}
        role="button"
        tabIndex={atLimit ? -1 : 0}
        onKeyDown={(e) => e.key === 'Enter' && !atLimit && inputRef.current?.click()}
        aria-label="Upload files"
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className={styles.hiddenInput}
          onChange={handleInputChange}
          disabled={atLimit}
        />
        <UploadCloud size={32} className={styles.dropIcon} />
        {atLimit ? (
          <p className={styles.dropText}>Maximum of {MAX_FILES} files reached.<br />Remove a file to add more.</p>
        ) : (
          <p className={styles.dropText}>
            Drag &amp; drop files here, or <span className={styles.browseLink}>browse</span>
            <br />
            <small>Up to {MAX_FILES} files · Max {formatBytes(MAX_SIZE_BYTES)} each</small>
          </p>
        )}
      </div>

      {/* Pending file list */}
      {pendingFiles.length > 0 && (
        <ul className={styles.fileList}>
          {pendingFiles.map((file) => (
            <li key={file.name} className={styles.fileItem}>
              <FileText size={16} className={styles.fileIcon} />
              <span className={styles.fileName}>{file.name}</span>
              <span className={styles.fileSize}>{formatBytes(file.size)}</span>
              <button
                className={styles.removeBtn}
                onClick={() => removeFile(file.name)}
                title={`Remove ${file.name}`}
                aria-label={`Remove ${file.name}`}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className={styles.errorBox}>
          <AlertCircle size={16} />
          <ul>
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* Success */}
      {uploadResult && (
        <div className={styles.successBox}>
          <CheckCircle size={16} />
          <span>Successfully uploaded {uploadResult.count} file(s). They will be processed shortly.</span>
        </div>
      )}

      {/* Upload button */}
      {pendingFiles.length > 0 && (
        <button
          className={styles.uploadBtn}
          onClick={handleUpload}
          disabled={uploading}
        >
          {uploading ? (
            <><Loader2 size={16} className={styles.spin} /> Uploading…</>
          ) : (
            <><UploadCloud size={16} /> Upload {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''}</>
          )}
        </button>
      )}
    </div>
  );
};

export default FileUploader;
