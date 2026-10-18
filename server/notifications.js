// Оповещения: что и когда от человека хотят коллеги. Создаются на сервере при сохранении данных
// (сейчас — задач), хранятся отдельно для каждого пользователя и чужим не видны.

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const PER_USER_LIMIT = 300;
const MAX_BODY = 64 * 1024;
const PRIORITY = { high: 'высокий', normal: 'обычный', low: 'низкий' };

const fmtDate = (s) => {
  if (!s) return 'без срока';
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
};

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

// Какие оповещения порождает изменение задач: кому, о чём и куда вести по клику.
function fromTasks(prev, next, actor) {
  const before = new Map((Array.isArray(prev) ? prev : []).map((t) => [t?.id, t]));
  const out = [];
  const link = (t) => ({ page: 'tasks', id: t.id });
  for (const t of Array.isArray(next) ? next : []) {
    if (!t?.id) continue;
    const old = before.get(t.id);
    const title = t.title || 'Без названия';

    // Задачу поставили на человека (новую или переназначили).
    if (t.assigneeId && t.assigneeId !== actor.id && (!old || old.assigneeId !== t.assigneeId) && !t.done) {
      out.push({
        userId: t.assigneeId,
        type: 'task_assigned',
        title: `Новая задача «${title}»`,
        detail: [t.due ? `срок ${fmtDate(t.due)}` : 'без срока', t.priority === 'high' && 'важная'].filter(Boolean).join(' · '),
        link: link(t),
      });
      continue;
    }

    if (!old) continue;

    // Закрыли задачу, которую человек поставил.
    if (!old.done && t.done && t.createdById && t.createdById !== actor.id) {
      out.push({ userId: t.createdById, type: 'task_done', title: `Задача выполнена: «${title}»`, detail: '', link: link(t) });
    }

    // Изменили задачу, назначенную на человека.
    if (t.assigneeId && t.assigneeId !== actor.id && old.assigneeId === t.assigneeId && !t.done) {
      const changes = [];
      if ((old.due || '') !== (t.due || '')) changes.push(`срок: ${fmtDate(t.due)}`);
      if (old.priority !== t.priority) changes.push(`приоритет: ${PRIORITY[t.priority] ?? t.priority}`);
      if (old.title !== t.title) changes.push(`было «${old.title}»`);
      if ((old.note || '') !== (t.note || '')) changes.push('обновлено описание');
      if (changes.length) {
        out.push({ userId: t.assigneeId, type: 'task_updated', title: `Задача изменена: «${title}»`, detail: changes.join(' · '), link: link(t) });
      }
    }
  }
  return out;
}

// Сотруднику назначили курс обучения (новый или добавили в список).
function fromCourses(prev, next, actor) {
  const before = new Map((Array.isArray(prev) ? prev : []).map((c) => [c?.id, c]));
  const out = [];
  for (const c of Array.isArray(next) ? next : []) {
    if (!c?.id || c.status === 'archived') continue;
    const old = before.get(c.id);
    const had = new Set(old && old.status !== 'archived' ? old.assignees ?? [] : []);
    for (const userId of c.assignees ?? []) {
      if (had.has(userId) || userId === actor.id) continue;
      out.push({
        userId,
        type: 'course_assigned',
        title: `Назначен курс «${c.title || 'Без названия'}»`,
        detail: c.due ? `пройти до ${fmtDate(c.due)}` : '',
        link: { page: 'training', id: c.id },
      });
    }
  }
  return out;
}

// Руководитель принял решение по блюду — оповещаем автора.
function fromDishLab(prev, next, actor) {
  const before = new Map((Array.isArray(prev) ? prev : []).map((d) => [d?.id, d]));
  const out = [];
  for (const d of Array.isArray(next) ? next : []) {
    const old = before.get(d?.id);
    if (!old || old.status === d.status || d.status === 'review' || !d.createdById || d.createdById === actor.id) continue;
    out.push({
      userId: d.createdById,
      type: d.status === 'approved' ? 'dish_approved' : 'dish_rejected',
      title: `${d.status === 'approved' ? 'Блюдо согласовано' : 'Блюдо отклонено'}: «${d.title || 'Без названия'}»`,
      detail: d.decision?.note ? `«${String(d.decision.note).slice(0, 140)}»` : '',
      link: { page: 'dishlab', id: d.id },
    });
  }
  return out;
}

const RULES = { 'ledger:tasks:v1': fromTasks, 'ledger:courses:v1': fromCourses, 'ledger:dish-lab:v1': fromDishLab };

export function createNotifications({ file, auth }) {
  let data = null;
  let chain = Promise.resolve();

  async function load() {
    if (!data) {
      try {
        data = JSON.parse(await fs.readFile(file, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        data = { items: [] };
      }
    }
    return data;
  }

  const save = () => {
    chain = chain.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(`${file}.tmp`, JSON.stringify(data), { mode: 0o600 });
      await fs.rename(`${file}.tmp`, file);
    });
    return chain;
  };

  // Вызывается после сохранения раздела; возвращает id пользователей, которым пришло новое.
  async function onSaved(key, prev, next, actor) {
    const rule = RULES[key];
    if (!rule) return [];
    const fresh = rule(prev, next, actor);
    if (!fresh.length) return [];
    const d = await load();
    const createdAt = new Date().toISOString();
    for (const n of fresh) {
      d.items.push({ id: randomBytes(9).toString('base64url'), ...n, actorId: actor.id, actorName: actor.name, createdAt, read: false });
    }
    // Не копим бесконечно: у каждого храним последние PER_USER_LIMIT.
    const counts = new Map();
    d.items = d.items
      .slice()
      .reverse()
      .filter((n) => {
        const c = (counts.get(n.userId) ?? 0) + 1;
        counts.set(n.userId, c);
        return c <= PER_USER_LIMIT;
      })
      .reverse();
    await save();
    return [...new Set(fresh.map((n) => n.userId))];
  }

  const handler = async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/notifications') return next();
    try {
      const origin = req.headers.origin;
      if (req.method !== 'GET' && origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Запрос с чужого сайта' });
      const user = await auth.userFrom(req);
      if (!user) return send(res, 401, { error: 'Нужно войти' });
      const d = await load();
      const mine = () => d.items.filter((n) => n.userId === user.id).reverse();

      if (req.method === 'GET') return send(res, 200, { items: mine() });

      // Удалить одно, несколько или все свои оповещения.
      if (req.method === 'DELETE') {
        const { ids, all } = await readJson(req);
        const drop = new Set(Array.isArray(ids) ? ids : []);
        d.items = d.items.filter((n) => n.userId !== user.id || (!all && !drop.has(n.id)));
        await save();
        return send(res, 200, { items: mine() });
      }

      // Отметить прочитанными.
      if (req.method === 'POST') {
        const { ids, all } = await readJson(req);
        const mark = new Set(Array.isArray(ids) ? ids : []);
        for (const n of d.items) if (n.userId === user.id && (all || mark.has(n.id))) n.read = true;
        await save();
        return send(res, 200, { items: mine() });
      }
      return send(res, 405, { error: 'Метод не поддерживается' });
    } catch (err) {
      if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Ошибка сервера' });
    }
  };

  return { handler, onSaved };
}
