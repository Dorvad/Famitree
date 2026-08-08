import { useEffect, useRef, useState } from 'react';

import { mediaUrl } from '../api/client.ts';
import { useUploadMedia } from '../api/hooks.ts';
import styles from './PortraitPicker.module.css';

interface PortraitPickerProps {
  /** Currently attached portrait, if any. */
  mediaId: string | null;
  /** Called with the new media id, or null when the portrait is removed. */
  onChange: (mediaId: string | null) => void;
  /** Shown inside the empty frame. */
  label?: string;
  onError?: (message: string) => void;
}

/**
 * Uploads a portrait and reports back the stored media id.
 *
 * The upload happens immediately on selection rather than being deferred to a
 * form submit: the person may not exist yet when the picture is chosen, and the
 * media record is independent of them either way. The caller decides when to
 * attach the returned id.
 */
export function PortraitPicker({
  mediaId,
  onChange,
  label = 'הוסיפו תצלום',
  onError,
}: PortraitPickerProps): React.JSX.Element {
  const upload = useUploadMedia();
  const [dragging, setDragging] = useState(false);

  // While the upload is in flight the local file is shown, so the frame fills
  // the moment a picture is chosen rather than after the round trip.
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  function showLocally(file: File): void {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    setLocalPreview(url);
  }

  async function accept(file: File | undefined): Promise<void> {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onError?.('לתצלום צריך קובץ תמונה.');
      return;
    }
    showLocally(file);
    try {
      const media = await upload.mutateAsync(file);
      onChange(media.id);
    } catch (cause) {
      setLocalPreview(null);
      onError?.(cause instanceof Error ? cause.message : 'ההעלאה נכשלה.');
    }
  }

  const src = localPreview ?? mediaUrl(mediaId);
  const filled = Boolean(src);

  return (
    <div
      className={[styles.frame, filled && styles.filled, dragging && styles.dragging]
        .filter(Boolean)
        .join(' ')}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void accept(event.dataTransfer.files[0]);
      }}
    >
      {src ? (
        <>
          <img className={styles.image} src={src} alt="" />
          <span className={styles.tape} aria-hidden="true" />
          <button
            type="button"
            className={styles.remove}
            onClick={() => {
              if (objectUrl.current) {
                URL.revokeObjectURL(objectUrl.current);
                objectUrl.current = null;
              }
              setLocalPreview(null);
              onChange(null);
            }}
          >
            הסירו
          </button>
        </>
      ) : (
        <>
          <span className={styles.icon} aria-hidden="true">
            ↑
          </span>
          <span className={styles.hint}>{label}</span>
        </>
      )}

      {/* Kept last so it sits above the print and stays clickable. */}
      <input
        className={styles.input}
        type="file"
        accept="image/*"
        aria-label={label}
        onChange={(event) => {
          void accept(event.target.files?.[0]);
          // Clearing lets the same file be picked again after a removal.
          event.target.value = '';
        }}
      />

      {upload.isPending && <span className={styles.busy}>מעלים…</span>}
    </div>
  );
}
