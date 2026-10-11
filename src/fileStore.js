// Содержимое файлов раздела «Документы» хранится на сервере и доступно всем пользователям.
// Скачанные файлы кэшируются на время сессии, чтобы превью не загружались повторно.

const cache = new Map();

const url = (id) => `/api/files/${encodeURIComponent(id)}`;

export async function putBlob(id, blob) {
  const res = await fetch(url(id), {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Не удалось загрузить файл (${res.status})`);
  }
  cache.set(id, blob);
}

export async function getBlob(id) {
  if (cache.has(id)) return cache.get(id);
  const res = await fetch(url(id), { credentials: 'same-origin' });
  if (!res.ok) return null;
  const blob = await res.blob();
  cache.set(id, blob);
  return blob;
}

export async function deleteBlobs(ids) {
  await Promise.all(
    ids.map((id) => {
      cache.delete(id);
      return fetch(url(id), { method: 'DELETE', credentials: 'same-origin' });
    }),
  );
}

// Файлы, загруженные до появления общего хранилища, лежат в IndexedDB этого браузера —
// переносим их на сервер один раз, вместе с остальными данными.
export async function migrateLegacyBlobs(ids) {
  if (!ids.length || !('indexedDB' in window)) return;
  const db = await new Promise((resolve) => {
    const req = indexedDB.open('ledger-files');
    req.onupgradeneeded = () => req.transaction.abort(); // базы не было — переносить нечего
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  if (!db?.objectStoreNames.contains('blobs')) return db?.close();
  for (const id of ids) {
    const blob = await new Promise((resolve) => {
      const q = db.transaction('blobs').objectStore('blobs').get(id);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => resolve(null);
    });
    if (blob) await putBlob(id, blob).catch(() => {});
  }
  db.close();
}
