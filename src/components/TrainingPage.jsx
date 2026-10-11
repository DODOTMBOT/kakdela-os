import { useCallback, useEffect, useMemo, useState } from 'react';
import CourseEditor, { StandardLinks } from './CourseEditor.jsx';
import FileViewer from './FileViewer.jsx';
import { Attachments } from './DocAttach.jsx';
import { useEscape } from './Popover.jsx';
import { IconClose } from './Icons.jsx';
import { api } from '../api.js';
import { useShared } from '../sync.js';
import { useUsers } from '../users.js';
import { plural } from '../utils.js';
import { DEFAULT_CATEGORIES, DOCS_KEY, STANDARDS_KEY, STANDARD_CATEGORIES_KEY, sanitizeHtml } from '../standards.js';
import { COURSES_KEY, STATUS_LABEL, canManageTraining, courseState, fmtDate, hasTest, uid, useProgress } from '../training.js';

const BASE = '/training';
const RESERVED = new Set(['courses', 'team', 'new']);

// Адреса раздела: /training (моё обучение), /training/courses, /training/team, /training/new,
// /training/:id, /training/:id/edit, /training/:id/lesson/:lessonId, /training/:id/test.
function routeFromLocation() {
  const p = window.location.pathname.replace(/\/+$/, '').split('/').slice(2).map(decodeURIComponent);
  if (!p[0]) return { mode: 'list', tab: null };
  if (p[0] === 'courses' || p[0] === 'team') return { mode: 'list', tab: p[0] };
  if (p[0] === 'new') return { mode: 'edit', id: null };
  if (p[1] === 'edit') return { mode: 'edit', id: p[0] };
  if (p[1] === 'lesson' && p[2]) return { mode: 'lesson', id: p[0], lessonId: p[2] };
  if (p[1] === 'test') return { mode: 'test', id: p[0] };
  return { mode: 'course', id: p[0] };
}
function pathOf(r) {
  if (r.mode === 'list') return r.tab && r.tab !== 'my' ? `${BASE}/${r.tab}` : BASE;
  if (r.mode === 'edit') return r.id ? `${BASE}/${r.id}/edit` : `${BASE}/new`;
  if (r.mode === 'lesson') return `${BASE}/${r.id}/lesson/${r.lessonId}`;
  if (r.mode === 'test') return `${BASE}/${r.id}/test`;
  return `${BASE}/${r.id}`;
}

const STATUS_ORDER = { overdue: 0, progress: 1, new: 2, done: 3 };

function StatusBadge({ status }) {
  return <span className={`tr-status is-${status}`}>{STATUS_LABEL[status]}</span>;
}

function Cover({ id, size = 'sm' }) {
  return id ? <img className={`tr-cover is-${size}`} src={`/api/files/${id}`} alt="" loading="lazy" /> : <span className={`tr-cover is-${size} is-empty`} />;
}

const courseSummary = (c) =>
  [
    `${c.lessons?.length ?? 0} ${plural(c.lessons?.length ?? 0, ['урок', 'урока', 'уроков'])}`,
    hasTest(c) && `тест · ${c.test.questions.length} ${plural(c.test.questions.length, ['вопрос', 'вопроса', 'вопросов'])}`,
  ]
    .filter(Boolean)
    .join(' · ');

// Статья «Стандартов» внутри урока — читается в окне, текст не копируется.
function StandardReader({ article, onClose }) {
  useEscape(onClose);
  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal tr-reader" role="dialog" aria-modal="true" aria-label={article.title}>
        <header className="modal-head">
          <h2>{article.title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconClose size={18} />
          </button>
        </header>
        {article.description && <p className="std-desc">{article.description}</p>}
        {article.html ? <div className="std-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(article.html) }} /> : <p className="std-muted">Текст статьи пока не добавлен.</p>}
        <footer className="modal-foot">
          <a className="link-btn tr-reader-link" href={`/standards/${article.id}`} target="_blank" rel="noopener noreferrer">
            Открыть в «Стандартах» ↗
          </a>
          <button type="button" className="btn btn-primary" onClick={onClose}>Закрыть</button>
        </footer>
      </div>
    </div>
  );
}

export default function TrainingPage({ user }) {
  const [coursesRaw, setCourses] = useShared(COURSES_KEY, []);
  const courses = useMemo(() => (Array.isArray(coursesRaw) ? coursesRaw : []), [coursesRaw]);
  const [progress, setProgress] = useProgress();
  const users = useUsers(user);
  const manager = canManageTraining(user);

  const [route, setRoute] = useState(routeFromLocation);
  const [courseTab, setCourseTab] = useState('active');
  const [teamFilter, setTeamFilter] = useState({ course: '', status: '', query: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    const sync = () => setRoute(routeFromLocation());
    window.addEventListener('popstate', sync);
    window.addEventListener('kd:navigate', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('kd:navigate', sync);
    };
  }, []);

  const go = useCallback((r, { replace = false } = {}) => {
    const path = pathOf(r);
    if (window.location.pathname !== path) window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
    setRoute(r);
    setError('');
    window.scrollTo(0, 0);
  }, []);

  const byId = useMemo(() => Object.fromEntries(courses.map((c) => [c.id, c])), [courses]);
  const userById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  const recOf = (courseId, userId = user.id) => (progress ?? []).find((r) => r.courseId === courseId && r.userId === userId);

  const mine = useMemo(
    () =>
      courses
        .filter((c) => c.status !== 'archived' && (c.assignees ?? []).includes(user.id))
        .map((c) => ({ course: c, state: courseState(c, recOf(c.id)) }))
        .sort((a, b) => STATUS_ORDER[a.state.status] - STATUS_ORDER[b.state.status] || (a.course.due || '9999').localeCompare(b.course.due || '9999')),
    [courses, progress, user.id], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---------- Действия ----------

  const saveCourse = async (id, data, keys) => {
    const courseId = id ?? uid('co');
    const prev = id ? byId[id] : null;
    if (keys) await api(`/api/training/keys/${courseId}`, { method: 'PUT', body: { keys } });
    else if (prev?.test) await api(`/api/training/keys/${courseId}`, { method: 'DELETE' }).catch(() => {});
    const now = new Date().toISOString();
    const by = { updatedAt: now, updatedById: user.id, updatedByName: user.name };
    if (prev) setCourses((list) => list.map((c) => (c.id === id ? { ...c, ...data, ...by, revision: (c.revision ?? 1) + 1 } : c)));
    else setCourses((list) => [...list, { id: courseId, status: 'active', ...data, revision: 1, createdAt: now, createdById: user.id, createdByName: user.name, ...by }]);
    go({ mode: 'course', id: courseId }, { replace: true });
  };

  const deleteCourse = (id) => {
    setCourses((list) => list.filter((c) => c.id !== id));
    api(`/api/training/keys/${id}`, { method: 'DELETE' }).catch(() => {});
    go({ mode: 'list', tab: 'courses' }, { replace: true });
  };

  const setArchived = (id, archived) =>
    setCourses((list) => list.map((c) => (c.id === id ? { ...c, status: archived ? 'archived' : 'active', updatedAt: new Date().toISOString(), updatedById: user.id, updatedByName: user.name } : c)));

  const completeLesson = async (course, lessonId) => {
    try {
      const res = await api('/api/training/lesson', { method: 'POST', body: { courseId: course.id, lessonId } });
      setProgress(res.progress);
      const i = course.lessons.findIndex((l) => l.id === lessonId);
      const next = course.lessons[i + 1];
      if (next) go({ mode: 'lesson', id: course.id, lessonId: next.id });
      else if (hasTest(course)) go({ mode: 'test', id: course.id });
      else go({ mode: 'course', id: course.id });
    } catch (err) {
      setError(err.message);
    }
  };

  // ---------- Редактор ----------

  if (route.mode === 'edit') {
    if (!manager) return <Missing text="Создавать и изменять курсы могут руководители" onBack={() => go({ mode: 'list' })} />;
    const course = route.id ? byId[route.id] : null;
    if (route.id && !course) return <Missing onBack={() => go({ mode: 'list', tab: 'courses' })} />;
    return (
      <CourseEditor
        key={route.id ?? 'new'}
        course={course}
        users={users}
        onSave={(data, keys) => saveCourse(route.id, data, keys)}
        onDelete={() => deleteCourse(route.id)}
        onCancel={() => go(route.id ? { mode: 'course', id: route.id } : { mode: 'list', tab: 'courses' }, { replace: true })}
      />
    );
  }

  // ---------- Курс, урок, тест ----------

  if (route.mode === 'course' || route.mode === 'lesson' || route.mode === 'test') {
    const course = byId[route.id];
    if (!course || RESERVED.has(route.id)) return <Missing onBack={() => go({ mode: 'list' })} />;
    const assigned = (course.assignees ?? []).includes(user.id) && course.status !== 'archived';
    if (!assigned && !manager) return <Missing text="Этот курс вам не назначен" onBack={() => go({ mode: 'list' })} />;
    const state = courseState(course, recOf(course.id));
    const props = { course, state, assigned, manager, go, error };

    if (route.mode === 'lesson') {
      const index = course.lessons.findIndex((l) => l.id === route.lessonId);
      if (index < 0) return <Missing text="Урок не найден" onBack={() => go({ mode: 'course', id: course.id })} />;
      const locked = assigned && !manager && course.lessons.slice(0, index).some((l) => !state.done.has(l.id));
      if (locked) return <Missing text="Этот урок откроется после предыдущих" onBack={() => go({ mode: 'course', id: course.id })} />;
      return <LessonView {...props} index={index} onComplete={(lessonId) => completeLesson(course, lessonId)} />;
    }
    if (route.mode === 'test') {
      if (!hasTest(course)) return <Missing text="В курсе нет теста" onBack={() => go({ mode: 'course', id: course.id })} />;
      return <TestView {...props} onResult={(res) => setProgress(res.progress)} />;
    }
    return (
      <CourseView
        {...props}
        users={userById}
        progress={progress ?? []}
        onArchive={(v) => setArchived(course.id, v)}
        onReset={async (userId) => {
          const res = await api('/api/training/reset', { method: 'POST', body: { courseId: course.id, userId } });
          setProgress(res.progress);
        }}
      />
    );
  }

  // ---------- Списки ----------

  const tab = route.tab ?? (manager && !mine.length ? 'courses' : 'my');
  const tabs = manager
    ? [
        ['my', 'Моё обучение', mine.filter((m) => m.state.status !== 'done').length],
        ['courses', 'Курсы', courses.filter((c) => c.status !== 'archived').length],
        ['team', 'Результаты команды', null],
      ]
    : null;

  return (
    <>
      <div className="page-head">
        <h1>{manager ? 'Обучение' : 'Моё обучение'}</h1>
        {manager && (
          <button className="btn btn-primary" onClick={() => go({ mode: 'edit', id: null })}>
            Новый курс
          </button>
        )}
      </div>

      {tabs && (
        <div className="tabs menu-tabs" role="tablist" aria-label="Обучение">
          {tabs.map(([id, label, count]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => go({ mode: 'list', tab: id })}>
              {label}
              {count !== null && <span>{count}</span>}
            </button>
          ))}
        </div>
      )}

      {tab === 'my' && <MyCourses items={mine} loading={progress === null} onOpen={(id) => go({ mode: 'course', id })} />}
      {tab === 'courses' && manager && (
        <CourseList courses={courses} progress={progress ?? []} filter={courseTab} onFilter={setCourseTab} onOpen={(id) => go({ mode: 'course', id })} />
      )}
      {tab === 'team' && manager && (
        <TeamResults courses={courses} progress={progress ?? []} users={users} filter={teamFilter} onFilter={setTeamFilter} onOpen={(id) => go({ mode: 'course', id })} />
      )}
    </>
  );
}

// ---------- Моё обучение ----------

function MyCourses({ items, loading, onOpen }) {
  if (loading) return <p className="sync-loading">Загружаем прогресс…</p>;
  if (!items.length) {
    return (
      <div className="menu-empty">
        <p>Назначенных курсов нет</p>
        <span>Когда руководитель назначит вам курс, он появится здесь</span>
      </div>
    );
  }
  const active = items.filter((i) => i.state.status !== 'done');
  const done = items.filter((i) => i.state.status === 'done');
  const list = (rows) => (
    <ul className="tr-list">
      {rows.map(({ course: c, state: s }) => (
        <li key={c.id}>
          <button className="tr-row" onClick={() => onOpen(c.id)}>
            <Cover id={c.coverId} />
            <span className="tr-row-main">
              <span className="tr-row-title">{c.title}</span>
              <span className="tr-row-sub">
                {s.lessonsDone} из {s.lessonsTotal} {plural(s.lessonsTotal, ['урока', 'уроков', 'уроков'])}
                {s.test !== 'none' && ` · тест: ${s.test === 'passed' ? `сдан, ${s.best}%` : s.test === 'failed' ? `не сдан, лучший ${s.best}%` : 'впереди'}`}
              </span>
            </span>
            <span className="tr-row-meta">
              <span className="tr-bar" aria-hidden="true"><i style={{ width: `${s.percent}%` }} /></span>
              {c.due && s.status !== 'done' && <span className={s.status === 'overdue' ? 'is-overdue' : ''}>до {fmtDate(c.due)}</span>}
              {s.status === 'done' && s.completedAt && <span>{fmtDate(s.completedAt)}</span>}
              <StatusBadge status={s.status} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      {active.length > 0 && list(active)}
      {done.length > 0 && (
        <>
          <h2 className="tr-section-title">Завершённые</h2>
          {list(done)}
        </>
      )}
    </>
  );
}

// ---------- Курсы (руководитель) ----------

function CourseList({ courses, progress, filter, onFilter, onOpen }) {
  const shown = courses
    .filter((c) => (filter === 'archived' ? c.status === 'archived' : c.status !== 'archived'))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const archivedCount = courses.filter((c) => c.status === 'archived').length;
  return (
    <>
      <div className="tr-filter">
        {[
          ['active', 'Активные'],
          ['archived', `Архив${archivedCount ? ` · ${archivedCount}` : ''}`],
        ].map(([id, label]) => (
          <button key={id} className={`tr-pill ${filter === id ? 'is-on' : ''}`} onClick={() => onFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="menu-empty">
          <p>{filter === 'archived' ? 'В архиве пусто' : 'Курсов пока нет'}</p>
          <span>{filter === 'archived' ? 'Сюда попадают курсы, которые больше не проходят' : 'Создайте первый курс: уроки, материалы и тест'}</span>
        </div>
      ) : (
        <ul className="tr-list">
          {shown.map((c) => {
            const assigned = c.assignees?.length ?? 0;
            const done = (c.assignees ?? []).filter((uid2) => courseState(c, progress.find((r) => r.courseId === c.id && r.userId === uid2)).complete).length;
            return (
              <li key={c.id}>
                <button className="tr-row" onClick={() => onOpen(c.id)}>
                  <Cover id={c.coverId} />
                  <span className="tr-row-main">
                    <span className="tr-row-title">{c.title}</span>
                    <span className="tr-row-sub">{courseSummary(c)}</span>
                  </span>
                  <span className="tr-row-meta">
                    <span>{assigned ? `завершили ${done} из ${assigned}` : 'никому не назначен'}</span>
                    <span>{fmtDate(c.updatedAt)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// ---------- Результаты команды ----------

function TeamResults({ courses, progress, users, filter, onFilter, onOpen }) {
  const userById = Object.fromEntries(users.map((u) => [u.id, u]));
  const rows = [];
  for (const c of courses) {
    if (c.status === 'archived') continue;
    for (const userId of c.assignees ?? []) {
      const rec = progress.find((r) => r.courseId === c.id && r.userId === userId);
      rows.push({ c, u: userById[userId] ?? { id: userId, name: 'Пользователь удалён' }, s: courseState(c, rec), rec });
    }
  }
  const q = filter.query.trim().toLowerCase();
  const shown = rows
    .filter((r) => !filter.course || r.c.id === filter.course)
    .filter((r) => !filter.status || r.s.status === filter.status)
    .filter((r) => !q || `${r.u.name} ${r.u.position ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => STATUS_ORDER[a.s.status] - STATUS_ORDER[b.s.status] || a.u.name.localeCompare(b.u.name, 'ru'));
  const counts = rows.reduce((acc, r) => ((acc[r.s.status] = (acc[r.s.status] ?? 0) + 1), acc), {});
  const set = (patch) => onFilter({ ...filter, ...patch });

  return (
    <>
      <section className="rv-summary tr-summary">
        {['new', 'progress', 'overdue', 'done'].map((st) => (
          <button key={st} className={`rv-sum ${filter.status === st ? 'is-on' : ''}`} onClick={() => set({ status: filter.status === st ? '' : st })}>
            <span>{STATUS_LABEL[st]}</span>
            <b className={st === 'overdue' && counts[st] ? 'is-alert' : ''}>{counts[st] ?? 0}</b>
          </button>
        ))}
      </section>
      <div className="rv-toolbar tr-team-toolbar">
        <input className="rv-search" type="search" placeholder="Поиск по сотруднику" value={filter.query} onChange={(e) => set({ query: e.target.value })} />
        <select value={filter.course} onChange={(e) => set({ course: e.target.value })} aria-label="Курс">
          <option value="">Все курсы</option>
          {courses.filter((c) => c.status !== 'archived').map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <select value={filter.status} onChange={(e) => set({ status: e.target.value })} aria-label="Статус">
          <option value="">Любой статус</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {shown.length === 0 ? (
        <div className="menu-empty">
          <p>{rows.length ? 'Ничего не найдено' : 'Курсы ещё никому не назначены'}</p>
          <span>{rows.length ? 'Измените фильтры' : 'Назначьте курс сотрудникам в его настройках'}</span>
        </div>
      ) : (
        <div className="tr-table-wrap">
          <table className="tr-table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Курс</th>
                <th>Уроки</th>
                <th>Тест</th>
                <th>Статус</th>
                <th>Активность</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ c, u, s, rec }) => (
                <tr key={`${c.id}:${u.id}`} onClick={() => onOpen(c.id)}>
                  <td>
                    <b>{u.name}</b>
                    {u.position && <small>{u.position}</small>}
                  </td>
                  <td>{c.title}</td>
                  <td>{s.lessonsDone} / {s.lessonsTotal}</td>
                  <td>{s.test === 'none' ? '—' : s.best === null ? 'не сдавал' : `${s.best}%${s.test === 'passed' ? '' : ' · не сдан'}`}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="tr-muted">{rec?.updatedAt ? fmtDate(rec.updatedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------- Страница курса ----------

function CourseView({ course, state, assigned, manager, go, error, users, progress, onArchive, onReset }) {
  const [confirmReset, setConfirmReset] = useState(null);
  const archived = course.status === 'archived';
  const lessonLocked = (i) => assigned && course.lessons.slice(0, i).some((l) => !state.done.has(l.id));
  const testLocked = assigned && state.lessonsDone < state.lessonsTotal;
  const next = state.nextLesson ? { mode: 'lesson', id: course.id, lessonId: state.nextLesson.id } : hasTest(course) && state.test !== 'passed' ? { mode: 'test', id: course.id } : null;

  return (
    <article className="tr-course">
      <nav className="crumbs std-crumbs" aria-label="Путь">
        <span className="crumb-wrap">
          <button className="crumb" onClick={() => go({ mode: 'list', tab: assigned ? 'my' : 'courses' })}>
            {assigned ? 'Моё обучение' : 'Курсы'}
          </button>
        </span>
      </nav>
      <div className="page-head std-head">
        <h1>
          {archived && <span className="std-badge tr-archived">Архив</span>}
          {course.title}
        </h1>
        {manager && (
          <div className="docs-actions">
            <button className="btn btn-outline" onClick={() => onArchive(!archived)}>{archived ? 'Вернуть из архива' : 'В архив'}</button>
            <button className="btn btn-outline" onClick={() => go({ mode: 'edit', id: course.id })}>Редактировать</button>
          </div>
        )}
      </div>

      <div className="tr-intro">
        {course.coverId && <Cover id={course.coverId} size="lg" />}
        <div className="tr-intro-text">
          {course.description && <p className="std-desc">{course.description}</p>}
          <p className="std-meta">
            {courseSummary(course)}
            {hasTest(course) && ` · проходной балл ${course.test.passScore}%`}
            {course.due && ` · пройти до ${fmtDate(course.due)}`}
          </p>
          {assigned && (
            <div className="tr-progress">
              <span className="tr-bar is-wide" aria-hidden="true"><i style={{ width: `${state.percent}%` }} /></span>
              <span>{state.percent}%</span>
              <StatusBadge status={state.status} />
              {next ? (
                <button className="btn btn-primary" onClick={() => go(next)}>
                  {state.lessonsDone || state.attempts.length ? 'Продолжить' : 'Начать'}
                </button>
              ) : (
                state.complete && <span className="tr-done-note">Курс пройден{state.completedAt ? ` ${fmtDate(state.completedAt)}` : ''}</span>
              )}
            </div>
          )}
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}

      <h2 className="tr-section-title">Программа</h2>
      <ol className="tr-program">
        {course.lessons.map((l, i) => {
          const done = state.done.has(l.id);
          const locked = lessonLocked(i);
          return (
            <li key={l.id} className={`${done ? 'is-done' : ''} ${locked ? 'is-locked' : ''}`}>
              <button disabled={locked} onClick={() => go({ mode: 'lesson', id: course.id, lessonId: l.id })}>
                <span className="tr-lesson-num">{done ? '✓' : i + 1}</span>
                <span className="tr-program-title">{l.title}</span>
                <span className="tr-program-meta">{assigned ? (done ? 'пройден' : locked ? 'после предыдущих' : 'доступен') : ''}</span>
              </button>
            </li>
          );
        })}
        {hasTest(course) && (
          <li className={`${state.test === 'passed' ? 'is-done' : ''} ${testLocked ? 'is-locked' : ''}`}>
            <button disabled={testLocked} onClick={() => go({ mode: 'test', id: course.id })}>
              <span className="tr-lesson-num">{state.test === 'passed' ? '✓' : 'Т'}</span>
              <span className="tr-program-title">Итоговый тест</span>
              <span className="tr-program-meta">
                {assigned
                  ? state.test === 'passed'
                    ? `сдан, ${state.best}%`
                    : testLocked
                      ? 'после всех уроков'
                      : state.best !== null
                        ? `лучший результат ${state.best}%`
                        : 'доступен'
                  : `${course.test.questions.length} ${plural(course.test.questions.length, ['вопрос', 'вопроса', 'вопросов'])}`}
              </span>
            </button>
          </li>
        )}
      </ol>

      {manager && (
        <>
          <h2 className="tr-section-title">
            Прогресс команды <span>{course.assignees?.length ?? 0}</span>
          </h2>
          {(course.assignees ?? []).length === 0 ? (
            <p className="std-muted">Курс пока никому не назначен — выберите сотрудников в редакторе курса.</p>
          ) : (
            <ul className="tr-list">
              {course.assignees.map((userId) => {
                const u = users[userId] ?? { name: 'Пользователь удалён' };
                const rec = progress.find((r) => r.courseId === course.id && r.userId === userId);
                const s = courseState(course, rec);
                return (
                  <li key={userId} className="tr-member">
                    <span className="tr-row-main">
                      <span className="tr-row-title">{u.name}</span>
                      <span className="tr-row-sub">
                        {s.lessonsDone} из {s.lessonsTotal} уроков
                        {s.test !== 'none' && ` · тест: ${s.best === null ? 'не сдавал' : `${s.best}%`}${s.attempts.length ? `, попыток ${s.attempts.length}` : ''}`}
                        {rec?.updatedAt && ` · ${fmtDate(rec.updatedAt)}`}
                      </span>
                    </span>
                    <StatusBadge status={s.status} />
                    {rec &&
                      (confirmReset === userId ? (
                        <button className="link-btn std-danger" onClick={() => (onReset(userId), setConfirmReset(null))}>
                          Сбросить прогресс?
                        </button>
                      ) : (
                        <button className="link-btn" onClick={() => setConfirmReset(userId)}>
                          Сбросить
                        </button>
                      ))}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </article>
  );
}

// ---------- Урок ----------

function LessonView({ course, state, assigned, go, error, index, onComplete }) {
  const lesson = course.lessons[index];
  const [docsRaw] = useShared(DOCS_KEY, []);
  const docsById = useMemo(() => Object.fromEntries(docsRaw.map((n) => [n.id, n])), [docsRaw]);
  const [articles] = useShared(STANDARDS_KEY, []);
  const [categories] = useShared(STANDARD_CATEGORIES_KEY, DEFAULT_CATEGORIES);
  const [viewId, setViewId] = useState(null);
  const [readId, setReadId] = useState(null);
  const [busy, setBusy] = useState(false);
  const done = state.done.has(lesson.id);
  const prev = course.lessons[index - 1];
  const next = course.lessons[index + 1];
  const reading = readId && articles.find((a) => a.id === readId);

  return (
    <article className="tr-lesson">
      <nav className="crumbs std-crumbs" aria-label="Путь">
        <span className="crumb-wrap">
          <button className="crumb" onClick={() => go({ mode: 'course', id: course.id })}>{course.title}</button>
          <span className="crumb-sep">/</span>
        </span>
        <span className="crumb-wrap">
          <span className="crumb is-current">Урок {index + 1} из {course.lessons.length}</span>
        </span>
      </nav>
      <div className="page-head std-head">
        <h1>{lesson.title}</h1>
        {done && <span className="tr-status is-done">Пройден</span>}
      </div>

      {(lesson.attachments ?? []).length + (lesson.standards ?? []).length > 0 && (
        <section className="std-attach is-view">
          <h2 className="std-attach-title">Материалы</h2>
          <div className="tr-materials">
            <Attachments ids={lesson.attachments ?? []} byId={docsById} onOpen={setViewId} />
            <StandardLinks ids={lesson.standards ?? []} articles={articles} categories={categories} onOpen={setReadId} />
          </div>
        </section>
      )}

      <div className="std-panel">
        {(lesson.videos ?? []).map((v) => (
          <video key={v.id} className="tr-video" src={`/api/files/${v.id}`} controls preload="metadata" />
        ))}
        {lesson.html ? (
          <div className="std-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(lesson.html) }} />
        ) : (
          !(lesson.videos ?? []).length && <p className="std-muted">В уроке пока нет текста — изучите материалы выше.</p>
        )}
      </div>

      {error && <p className="form-error tr-error">{error}</p>}

      <div className="std-actions tr-nav">
        {prev && (
          <button className="btn btn-ghost btn-left tr-prev" onClick={() => go({ mode: 'lesson', id: course.id, lessonId: prev.id })}>
            ← {prev.title}
          </button>
        )}
        {assigned && !done ? (
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onComplete(lesson.id);
              setBusy(false);
            }}
          >
            {next ? 'Урок пройден, дальше' : hasTest(course) ? 'Урок пройден, к тесту' : 'Завершить курс'}
          </button>
        ) : next ? (
          <button className="btn btn-outline" onClick={() => go({ mode: 'lesson', id: course.id, lessonId: next.id })}>
            Следующий урок →
          </button>
        ) : hasTest(course) ? (
          <button className="btn btn-outline" onClick={() => go({ mode: 'test', id: course.id })}>
            К тесту →
          </button>
        ) : (
          <button className="btn btn-outline" onClick={() => go({ mode: 'course', id: course.id })}>
            К программе курса
          </button>
        )}
      </div>

      {viewId && docsById[viewId] && <FileViewer node={docsById[viewId]} onClose={() => setViewId(null)} />}
      {reading && <StandardReader article={reading} onClose={() => setReadId(null)} />}
    </article>
  );
}

// ---------- Тест ----------

function TestView({ course, state, assigned, go, onResult }) {
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const questions = course.test.questions;
  const lessonsLeft = state.lessonsTotal - state.lessonsDone;
  const unanswered = questions.filter((q) => !(answers[q.id] ?? []).length).length;

  const pick = (q, optionId, checked) =>
    setAnswers((a) => {
      const cur = a[q.id] ?? [];
      return { ...a, [q.id]: q.multiple ? (checked ? [...cur, optionId] : cur.filter((x) => x !== optionId)) : [optionId] };
    });

  const submit = async (e) => {
    e.preventDefault();
    if (unanswered) return setError(`Ответьте на все вопросы — осталось ${unanswered}`);
    setBusy(true);
    setError('');
    try {
      const res = await api('/api/training/submit', { method: 'POST', body: { courseId: course.id, answers } });
      onResult(res);
      setResult(res.attempt);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const crumbs = (
    <nav className="crumbs std-crumbs" aria-label="Путь">
      <span className="crumb-wrap">
        <button className="crumb" onClick={() => go({ mode: 'course', id: course.id })}>{course.title}</button>
        <span className="crumb-sep">/</span>
      </span>
      <span className="crumb-wrap">
        <span className="crumb is-current">Итоговый тест</span>
      </span>
    </nav>
  );

  if (result) {
    return (
      <article className="tr-test">
        {crumbs}
        <div className="page-head std-head">
          <h1>{result.passed ? 'Тест сдан' : 'Тест не сдан'}</h1>
        </div>
        <div className="std-panel tr-result">
          <b className={result.passed ? 'is-pass' : 'is-fail'}>{result.score}%</b>
          <p>
            Верных ответов: {result.correct} из {result.total}. Проходной балл — {course.test.passScore}%.
          </p>
          <p className="std-muted">
            {result.passed
              ? state.lessonsDone === state.lessonsTotal
                ? 'Курс завершён — результат сохранён и виден руководителю.'
                : 'Результат сохранён.'
              : 'Повторите материалы курса и попробуйте ещё раз — количество попыток не ограничено.'}
          </p>
          <div className="tr-result-actions">
            {!result.passed && (
              <button
                className="btn btn-primary"
                onClick={() => {
                  setAnswers({});
                  setResult(null);
                }}
              >
                Пройти ещё раз
              </button>
            )}
            <button className="btn btn-outline" onClick={() => go({ mode: 'course', id: course.id })}>К программе курса</button>
          </div>
        </div>
      </article>
    );
  }

  const preview = !assigned;
  return (
    <form className="tr-test" onSubmit={submit}>
      {crumbs}
      <div className="page-head std-head">
        <h1>Итоговый тест</h1>
      </div>
      <p className="std-meta">
        {questions.length} {plural(questions.length, ['вопрос', 'вопроса', 'вопросов'])} · проходной балл {course.test.passScore}%
        {state.attempts.length > 0 && ` · попыток ${state.attempts.length}, лучший результат ${state.best}%`}
      </p>
      {preview && <p className="std-muted tr-note">Просмотр: курс вам не назначен, ответы не сохраняются.</p>}
      {assigned && lessonsLeft > 0 && (
        <p className="std-muted tr-note">
          Тест откроется после всех уроков — осталось {lessonsLeft} {plural(lessonsLeft, ['урок', 'урока', 'уроков'])}.
        </p>
      )}
      <ol className="tr-quiz">
        {questions.map((q, i) => (
          <li key={q.id} className="std-panel">
            <p className="tr-quiz-q">
              <span>{i + 1}.</span> {q.text}
            </p>
            {q.multiple && <p className="tr-quiz-hint">Несколько верных ответов</p>}
            <div className="tr-quiz-options">
              {q.options.map((o) => (
                <label key={o.id} className={`tr-option ${(answers[q.id] ?? []).includes(o.id) ? 'is-on' : ''}`}>
                  <input
                    type={q.multiple ? 'checkbox' : 'radio'}
                    name={q.id}
                    disabled={preview || lessonsLeft > 0}
                    checked={(answers[q.id] ?? []).includes(o.id)}
                    onChange={(e) => pick(q, o.id, e.target.checked)}
                  />
                  {o.text}
                </label>
              ))}
            </div>
          </li>
        ))}
      </ol>
      {error && <p className="form-error tr-error">{error}</p>}
      {assigned && lessonsLeft === 0 && (
        <div className="std-actions">
          <span className="std-confirm">{unanswered ? `Без ответа: ${unanswered}` : 'Все вопросы отвечены'}</span>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Проверяем…' : 'Отправить ответы'}</button>
        </div>
      )}
    </form>
  );
}

function Missing({ text = 'Курс не найден', onBack }) {
  return (
    <div className="menu-empty std-missing">
      <p>{text}</p>
      <button className="link-btn" onClick={onBack}>К обучению</button>
    </div>
  );
}
