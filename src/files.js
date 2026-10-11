import { useEffect, useState } from 'react';
import { getBlob } from './fileStore.js';

export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}

const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

// Как показывать файл: превью в просмотрщике и подпись-значок на плитке.
export function fileKind(node) {
  const mime = node.mime || '';
  const ext = extOf(node.name);
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('text/') || ['txt', 'md', 'csv', 'json', 'log'].includes(ext)) return 'text';
  return 'other';
}

const BADGES = [
  [['pdf'], '#e5484d'],
  [['doc', 'docx', 'rtf', 'odt', 'pages'], '#2f6db3'],
  [['xls', 'xlsx', 'csv', 'ods', 'numbers'], '#3f8a1f'],
  [['ppt', 'pptx', 'key', 'odp'], '#d9730d'],
  [['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac'], '#6650c6'],
  [['mp4', 'mov', 'webm', 'avi', 'mkv'], '#161616'],
];

export function fileBadge(node) {
  const ext = extOf(node.name);
  const color = BADGES.find(([exts]) => exts.includes(ext))?.[1] ?? '#7a7a7a';
  return { label: (ext || 'файл').slice(0, 4).toUpperCase(), color };
}

// Временная ссылка на содержимое файла из IndexedDB; освобождается при размонтировании.
export function useBlobUrl(id, enabled = true) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    let created = null;
    getBlob(id)
      .then((blob) => {
        if (!alive || !blob) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
      setUrl(null);
    };
  }, [id, enabled]);
  return url;
}

export function downloadFile(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
