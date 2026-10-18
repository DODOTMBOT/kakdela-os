// Общие данные приложения: у каждого раздела свой ключ (ledger:tasks:v1 и т. п.) с версией.
// Клиент присылает изменения с версией, от которой он считал; если кто-то успел раньше —
// сервер отвечает 409 с актуальным значением, клиент объединяет правки и повторяет.
// Об изменениях всем открытым вкладкам сообщается через SSE.
// Файлы раздела «Документы» хранятся здесь же на диске.

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

const KEY_RE = /^ledger:[a-z0-9:-]{1,60}$/;
const FILE_ID_RE = /^[a-z0-9]{6,40}$/;
const MAX_DATA = 5 * 1024 * 1024;
const MAX_FILE = 50 * 1024 * 1024;
// Эти типы безопасно показывать прямо в браузере; остальное отдаём только на скачивание.
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|avif)|video\/(mp4|webm|quicktime)|audio\/[a-z0-9.+-]+|application\/pdf)$/;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// validators — правила для отдельных разделов (см. rules.js);
// onSaved(key, prev, next, user) — после сохранения, возвращает id пользователей, которым пришли оповещения.
// guard(key, user, read, next) — общая проверка доступа к разделу перед сохранением (см. access.js).
export function createData({ dir, auth, validators = {}, onSaved, guard }) {
  const kvDir = path.join(dir, 'kv');
  const filesDir = path.join(dir, 'files');
  const docs = new Map();
  const clients = new Set();
  let chain = Promise.resolve();

  const ready = (async () => {
    await fs.mkdir(kvDir, { recursive: true });
    await fs.mkdir(filesDir, { recursive: true });
    for (const name of await fs.readdir(kvDir)) {
      if (!name.endsWith('.json')) continue;
      const doc = JSON.parse(await fs.readFile(path.join(kvDir, name), 'utf8'));
      if (KEY_RE.test(doc.key)) docs.set(doc.key, doc);
    }
  })();

  const persist = (doc) => {
    chain = chain.then(async () => {
      const file = path.join(kvDir, `${doc.key.replace(/:/g, '_')}.json`);
      await fs.writeFile(`${file}.tmp`, JSON.stringify(doc), { mode: 0o600 });
      await fs.rename(`${file}.tmp`, file);
    });
    return chain;
  };

  const broadcast = (payload) => {
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const c of clients) c.res.write(line);
  };
  const pushTo = (userIds, payload) => {
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const c of clients) if (userIds.includes(c.userId)) c.res.write(line);
  };

  const view = (doc) => ({ value: doc.value, version: doc.version, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy });

  async function handleData(req, res, url, user) {
    if (url.pathname === '/api/data' && req.method === 'GET') {
      return send(res, 200, Object.fromEntries([...docs].map(([k, d]) => [k, view(d)])));
    }

    if (url.pathname === '/api/data/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': ok\n\n');
      const client = { res, userId: user.id };
      clients.add(client);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(client);
      });
      return true;
    }

    const m = url.pathname.match(/^\/api\/data\/([^/]+)$/);
    if (!m) return false;
    const key = decodeURIComponent(m[1]);
    if (!KEY_RE.test(key)) return send(res, 400, { error: 'Неизвестный раздел данных' });

    if (req.method === 'GET') {
      const doc = docs.get(key);
      return send(res, 200, doc ? view(doc) : { value: null, version: 0 });
    }

    if (req.method === 'PUT') {
      let body;
      try {
        body = JSON.parse((await readBody(req, MAX_DATA)).toString('utf8'));
      } catch (err) {
        return send(res, err.status || 400, { error: err.status ? err.message : 'Некорректные данные' });
      }
      const current = docs.get(key);
      const version = current?.version ?? 0;
      if (body.baseVersion !== version) return send(res, 409, current ? view(current) : { value: null, version: 0 });
      const problem = guard?.(key, user, (k) => docs.get(k)?.value ?? null, body.value) || validators[key]?.(current?.value ?? null, body.value, user);
      if (problem) return send(res, 403, { error: problem });
      const doc = { key, value: body.value, version: version + 1, updatedAt: new Date().toISOString(), updatedBy: user.name };
      docs.set(key, doc);
      await persist(doc);
      broadcast({ key, version: doc.version, by: user.id });
      try {
        const notified = (await onSaved?.(key, current?.value ?? null, body.value, user)) ?? [];
        if (notified.length) pushTo(notified, { type: 'notifications' });
      } catch (err) {
        console.error('[notifications]', err);
      }
      return send(res, 200, { version: doc.version });
    }
    return send(res, 405, { error: 'Метод не поддерживается' });
  }

  async function handleFile(req, res, url) {
    const m = url.pathname.match(/^\/api\/files\/([^/]+)$/);
    if (!m) return false;
    const id = m[1];
    if (!FILE_ID_RE.test(id)) return send(res, 400, { error: 'Некорректный файл' });
    const file = path.join(filesDir, id);
    const metaFile = `${file}.meta.json`;

    if (req.method === 'PUT') {
      const type = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 120);
      const size = Number(req.headers['content-length'] || 0);
      if (size > MAX_FILE) return send(res, 413, { error: 'Файл больше 50 МБ' });
      let buf;
      try {
        buf = await readBody(req, MAX_FILE);
      } catch (err) {
        return send(res, err.status || 400, { error: err.message });
      }
      await fs.writeFile(file, buf, { mode: 0o600 });
      await fs.writeFile(metaFile, JSON.stringify({ type, size: buf.length }), { mode: 0o600 });
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET') {
      let meta;
      try {
        meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
      } catch {
        return send(res, 404, { error: 'Файл не найден' });
      }
      const inline = INLINE_TYPES.test(meta.type);
      res.statusCode = 200;
      res.setHeader('Content-Type', inline ? meta.type : 'application/octet-stream');
      res.setHeader('Content-Length', meta.size);
      res.setHeader('Content-Disposition', inline ? 'inline' : 'attachment');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Даже если открыть файл напрямую, скрипты в нём не выполнятся.
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      createReadStream(file).pipe(res);
      return true;
    }

    if (req.method === 'DELETE') {
      await fs.rm(file, { force: true });
      await fs.rm(metaFile, { force: true });
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Метод не поддерживается' });
  }

  const handler = async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    const isData = url.pathname === '/api/data' || url.pathname.startsWith('/api/data/');
    const isFile = url.pathname.startsWith('/api/files/');
    if (!isData && !isFile) return next();
    try {
      const origin = req.headers.origin;
      if (req.method !== 'GET' && origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Запрос с чужого сайта' });
      await ready;
      const user = await auth.userFrom(req);
      if (!user) return send(res, 401, { error: 'Нужно войти' });
      const handled = isData ? await handleData(req, res, url, user) : await handleFile(req, res, url);
      if (handled === false) send(res, 404, { error: 'Не найдено' });
    } catch (err) {
      console.error('[data]', err);
      if (!res.headersSent) send(res, 500, { error: 'Ошибка сервера' });
    }
  };

  // Файл из хранилища для серверного кода (например, для экранов ТВ): путь, тип и размер.
  const fileInfo = async (id) => {
    if (!FILE_ID_RE.test(id)) return null;
    const file = path.join(filesDir, id);
    try {
      const meta = JSON.parse(await fs.readFile(`${file}.meta.json`, 'utf8'));
      return { path: file, type: meta.type, size: meta.size };
    } catch {
      return null;
    }
  };

  // Чтение раздела из серверного кода (например, курсов — для проверки тестов).
  const get = async (key) => {
    await ready;
    return docs.get(key)?.value ?? null;
  };

  return { handler, get, fileInfo };
}
