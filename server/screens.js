// Управление ТВ: экраны меню-бордов и плейлисты.
//
// Экран подключается без ссылок с секретами: телевизор один раз открывает /tv и показывает
// 6-значный код, руководитель вводит его в разделе «Управление ТВ». После этого экран получает
// собственный ключ (httpOnly-cookie kd_tv, на сервере хранится только его хэш) и дальше работает сам:
// забирает плейлисты, держит живое соединение (SSE) и мгновенно получает изменения.
// Отключить экран можно из панели — ключ перестаёт действовать, и телевизор снова показывает код.
//
// Файлы для экрана отдаются только те, что стоят в его плейлистах (/api/tv/media/:id).

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { pageAllowed, ACCESS_KEY } from './access.js';

const COOKIE = 'kd_tv';
const COOKIE_DAYS = 400;
const PAIR_TTL_MS = 15 * 60 * 1000;
const ONLINE_MS = 75 * 1000;
const MAX_BODY = 256 * 1024;
const ID_RE = /^[a-z0-9]{4,40}$/i;
const FILE_ID_RE = /^[a-z0-9]{6,40}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ROTATIONS = [0, 90, 180, 270];
const TYPES = ['image', 'video', 'menu', 'text'];

const sha = (s) => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const newId = (p) => `${p}${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
const now = () => new Date().toISOString();
const fail = (status, message) => Object.assign(new Error(message), { status });

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(fail(413, 'Слишком большой запрос'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(fail(400, 'Некорректный запрос'));
      }
    });
    req.on('error', reject);
  });
}

function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

const str = (v, max) => String(v ?? '').trim().slice(0, max);

// Слайд из панели — только известные поля и разумные значения.
function cleanItem(raw) {
  const type = TYPES.includes(raw?.type) ? raw.type : null;
  if (!type) throw fail(400, 'Неизвестный тип слайда');
  const item = { id: ID_RE.test(raw.id) ? raw.id : newId('s'), type, duration: Math.min(600, Math.max(3, Math.round(Number(raw.duration) || 10))) };
  if (type === 'image' || type === 'video') {
    if (!FILE_ID_RE.test(raw.fileId ?? '')) throw fail(400, 'У слайда нет файла');
    item.fileId = raw.fileId;
    item.name = str(raw.name, 160);
    item.fit = raw.fit === 'contain' ? 'contain' : 'cover';
    if (type === 'video') item.untilEnd = raw.untilEnd !== false;
  }
  if (type === 'menu') {
    if (!str(raw.menuId, 60)) throw fail(400, 'Выберите меню для слайда');
    item.menuId = str(raw.menuId, 60);
    item.showPrices = raw.showPrices !== false;
    item.showDescriptions = Boolean(raw.showDescriptions);
  }
  if (type === 'text') {
    item.title = str(raw.title, 140);
    item.text = str(raw.text, 500);
    if (!item.title && !item.text) throw fail(400, 'Текстовый слайд пуст');
  }
  if ((type === 'menu' || type === 'text') && raw.style && typeof raw.style === 'object') item.style = cleanStyle(raw.style);
  return item;
}

// Оформление слайда меню или текста — только известные поля.
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const PRESETS = ['classic', 'light', 'coffee', 'green'];
const FONTS = ['sans', 'serif', 'condensed', 'rounded'];
function cleanStyle(raw) {
  const st = { preset: PRESETS.includes(raw.preset) ? raw.preset : 'classic' };
  for (const k of ['bg', 'fg', 'accent']) if (COLOR_RE.test(raw[k] ?? '')) st[k] = raw[k].toLowerCase();
  if (FILE_ID_RE.test(raw.bgImageId ?? '')) {
    st.bgImageId = raw.bgImageId;
    st.overlay = Math.min(90, Math.max(0, Math.round(Number(raw.overlay) || 0)));
  }
  if (FONTS.includes(raw.font)) st.font = raw.font;
  if ([0, 1, 2, 3].includes(Number(raw.columns))) st.columns = Number(raw.columns);
  st.align = raw.align === 'center' ? 'center' : 'left';
  st.logo = Boolean(raw.logo);
  const title = str(raw.title, 80);
  if (title) st.title = title;
  return st;
}

function cleanSchedule(list, playlistIds) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 20).map((r) => {
    if (!playlistIds.has(r?.playlistId)) throw fail(400, 'В расписании выбран несуществующий плейлист');
    if (!TIME_RE.test(r.from ?? '') || !TIME_RE.test(r.to ?? '') || r.from === r.to) throw fail(400, 'Время в расписании — в формате ЧЧ:ММ, начало и конец разные');
    const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : [];
    return { id: ID_RE.test(r.id ?? '') ? r.id : newId('r'), playlistId: r.playlistId, from: r.from, to: r.to, days: days.length ? days : [0, 1, 2, 3, 4, 5, 6] };
  });
}

// Меню для экрана — только то, что нужно показать.
function menuForScreen(menu) {
  return {
    id: menu.id,
    name: menu.name ?? '',
    categories: (menu.categories ?? []).map((c) => ({
      id: c.id,
      name: c.name ?? '',
      dishes: (c.dishes ?? []).map((d) => ({ id: d.id, name: d.name ?? '', price: d.price ?? null, weight: d.weight ?? '', description: d.description ?? '' })),
    })),
  };
}

// version — версия собранного сайта: если экран видит новую, он перезагружается сам (после обновления сайта).
export function createScreens({ file, auth, data, secure = false, version = 'dev' }) {
  let state = null;
  let chain = Promise.resolve();
  const streams = new Map(); // screenId → Set(res)
  const pairHits = new Map(); // ip → [timestamps]

  async function load() {
    if (!state) {
      try {
        state = JSON.parse(await fs.readFile(file, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        state = { screens: [], playlists: [], pairings: [] };
      }
    }
    const t = Date.now();
    state.pairings = state.pairings.filter((p) => Date.parse(p.expiresAt) > t);
    return state;
  }

  const save = () => {
    chain = chain.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
      await fs.rename(`${file}.tmp`, file);
    });
    return chain;
  };

  const push = (screenId, payload) => {
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of streams.get(screenId) ?? []) res.write(line);
  };
  const pushAll = (payload) => {
    for (const id of streams.keys()) push(id, payload);
  };

  const playlistIdsOf = (screen) => new Set([screen.defaultPlaylist, ...(screen.schedule ?? []).map((r) => r.playlistId)].filter(Boolean));

  const online = (s) => streams.has(s.id) || (s.lastSeenAt && Date.now() - Date.parse(s.lastSeenAt) < ONLINE_MS);
  const publicScreen = (s) => ({
    id: s.id,
    name: s.name,
    location: s.location ?? '',
    rotation: s.rotation ?? 0,
    defaultPlaylist: s.defaultPlaylist ?? null,
    schedule: s.schedule ?? [],
    pairedAt: s.pairedAt,
    lastSeenAt: s.lastSeenAt ?? null,
    online: online(s),
    device: s.device ?? '',
    waiting: !s.tokenHash, // код введён, экран ещё не забрал ключ
  });

  async function screenFrom(req) {
    const raw = cookieValue(req, COOKIE);
    if (!raw) return null;
    const d = await load();
    return d.screens.find((s) => s.tokenHash && s.tokenHash === sha(raw)) ?? null;
  }

  const setCookie = (res, value, maxAge) =>
    res.setHeader('Set-Cookie', `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/api/tv; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);

  async function managerFrom(req) {
    const user = await auth.userFrom(req);
    if (!user) throw fail(401, 'Нужно войти');
    if (user.role !== 'admin' && user.role !== 'manager') throw fail(403, 'Экранами управляют руководители');
    if (!pageAllowed(await data.get(ACCESS_KEY), user, 'tv')) throw fail(403, 'Раздел закрыт для вашей роли');
    return user;
  }

  // Состояние для экрана: его настройки, нужные плейлисты и меню.
  async function stateFor(screen) {
    const d = await load();
    const ids = playlistIdsOf(screen);
    const playlists = d.playlists.filter((p) => ids.has(p.id));
    const menuIds = new Set(playlists.flatMap((p) => p.items.filter((i) => i.type === 'menu').map((i) => i.menuId)));
    const allMenus = (await data.get('ledger:menus:v1')) ?? [];
    const menus = Object.fromEntries((Array.isArray(allMenus) ? allMenus : []).filter((m) => menuIds.has(m.id)).map((m) => [m.id, menuForScreen(m)]));
    return {
      screen: { id: screen.id, name: screen.name, location: screen.location ?? '', rotation: screen.rotation ?? 0, defaultPlaylist: screen.defaultPlaylist ?? null, schedule: screen.schedule ?? [] },
      playlists: Object.fromEntries(playlists.map((p) => [p.id, { id: p.id, name: p.name, items: p.items }])),
      menus,
      version,
      serverTime: now(),
    };
  }

  const handler = async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/tv/')) return next();
    const { pathname } = url;
    const method = req.method;
    try {
      // ---------- Телевизор ----------

      // Новый код подключения.
      if (pathname === '/api/tv/pair' && method === 'POST') {
        const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '';
        const hits = (pairHits.get(ip) ?? []).filter((t) => Date.now() - t < 10 * 60 * 1000);
        if (hits.length >= 30) throw fail(429, 'Слишком много попыток — подождите несколько минут');
        pairHits.set(ip, [...hits, Date.now()]);
        const d = await load();
        let code;
        do code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        while (d.pairings.some((p) => p.code === code));
        const secret = token();
        d.pairings.push({ code, secretHash: sha(secret), createdAt: now(), expiresAt: new Date(Date.now() + PAIR_TTL_MS).toISOString(), screenId: null, device: str(req.headers['user-agent'], 200) });
        await save();
        return send(res, 200, { code, secret, expiresAt: d.pairings.at(-1).expiresAt });
      }

      // Телевизор ждёт, пока код введут в панели; после этого получает ключ один раз.
      const pairStatus = pathname.match(/^\/api\/tv\/pair\/(\d{6})$/);
      if (pairStatus && method === 'GET') {
        const d = await load();
        const p = d.pairings.find((x) => x.code === pairStatus[1]);
        if (!p || p.secretHash !== sha(url.searchParams.get('secret') ?? '')) return send(res, 404, { error: 'Код устарел' });
        if (!p.screenId) return send(res, 200, { paired: false });
        const screen = d.screens.find((s) => s.id === p.screenId);
        if (!screen) return send(res, 404, { error: 'Код устарел' });
        const raw = token();
        screen.tokenHash = sha(raw);
        screen.pairedAt = now();
        screen.device = p.device;
        d.pairings = d.pairings.filter((x) => x !== p);
        await save();
        setCookie(res, raw, COOKIE_DAYS * 24 * 3600);
        return send(res, 200, { paired: true });
      }

      if (pathname === '/api/tv/state' && method === 'GET') {
        const screen = await screenFrom(req);
        if (!screen) return send(res, 401, { error: 'Экран не подключён' });
        screen.lastSeenAt = now();
        const raw = cookieValue(req, COOKIE);
        setCookie(res, raw, COOKIE_DAYS * 24 * 3600); // продлеваем ключ
        save();
        return send(res, 200, await stateFor(screen));
      }

      if (pathname === '/api/tv/stream' && method === 'GET') {
        const screen = await screenFrom(req);
        if (!screen) return send(res, 401, { error: 'Экран не подключён' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(': ok\n\n');
        if (!streams.has(screen.id)) streams.set(screen.id, new Set());
        streams.get(screen.id).add(res);
        const ping = setInterval(() => {
          res.write(': ping\n\n');
          screen.lastSeenAt = now();
        }, 25_000);
        req.on('close', () => {
          clearInterval(ping);
          const set = streams.get(screen.id);
          set?.delete(res);
          if (set && !set.size) streams.delete(screen.id);
          screen.lastSeenAt = now();
          save();
        });
        return;
      }

      const media = pathname.match(/^\/api\/tv\/media\/([a-z0-9]{6,40})$/);
      if (media && (method === 'GET' || method === 'HEAD')) {
        const screen = await screenFrom(req);
        if (!screen) return send(res, 401, { error: 'Экран не подключён' });
        const d = await load();
        const ids = playlistIdsOf(screen);
        const used = d.playlists.some((p) => ids.has(p.id) && p.items.some((i) => i.fileId === media[1] || i.style?.bgImageId === media[1]));
        if (!used) return send(res, 404, { error: 'Файл не найден' });
        const info = await data.fileInfo(media[1]);
        if (!info || !/^(image|video)\//.test(info.type)) return send(res, 404, { error: 'Файл не найден' });
        // Видео на телевизорах воспроизводится с перемоткой — поддерживаем Range.
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
        res.setHeader('Content-Type', info.type);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (range && (range[1] || range[2])) {
          const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
          const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
          if (start >= info.size || start > end) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${info.size}`);
            return res.end();
          }
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
          res.setHeader('Content-Length', end - start + 1);
          if (method === 'HEAD') return res.end();
          return createReadStream(info.path, { start, end }).pipe(res);
        }
        res.statusCode = 200;
        res.setHeader('Content-Length', info.size);
        if (method === 'HEAD') return res.end();
        return createReadStream(info.path).pipe(res);
      }

      // ---------- Панель управления ----------

      if (!pathname.startsWith('/api/tv/admin')) return send(res, 404, { error: 'Не найдено' });
      const origin = req.headers.origin;
      if (method !== 'GET' && origin && new URL(origin).host !== req.headers.host) throw fail(403, 'Запрос с чужого сайта');
      const user = await managerFrom(req);
      const d = await load();
      const reply = () => send(res, 200, { screens: d.screens.map(publicScreen), playlists: d.playlists });

      if (pathname === '/api/tv/admin' && method === 'GET') return reply();

      // Подключить экран по коду.
      if (pathname === '/api/tv/admin/screens' && method === 'POST') {
        const body = await readJson(req);
        const code = String(body.code ?? '').replace(/\D/g, '');
        const p = d.pairings.find((x) => x.code === code && !x.screenId);
        if (!p) throw fail(400, 'Код не найден или устарел — проверьте цифры на экране');
        const name = str(body.name, 60);
        if (!name) throw fail(400, 'Назовите экран, например «Над баром»');
        const screen = { id: newId('tv'), name, location: str(body.location, 80), rotation: 0, defaultPlaylist: d.playlists[0]?.id ?? null, schedule: [], createdAt: now(), createdBy: user.name, tokenHash: null };
        d.screens.push(screen);
        p.screenId = screen.id;
        await save();
        return reply();
      }

      const screenMatch = pathname.match(/^\/api\/tv\/admin\/screens\/([a-z0-9]+)(\/command)?$/i);
      if (screenMatch) {
        const screen = d.screens.find((s) => s.id === screenMatch[1]);
        if (!screen) throw fail(404, 'Экран не найден');
        if (screenMatch[2] && method === 'POST') {
          const { type } = await readJson(req);
          if (!['reload', 'identify'].includes(type)) throw fail(400, 'Неизвестная команда');
          push(screen.id, { type });
          return send(res, 200, { delivered: streams.has(screen.id) });
        }
        if (method === 'PATCH') {
          const body = await readJson(req);
          const ids = new Set(d.playlists.map((p) => p.id));
          if (body.name !== undefined) {
            const name = str(body.name, 60);
            if (!name) throw fail(400, 'У экрана должно быть название');
            screen.name = name;
          }
          if (body.location !== undefined) screen.location = str(body.location, 80);
          if (body.rotation !== undefined) screen.rotation = ROTATIONS.includes(Number(body.rotation)) ? Number(body.rotation) : 0;
          if (body.defaultPlaylist !== undefined) {
            if (body.defaultPlaylist && !ids.has(body.defaultPlaylist)) throw fail(400, 'Плейлист не найден');
            screen.defaultPlaylist = body.defaultPlaylist || null;
          }
          if (body.schedule !== undefined) screen.schedule = cleanSchedule(body.schedule, ids);
          await save();
          push(screen.id, { type: 'update' });
          return reply();
        }
        if (method === 'DELETE') {
          d.screens = d.screens.filter((s) => s !== screen);
          d.pairings = d.pairings.filter((p) => p.screenId !== screen.id);
          await save();
          push(screen.id, { type: 'unpaired' });
          for (const r of streams.get(screen.id) ?? []) r.end();
          streams.delete(screen.id);
          return reply();
        }
      }

      if (pathname === '/api/tv/admin/playlists' && method === 'POST') {
        const body = await readJson(req);
        const name = str(body.name, 60);
        if (!name) throw fail(400, 'Назовите плейлист');
        d.playlists.push({ id: newId('pl'), name, items: [], updatedAt: now(), updatedBy: user.name });
        await save();
        return reply();
      }

      const plMatch = pathname.match(/^\/api\/tv\/admin\/playlists\/([a-z0-9]+)$/i);
      if (plMatch) {
        const pl = d.playlists.find((p) => p.id === plMatch[1]);
        if (!pl) throw fail(404, 'Плейлист не найден');
        if (method === 'PUT') {
          const body = await readJson(req);
          const name = str(body.name, 60);
          if (!name) throw fail(400, 'Назовите плейлист');
          if (!Array.isArray(body.items) || body.items.length > 200) throw fail(400, 'Некорректный список слайдов');
          pl.name = name;
          pl.items = body.items.map(cleanItem);
          pl.updatedAt = now();
          pl.updatedBy = user.name;
          await save();
          pushAll({ type: 'update' });
          return reply();
        }
        if (method === 'DELETE') {
          const usedBy = d.screens.filter((s) => playlistIdsOf(s).has(pl.id)).map((s) => s.name);
          if (usedBy.length) throw fail(409, `Плейлист показывается на экранах: ${usedBy.join(', ')}. Сначала замените его там`);
          d.playlists = d.playlists.filter((p) => p !== pl);
          await save();
          return reply();
        }
      }

      return send(res, 404, { error: 'Не найдено' });
    } catch (err) {
      if (!err.status) console.error('[tv]', err);
      if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Ошибка сервера' });
    }
  };

  // Изменилось меню — экраны с меню-слайдами обновляются сами.
  const onDataSaved = (key) => {
    if (key === 'ledger:menus:v1') pushAll({ type: 'update' });
  };

  return { handler, onDataSaved };
}
