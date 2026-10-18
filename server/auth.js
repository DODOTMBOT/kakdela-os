// Авторизация без регистрации: один супер-админ (создаётся из .env.local при первом запуске)
// заводит пользователей сам или выдаёт одноразовые ссылки-приглашения.
// Хранилище — JSON-файл на сервере; пароли — scrypt, сессии — httpOnly-cookie,
// в файле лежат только хеши токенов сессий и приглашений.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const scrypt = promisify(scryptCb);

const COOKIE = 'kd_session';
const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const MAX_BODY = 64 * 1024;
const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;
const MIN_PASSWORD = 8;
const MAX_FAILS = 5;
const LOCK_MS = 60 * 1000;

const sha = (s) => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const now = () => new Date().toISOString();

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

// Для несуществующего логина всё равно считаем хеш — чтобы время ответа не выдавало, есть ли такой пользователь.
const DUMMY_HASH = `scrypt$${randomBytes(16).toString('base64')}$${randomBytes(64).toString('base64')}`;

async function verifyPassword(password, stored = DUMMY_HASH) {
  const [, salt, key] = stored.split('$');
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `Пароль — не короче ${MIN_PASSWORD} символов`;
  if (password.length > 200) return 'Слишком длинный пароль';
  return null;
}

function loginProblem(login) {
  if (typeof login !== 'string' || !LOGIN_RE.test(login)) {
    return 'Логин — 3–32 символа: латинские буквы, цифры, точка, дефис или подчёркивание';
  }
  return null;
}

// Роли: супер-админ, руководитель и сотрудник. Должность — свободный текст.
// Первый супер-админ (создаётся из .env) — владелец системы: его роль, доступ и учётную запись
// изменить или удалить нельзя, чтобы в системе всегда оставался хотя бы один супер-админ.
const ROLES = ['admin', 'manager', 'employee'];
// Пользователи, созданные до появления ролей, считаются сотрудниками.
const roleOf = (u) => (u.role === 'user' || !u.role ? 'employee' : u.role);
const roleProblem = (role) => (ROLES.includes(role) ? null : 'Выберите роль: супер-админ, руководитель или сотрудник');
const cleanPosition = (p) => String(p ?? '').trim().slice(0, 80);

const publicUser = (u) => ({
  id: u.id,
  login: u.login,
  name: u.name,
  role: roleOf(u),
  owner: Boolean(u.owner),
  position: u.position ?? '',
  disabled: Boolean(u.disabled),
  mustChange: Boolean(u.mustChange),
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt ?? null,
});

const publicInvite = (i) => ({
  id: i.id,
  name: i.name,
  role: i.role ?? 'employee',
  position: i.position ?? '',
  createdAt: i.createdAt,
  expiresAt: i.expiresAt,
});

function createStore(file) {
  let data = null;
  let chain = Promise.resolve();
  return {
    async get() {
      if (!data) {
        try {
          data = JSON.parse(await fs.readFile(file, 'utf8'));
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
          data = { users: [], invites: [], sessions: [] };
        }
      }
      const t = Date.now();
      data.sessions = data.sessions.filter((s) => Date.parse(s.expiresAt) > t);
      data.invites = data.invites.filter((i) => !i.usedAt && Date.parse(i.expiresAt) > t);
      return data;
    },
    // Запись по очереди и через временный файл — чтобы файл не побился при одновременных запросах.
    save() {
      chain = chain.then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
        await fs.rename(tmp, file);
      });
      return chain;
    },
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('Некорректный запрос'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function cookieValue(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setSessionCookie(res, value, maxAgeSec, secure) {
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const fail = (status, message) => Object.assign(new Error(message), { status });

// secure — ставить cookie с флагом Secure (сайт за HTTPS); trustProxy — брать IP клиента из X-Forwarded-For (за nginx).
export function createAuth({ file, env, secure = false, trustProxy = false }) {
  const store = createStore(file);
  const fails = new Map();

  // Супер-админ создаётся один раз; дальше пароль меняется уже в интерфейсе.
  const ready = (async () => {
    const data = await store.get();
    if (data.users.some((u) => u.role === 'admin')) {
      // Владелец — первый супер-админ (у баз до появления этой отметки ставим её один раз).
      if (!data.users.some((u) => u.owner)) {
        data.users.find((u) => u.role === 'admin').owner = true;
        await store.save();
      }
      return;
    }
    const login = (env.ADMIN_LOGIN || '').trim().toLowerCase();
    const password = env.ADMIN_PASSWORD || '';
    if (loginProblem(login) || passwordProblem(password)) {
      console.warn('[auth] Супер-админ не создан: задайте ADMIN_LOGIN и ADMIN_PASSWORD (от 8 символов) в .env.local');
      return;
    }
    data.users.push({
      id: token().slice(0, 12),
      login,
      name: env.ADMIN_NAME || 'Администратор',
      role: 'admin',
      owner: true,
      passwordHash: await hashPassword(password),
      mustChange: true,
      createdAt: now(),
    });
    await store.save();
    console.log(`[auth] Создан супер-админ «${login}»`);
  })();

  async function sessionUser(req) {
    await ready;
    const raw = cookieValue(req, COOKIE);
    if (!raw) return null;
    const data = await store.get();
    const session = data.sessions.find((s) => s.tokenHash === sha(raw));
    const user = session && data.users.find((u) => u.id === session.userId);
    return user && !user.disabled ? { user, session } : null;
  }

  async function startSession(res, data, user) {
    const raw = token();
    data.sessions.push({
      tokenHash: sha(raw),
      userId: user.id,
      createdAt: now(),
      expiresAt: new Date(Date.now() + SESSION_DAYS * DAY).toISOString(),
    });
    user.lastLoginAt = now();
    await store.save();
    setSessionCookie(res, raw, SESSION_DAYS * 24 * 60 * 60, secure);
  }

  const revokeSessions = (data, userId, except) => {
    data.sessions = data.sessions.filter((s) => s.userId !== userId || s.tokenHash === except);
  };

  function checkLock(key) {
    const f = fails.get(key);
    if (f && f.until > Date.now()) throw fail(429, 'Слишком много попыток — подождите минуту');
  }
  function registerFail(key) {
    const f = fails.get(key) ?? { count: 0, until: 0 };
    f.count += 1;
    if (f.count >= MAX_FAILS) {
      f.until = Date.now() + LOCK_MS;
      f.count = 0;
    }
    fails.set(key, f);
  }

  async function route(req, res, url) {
    const { pathname } = url;
    const method = req.method;
    const data = await store.get();

    if (pathname === '/api/auth/me' && method === 'GET') {
      const s = await sessionUser(req);
      if (!s) return send(res, 401, { error: 'Нужно войти' });
      return send(res, 200, { user: publicUser(s.user) });
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const { login = '', password = '' } = await readJson(req);
      const normalized = String(login).trim().toLowerCase();
      const ip = (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
      const key = `${ip}|${normalized}`;
      checkLock(key);
      const user = data.users.find((u) => u.login === normalized);
      const ok = await verifyPassword(String(password), user?.passwordHash);
      if (!user || !ok || user.disabled) {
        registerFail(key);
        throw fail(401, user?.disabled && ok ? 'Доступ отключён администратором' : 'Неверный логин или пароль');
      }
      fails.delete(key);
      await startSession(res, data, user);
      return send(res, 200, { user: publicUser(user) });
    }

    if (pathname === '/api/auth/logout' && method === 'POST') {
      const raw = cookieValue(req, COOKIE);
      if (raw) {
        data.sessions = data.sessions.filter((s) => s.tokenHash !== sha(raw));
        await store.save();
      }
      setSessionCookie(res, '', 0, secure);
      return send(res, 200, { ok: true });
    }

    const inviteMatch = pathname.match(/^\/api\/auth\/invite\/([A-Za-z0-9_-]{20,100})$/);
    if (inviteMatch) {
      const invite = data.invites.find((i) => i.tokenHash === sha(inviteMatch[1]));
      if (!invite) throw fail(404, 'Приглашение недействительно или уже использовано');
      if (method === 'GET') return send(res, 200, publicInvite(invite));
      if (method === 'POST') {
        const { login = '', password = '' } = await readJson(req);
        const normalized = String(login).trim().toLowerCase();
        const problem = loginProblem(normalized) || passwordProblem(password);
        if (problem) throw fail(400, problem);
        if (data.users.some((u) => u.login === normalized)) throw fail(409, 'Такой логин уже занят');
        const user = {
          id: token().slice(0, 12),
          login: normalized,
          name: invite.name,
          role: invite.role ?? 'employee',
          position: invite.position ?? '',
          passwordHash: await hashPassword(password),
          createdAt: now(),
        };
        data.users.push(user);
        invite.usedAt = now();
        await startSession(res, data, user);
        return send(res, 200, { user: publicUser(user) });
      }
    }

    // Дальше — только для вошедших.
    const s = await sessionUser(req);
    if (!s) throw fail(401, 'Нужно войти');
    const me = s.user;

    if (pathname === '/api/auth/password' && method === 'POST') {
      const { current = '', next = '' } = await readJson(req);
      if (!(await verifyPassword(String(current), me.passwordHash))) throw fail(400, 'Текущий пароль указан неверно');
      const problem = passwordProblem(next);
      if (problem) throw fail(400, problem);
      if (next === current) throw fail(400, 'Новый пароль должен отличаться от текущего');
      me.passwordHash = await hashPassword(next);
      me.mustChange = false;
      revokeSessions(data, me.id, s.session.tokenHash);
      await store.save();
      return send(res, 200, { user: publicUser(me) });
    }

    // Список коллег для выбора ответственного — только имя, должность и роль.
    if (pathname === '/api/users' && method === 'GET') {
      return send(res, 200, {
        users: data.users
          .filter((u) => !u.disabled)
          .map((u) => ({ id: u.id, name: u.name, position: u.position ?? '', role: roleOf(u) })),
      });
    }

    if (!pathname.startsWith('/api/admin/')) return false;
    if (me.role !== 'admin') throw fail(403, 'Только для администратора');

    if (pathname === '/api/admin/users' && method === 'GET') {
      return send(res, 200, { users: data.users.map(publicUser), invites: data.invites.map(publicInvite) });
    }

    if (pathname === '/api/admin/users' && method === 'POST') {
      const { name = '', login = '', password = '', role = 'employee', position = '' } = await readJson(req);
      const normalized = String(login).trim().toLowerCase();
      if (!String(name).trim()) throw fail(400, 'Укажите имя');
      const problem = roleProblem(role) || loginProblem(normalized) || passwordProblem(password);
      if (problem) throw fail(400, problem);
      if (data.users.some((u) => u.login === normalized)) throw fail(409, 'Такой логин уже занят');
      const user = {
        id: token().slice(0, 12),
        login: normalized,
        name: String(name).trim().slice(0, 80),
        role,
        position: cleanPosition(position),
        passwordHash: await hashPassword(password),
        mustChange: true,
        createdAt: now(),
      };
      data.users.push(user);
      await store.save();
      return send(res, 200, { user: publicUser(user) });
    }

    const userMatch = pathname.match(/^\/api\/admin\/users\/([A-Za-z0-9_-]+)$/);
    if (userMatch) {
      const user = data.users.find((u) => u.id === userMatch[1]);
      if (!user) throw fail(404, 'Пользователь не найден');
      const isOwner = Boolean(user.owner);
      if (method === 'PATCH') {
        const body = await readJson(req);
        // У владельца здесь меняются только имя и должность; пароль — через «Сменить пароль».
        if (isOwner && (body.role !== undefined || body.disabled !== undefined || body.password !== undefined)) {
          throw fail(400, 'Роль, доступ и пароль владельца системы здесь не меняются');
        }
        if (user.id === me.id && (body.disabled === true || (body.role !== undefined && body.role !== 'admin'))) {
          throw fail(400, 'Свою роль и доступ может изменить другой супер-админ');
        }
        if (typeof body.name === 'string' && body.name.trim()) user.name = body.name.trim().slice(0, 80);
        if (body.position !== undefined) user.position = cleanPosition(body.position);
        if (body.role !== undefined) {
          const problem = roleProblem(body.role);
          if (problem) throw fail(400, problem);
          user.role = body.role;
        }
        if (typeof body.disabled === 'boolean') {
          user.disabled = body.disabled;
          if (body.disabled) revokeSessions(data, user.id);
        }
        if (body.password !== undefined) {
          const problem = passwordProblem(body.password);
          if (problem) throw fail(400, problem);
          user.passwordHash = await hashPassword(body.password);
          user.mustChange = true;
          revokeSessions(data, user.id);
        }
        await store.save();
        return send(res, 200, { user: publicUser(user) });
      }
      if (method === 'DELETE') {
        if (isOwner) throw fail(400, 'Владельца системы удалить нельзя');
        if (user.id === me.id) throw fail(400, 'Нельзя удалить самого себя');
        data.users = data.users.filter((u) => u.id !== user.id);
        revokeSessions(data, user.id);
        await store.save();
        return send(res, 200, { ok: true });
      }
    }

    if (pathname === '/api/admin/invites' && method === 'POST') {
      const { name = '', days = 3, role = 'employee', position = '' } = await readJson(req);
      if (!String(name).trim()) throw fail(400, 'Укажите, для кого приглашение');
      const roleError = roleProblem(role);
      if (roleError) throw fail(400, roleError);
      const ttl = Math.min(Math.max(Number(days) || 3, 1), 30);
      const raw = token();
      const invite = {
        id: token().slice(0, 12),
        tokenHash: sha(raw),
        name: String(name).trim().slice(0, 80),
        role,
        position: cleanPosition(position),
        createdAt: now(),
        expiresAt: new Date(Date.now() + ttl * DAY).toISOString(),
      };
      data.invites.push(invite);
      await store.save();
      // Сам токен показывается один раз — на сервере хранится только хеш.
      return send(res, 200, { invite: publicInvite(invite), path: `/invite/${raw}` });
    }

    const inviteAdmin = pathname.match(/^\/api\/admin\/invites\/([A-Za-z0-9_-]+)$/);
    if (inviteAdmin && method === 'DELETE') {
      data.invites = data.invites.filter((i) => i.id !== inviteAdmin[1]);
      await store.save();
      return send(res, 200, { ok: true });
    }

    throw fail(404, 'Не найдено');
  }

  const handler = async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/auth/') && !url.pathname.startsWith('/api/admin/') && url.pathname !== '/api/users') return next();
    try {
      // Изменяющие запросы принимаем только со своей же страницы.
      const origin = req.headers.origin;
      if (req.method !== 'GET' && origin && new URL(origin).host !== req.headers.host) throw fail(403, 'Запрос с чужого сайта');
      await ready;
      const handled = await route(req, res, url);
      if (handled === false) send(res, 404, { error: 'Не найдено' });
    } catch (err) {
      send(res, err.status || 500, { error: err.status ? err.message : 'Ошибка сервера' });
      if (!err.status) console.error('[auth]', err);
    }
  };

  return {
    handler,
    // Для других серверных обработчиков: пользователь сессии или null.
    async userFrom(req) {
      const s = await sessionUser(req);
      return s ? publicUser(s.user) : null;
    },
  };
}

export function authPlugin(auth) {
  return {
    name: 'auth',
    configureServer(server) {
      server.middlewares.use(auth.handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(auth.handler);
    },
  };
}
