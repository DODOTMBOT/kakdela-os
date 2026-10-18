// Отзывы с площадок через Rewio API (только чтение). Ключ берётся из переменной окружения
// REWIO_API_KEY и никогда не уходит в браузер: сервер сам забирает отзывы, хранит их у себя
// и отдаёт приложению уже готовый список.
//
// Синхронизация: при старте и каждые REWIO_SYNC_MINUTES минут. Отзывы складываются по id Rewio,
// поэтому повторная загрузка не создаёт дубликатов, а изменения (например, появившийся ответ) обновляются.

import fs from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.rewio.ru/v3/reviews';
const PAGE = 1000;
const MAX_PAGES = 20;
const MANUAL_COOLDOWN_MS = 2 * 60 * 1000;

// Площадки объекта: link_id → название. Можно переопределить через REWIO_LINKS="1360:Яндекс Карты,1359:2ГИС".
const DEFAULT_LINKS = '1360:Яндекс Карты,1359:2ГИС';

const parseLinks = (s) =>
  (s || DEFAULT_LINKS)
    .split(',')
    .map((part) => part.split(':'))
    .filter(([id]) => /^\d+$/.test(id?.trim()))
    .map(([id, name]) => ({ id: Number(id), name: (name || '').trim() || `Площадка ${id}` }));

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// Оставляем только то, что нужно приложению.
const pick = (r) => ({
  id: r.id,
  linkId: r.link_id,
  source: r.source_slug ?? r.provider ?? null,
  author: r.author ?? null,
  text: r.text ?? null,
  rating: typeof r.rating === 'number' ? r.rating : r.rating == null ? null : Number(r.rating),
  ratingOriginal: r.rating_original ?? null,
  url: r.review_url ?? null,
  date: r.review_date ?? null,
  replyText: r.reply_text ?? null,
  replyDate: r.reply_date ?? null,
  images: (r.images ?? []).map((i) => ({ preview: i.preview ?? i.image ?? null, image: i.image ?? i.preview ?? null })).filter((i) => i.image),
  deleted: Boolean(r.is_deleted),
});

export function createReviews({ env, auth, file, access }) {
  const key = env.REWIO_API_KEY;
  const objectId = Number(env.REWIO_OBJECT_ID || 817);
  const links = parseLinks(env.REWIO_LINKS);
  const everyMs = Math.max(5, Number(env.REWIO_SYNC_MINUTES || 30)) * 60 * 1000;

  let state = null;
  let running = null;
  let lastManual = 0;

  async function load() {
    if (!state) {
      try {
        state = JSON.parse(await fs.readFile(file, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        state = { reviews: {}, links: {}, lastSyncAt: null, lastError: null };
      }
    }
    return state;
  }

  const save = async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
  };

  async function fetchPage(linkId, offset) {
    const url = new URL(API);
    url.searchParams.set('object_id', String(objectId));
    url.searchParams.set('link_ids', String(linkId));
    url.searchParams.set('limit', String(PAGE));
    url.searchParams.set('offset', String(offset));
    const res = await fetch(url, { headers: { 'X-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = body?.detail || body?.error || body?.message || `Rewio ответил ${res.status}`;
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }
    return body;
  }

  async function syncLink(link, d) {
    let offset = 0;
    let first = null;
    let fetched = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await fetchPage(link.id, offset);
      first ??= body;
      for (const r of body.data ?? []) {
        d.reviews[r.id] = { ...pick(r), seenAt: new Date().toISOString() };
        fetched += 1;
      }
      if (!body.has_next || !(body.data ?? []).length) break;
      offset += body.data.length;
      // При ограниченном доступе дальше пробного окна API ничего не отдаст.
      if (body.access?.limit_per_link && offset >= body.access.limit_per_link) break;
    }
    d.links[link.id] = {
      name: link.name,
      fetched,
      total: first?.total ?? fetched,
      access: first?.access ?? null,
      collecting: first?.collecting ?? null,
      syncedAt: new Date().toISOString(),
    };
  }

  async function sync() {
    if (running) return running;
    running = (async () => {
      const d = await load();
      if (!key) {
        d.lastError = 'Не задан ключ Rewio (REWIO_API_KEY)';
        return d;
      }
      const errors = [];
      for (const link of links) {
        try {
          await syncLink(link, d);
        } catch (err) {
          errors.push(`${link.name}: ${err.message}`);
        }
      }
      d.lastSyncAt = new Date().toISOString();
      d.lastError = errors.length ? errors.join('; ') : null;
      await save();
      return d;
    })().finally(() => {
      running = null;
    });
    return running;
  }

  // Первая загрузка — вскоре после старта, затем по расписанию.
  setTimeout(() => sync().catch((err) => console.error('[reviews]', err)), 5_000).unref?.();
  setInterval(() => sync().catch((err) => console.error('[reviews]', err)), everyMs).unref?.();

  function view(d) {
    const reviews = Object.values(d.reviews)
      .filter((r) => !r.deleted)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return {
      reviews,
      links: links.map((l) => ({ id: l.id, name: l.name, ...(d.links[l.id] ?? {}) })),
      lastSyncAt: d.lastSyncAt,
      lastError: d.lastError,
      configured: Boolean(key),
      syncEveryMinutes: everyMs / 60000,
    };
  }

  const handler = async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/reviews' && url.pathname !== '/api/reviews/sync') return next();
    try {
      const origin = req.headers.origin;
      if (req.method !== 'GET' && origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Запрос с чужого сайта' });
      const user = await auth.userFrom(req);
      if (!user) return send(res, 401, { error: 'Нужно войти' });
      if (access && !(await access.allowed(user, 'reviews'))) return send(res, 403, { error: 'Раздел закрыт для вашей роли' });

      if (url.pathname === '/api/reviews' && req.method === 'GET') return send(res, 200, view(await load()));

      // Ручное обновление — не чаще раза в пару минут, чтобы не тратить лимиты Rewio.
      if (url.pathname === '/api/reviews/sync' && req.method === 'POST') {
        const wait = lastManual + MANUAL_COOLDOWN_MS - Date.now();
        if (wait > 0 && !running) return send(res, 429, { error: `Обновлять можно раз в 2 минуты — подождите ${Math.ceil(wait / 1000)} с` });
        lastManual = Date.now();
        return send(res, 200, view(await sync()));
      }
      return send(res, 405, { error: 'Метод не поддерживается' });
    } catch (err) {
      console.error('[reviews]', err);
      if (!res.headersSent) send(res, 500, { error: 'Не удалось получить отзывы' });
    }
  };

  return { handler, sync };
}
