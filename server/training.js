// Обучение: прогресс сотрудников и проверка тестов.
//
// Сами курсы (уроки, вопросы и варианты ответов) лежат в общих данных (ledger:courses:v1) и видны всем.
// Правильные ответы туда не попадают: они хранятся только здесь, на сервере, и в браузер сотрудника
// не уходят. Тест проверяет сервер, он же записывает пройденные уроки и попытки — подделать результат
// из браузера нельзя.
//
// Прогресс — запись на пару «курс + сотрудник»: { courseId, userId, lessonsDone, attempts, startedAt,
// completedAt, updatedAt }. На перспективу сюда же (отдельными полями или соседними разделами)
// ложатся практические аттестации, матрица компетенций и обязательные программы по должностям.

import fs from 'node:fs/promises';
import path from 'node:path';

export const COURSES_KEY = 'ledger:courses:v1';
const MAX_BODY = 512 * 1024;
const ID_RE = /^[a-z0-9]{4,40}$/i;

const isManager = (user) => user.role === 'admin' || user.role === 'manager';

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

const fail = (status, message) => Object.assign(new Error(message), { status });

// Курс завершён, когда пройдены все текущие уроки и (если есть тест) тест сдан.
export function isComplete(course, rec) {
  const lessons = course.lessons ?? [];
  const done = new Set(rec?.lessonsDone ?? []);
  const lessonsOk = lessons.every((l) => done.has(l.id));
  const testOk = !course.test?.questions?.length || (rec?.attempts ?? []).some((a) => a.passed);
  return (lessons.length > 0 || Boolean(course.test?.questions?.length)) && lessonsOk && testOk;
}

export function createTraining({ file, auth, data }) {
  let state = null;
  let chain = Promise.resolve();

  async function load() {
    if (!state) {
      try {
        state = JSON.parse(await fs.readFile(file, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        state = { keys: {}, progress: {} };
      }
    }
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

  async function courseFor(user, courseId) {
    const courses = (await data.get(COURSES_KEY)) ?? [];
    const course = Array.isArray(courses) ? courses.find((c) => c?.id === courseId) : null;
    if (!course) throw fail(404, 'Курс не найден');
    if (course.status === 'archived') throw fail(409, 'Курс в архиве');
    if (!(course.assignees ?? []).includes(user.id)) throw fail(403, 'Этот курс вам не назначен');
    return course;
  }

  const recordFor = (d, courseId, user) => {
    const id = `${courseId}:${user.id}`;
    d.progress[id] ??= { id, courseId, userId: user.id, lessonsDone: [], attempts: [], startedAt: null, completedAt: null, updatedAt: null };
    return d.progress[id];
  };

  const touch = (rec, course) => {
    const now = new Date().toISOString();
    rec.startedAt ??= now;
    rec.updatedAt = now;
    if (!rec.completedAt && isComplete(course, rec)) rec.completedAt = now;
  };

  const visible = (d, user) => Object.values(d.progress).filter((r) => isManager(user) || r.userId === user.id);

  const handler = async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/training/')) return next();
    try {
      const origin = req.headers.origin;
      if (req.method !== 'GET' && origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Запрос с чужого сайта' });
      const user = await auth.userFrom(req);
      if (!user) return send(res, 401, { error: 'Нужно войти' });
      const d = await load();

      // Прогресс: руководитель видит всю команду, сотрудник — только себя.
      if (url.pathname === '/api/training/progress' && req.method === 'GET') {
        return send(res, 200, { progress: visible(d, user) });
      }

      // Урок пройден. Уроки открываются по порядку.
      if (url.pathname === '/api/training/lesson' && req.method === 'POST') {
        const { courseId, lessonId } = await readJson(req);
        const course = await courseFor(user, courseId);
        const lessons = course.lessons ?? [];
        const index = lessons.findIndex((l) => l.id === lessonId);
        if (index < 0) throw fail(404, 'Урок не найден');
        const rec = recordFor(d, courseId, user);
        if (lessons.slice(0, index).some((l) => !rec.lessonsDone.includes(l.id))) throw fail(409, 'Сначала пройдите предыдущие уроки');
        if (!rec.lessonsDone.includes(lessonId)) rec.lessonsDone.push(lessonId);
        touch(rec, course);
        await save();
        return send(res, 200, { progress: visible(d, user), record: rec });
      }

      // Сдача теста: сервер сверяет ответы с ключом и записывает попытку.
      if (url.pathname === '/api/training/submit' && req.method === 'POST') {
        const { courseId, answers } = await readJson(req);
        const course = await courseFor(user, courseId);
        const questions = course.test?.questions ?? [];
        if (!questions.length) throw fail(409, 'В курсе нет теста');
        const rec = recordFor(d, courseId, user);
        if ((course.lessons ?? []).some((l) => !rec.lessonsDone.includes(l.id))) throw fail(409, 'Сначала пройдите все уроки');
        const key = d.keys[courseId] ?? {};
        const given = answers && typeof answers === 'object' ? answers : {};
        let correct = 0;
        for (const q of questions) {
          const right = [...(key[q.id] ?? [])].sort();
          const mine = [...new Set(Array.isArray(given[q.id]) ? given[q.id].map(String) : [])].sort();
          if (right.length && right.length === mine.length && right.every((x, i) => x === mine[i])) correct += 1;
        }
        const score = Math.round((correct / questions.length) * 100);
        const passScore = Math.min(100, Math.max(0, Number(course.test.passScore) || 0));
        const attempt = { at: new Date().toISOString(), score, correct, total: questions.length, passed: score >= passScore };
        rec.attempts.push(attempt);
        touch(rec, course);
        await save();
        return send(res, 200, { progress: visible(d, user), record: rec, attempt });
      }

      // Ключ ответов к тесту — только для руководителей (редактор курса).
      const m = url.pathname.match(/^\/api\/training\/keys\/([^/]+)$/);
      if (m) {
        if (!isManager(user)) throw fail(403, 'Недостаточно прав');
        const courseId = decodeURIComponent(m[1]);
        if (!ID_RE.test(courseId)) throw fail(400, 'Некорректный курс');
        if (req.method === 'GET') return send(res, 200, { keys: d.keys[courseId] ?? {} });
        if (req.method === 'PUT') {
          const { keys } = await readJson(req);
          if (!keys || typeof keys !== 'object' || Array.isArray(keys)) throw fail(400, 'Некорректный ключ ответов');
          const clean = {};
          for (const [qid, opts] of Object.entries(keys)) {
            if (!ID_RE.test(qid) || !Array.isArray(opts)) throw fail(400, 'Некорректный ключ ответов');
            clean[qid] = opts.map(String).filter((o) => ID_RE.test(o)).slice(0, 20);
          }
          d.keys[courseId] = clean;
          await save();
          return send(res, 200, { ok: true });
        }
        if (req.method === 'DELETE') {
          delete d.keys[courseId];
          await save();
          return send(res, 200, { ok: true });
        }
      }

      // Сбросить прогресс сотрудника по курсу (например, чтобы пройти заново) — руководитель.
      if (url.pathname === '/api/training/reset' && req.method === 'POST') {
        if (!isManager(user)) throw fail(403, 'Недостаточно прав');
        const { courseId, userId } = await readJson(req);
        delete d.progress[`${courseId}:${userId}`];
        await save();
        return send(res, 200, { progress: visible(d, user) });
      }

      return send(res, 404, { error: 'Не найдено' });
    } catch (err) {
      if (!err.status) console.error('[training]', err);
      if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Ошибка сервера' });
    }
  };

  return { handler };
}
