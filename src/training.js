// Обучение: курсы из уроков и теста, назначение сотрудникам, прогресс.
//
// Курс (ledger:courses:v1): { id, title, description, coverId, status: 'active' | 'archived',
//   lessons: [{ id, title, html, videos: [{ id, name }], attachments: [id файла «Документов»], standards: [id статьи] }],
//   test: { passScore, questions: [{ id, text, options: [{ id, text }], multiple }] } | null,
//   assignees: [userId], due, revision, createdAt/By, updatedAt/By }.
// Правильные ответы хранятся только на сервере (server/training.js), прогресс и попытки — там же.
//
// На перспективу: практические аттестации, матрица компетенций и обязательные программы по
// должностям ложатся рядом — например, course.positions для автоназначения по должности
// и отдельные разделы данных для аттестаций с привязкой к userId и courseId.

import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { onRefresh } from './users.js';

export const COURSES_KEY = 'ledger:courses:v1';

export const canManageTraining = (user) => user?.role === 'admin' || user?.role === 'manager';

export const uid = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const fmtDate = (s) => {
  if (!s) return '';
  const d = s.length === 10 ? new Date(`${s}T00:00:00`) : new Date(s);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
};

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const hasTest = (course) => Boolean(course?.test?.questions?.length);

// Состояние прохождения курса сотрудником — по текущему составу уроков.
export function courseState(course, rec) {
  const lessons = course.lessons ?? [];
  const done = new Set(rec?.lessonsDone ?? []);
  const lessonsDone = lessons.filter((l) => done.has(l.id)).length;
  const attempts = rec?.attempts ?? [];
  const best = attempts.length ? Math.max(...attempts.map((a) => a.score)) : null;
  const passed = attempts.some((a) => a.passed);
  const test = hasTest(course) ? (passed ? 'passed' : attempts.length ? 'failed' : 'pending') : 'none';
  const complete = (lessons.length > 0 || test !== 'none') && lessonsDone === lessons.length && (test === 'none' || test === 'passed');
  const started = lessonsDone > 0 || attempts.length > 0;
  const overdue = !complete && course.due && course.due < todayIso();
  const status = complete ? 'done' : overdue ? 'overdue' : started ? 'progress' : 'new';
  // Следующий шаг: первый непройденный урок, затем тест.
  const nextLesson = lessons.find((l) => !done.has(l.id)) ?? null;
  const total = lessons.length + (test === 'none' ? 0 : 1);
  const percent = total ? Math.round(((lessonsDone + (test === 'passed' ? 1 : 0)) / total) * 100) : 0;
  return { lessonsDone, lessonsTotal: lessons.length, done, attempts, best, test, complete, status, nextLesson, percent, completedAt: complete ? rec?.completedAt : null };
}

export const STATUS_LABEL = { new: 'Не начат', progress: 'В процессе', done: 'Завершён', overdue: 'Просрочен' };

// Прогресс с сервера: свой у сотрудника, вся команда у руководителя.
export function useProgress() {
  const [progress, setProgress] = useState(null);
  const load = useCallback(() => api('/api/training/progress').then((d) => setProgress(d.progress), () => {}), []);
  useEffect(() => {
    load();
    return onRefresh(load, 30_000);
  }, [load]);
  return [progress, setProgress, load];
}
