import { useMemo, useState } from 'react';
import EditModal from './EditModal.jsx';
import { IconChevronRight, IconPlus } from './Icons.jsx';
import { fmtDay, plural } from '../utils.js';
import { todayIso } from '../menus.js';
import { useShared } from '../sync.js';
import { TASKS_KEY } from '../tasks.js';
import UserPicker from './UserPicker.jsx';
import { canDelegate, useUsers } from '../users.js';
import { iso } from '../data.js';

const STORAGE_KEY = TASKS_KEY;
const uid = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const PRIORITIES = [
  ['normal', 'Обычный'],
  ['high', 'Высокий'],
  ['low', 'Низкий'],
];
const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };

const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

const fmtDue = (due, today) => {
  if (due === today) return 'Сегодня';
  const [y, m, d] = today.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  if (due === iso(next.getFullYear(), next.getMonth(), next.getDate())) return 'Завтра';
  const label = fmtDay(due);
  return due.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${due.slice(0, 4)}`;
};

const byDueThenPriority = (a, b) =>
  (a.due || '9999').localeCompare(b.due || '9999') ||
  PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
  a.created.localeCompare(b.created);

export default function TasksPage({ user, focusId }) {
  const [tasks, setTasks] = useShared(STORAGE_KEY, []);
  const users = useUsers(user);
  const delegate = canDelegate(user);
  const byId = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  const [draft, setDraft] = useState({ title: '', assigneeId: user.id, due: '' });
  const [assigneeFilter, setAssigneeFilter] = useState(null);
  const [showDone, setShowDone] = useState(false);
  // Переход из оповещения или со сводки — сразу открываем нужную задачу.
  const [edit, setEdit] = useState(() => (focusId ? tasks.find((t) => t.id === focusId) ?? null : null));


  const today = todayIso();
  // Ответственный — учётная запись; у старых задач — имя, записанное текстом.
  const nameOf = (t) => (t.assigneeId ? byId[t.assigneeId]?.name ?? t.assignee : t.assignee) || '';
  const personKey = (t) => t.assigneeId || (t.assignee ? `name:${t.assignee}` : '');
  const people = useMemo(() => {
    const map = new Map();
    for (const t of tasks) if (personKey(t)) map.set(personKey(t), nameOf(t));
    return [...map].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  }, [tasks, byId]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = tasks.filter((t) => !assigneeFilter || personKey(t) === assigneeFilter);
  const open = visible.filter((t) => !t.done).sort(byDueThenPriority);
  const done = visible.filter((t) => t.done).sort((a, b) => b.closedAt.localeCompare(a.closedAt));

  const groups = [
    ['overdue', 'Просрочено', open.filter((t) => t.due && t.due < today)],
    ['today', 'Сегодня', open.filter((t) => t.due === today)],
    ['upcoming', 'Предстоящие', open.filter((t) => t.due && t.due > today)],
    ['nodate', 'Без срока', open.filter((t) => !t.due)],
  ].filter(([, , list]) => list.length);

  const add = (e) => {
    e.preventDefault();
    const title = draft.title.trim();
    if (!title) return;
    const task = {
      id: uid(),
      title,
      note: '',
      // Сотрудник ставит задачи только себе — это же проверяет сервер.
      assigneeId: delegate ? draft.assigneeId : user.id,
      assignee: (delegate ? byId[draft.assigneeId]?.name : user.name) ?? '',
      createdById: user.id,
      createdByName: user.name,
      due: draft.due,
      priority: 'normal',
      done: false,
      created: new Date().toISOString(),
      closedAt: null,
    };
    setTasks((list) => [...list, task]);
    // Ответственного и срок оставляем: задачи часто накидывают пачкой на одного человека.
    setDraft((d) => ({ ...d, title: '' }));
  };

  const toggle = (id) =>
    setTasks((list) =>
      list.map((t) => (t.id === id ? { ...t, done: !t.done, closedAt: t.done ? null : new Date().toISOString() } : t)),
    );

  const save = (values) => {
    const patch = { ...values };
    if (delegate) patch.assignee = byId[values.assigneeId]?.name ?? '';
    else delete patch.assigneeId;
    setTasks((list) => list.map((t) => (t.id === edit.id ? { ...t, ...patch } : t)));
    setEdit(null);
  };

  const remove = () => {
    setTasks((list) => list.filter((t) => t.id !== edit.id));
    setEdit(null);
  };

  const fields = [
    { name: 'title', label: 'Задача', required: true },
    { name: 'note', label: 'Описание', textarea: true, placeholder: 'Детали, ожидаемый результат, ссылки' },
    {
      name: 'assigneeId',
      label: delegate ? 'Ответственный' : 'Ответственный — только вы',
      row: 'meta',
      render: (value, set) => <UserPicker value={value} users={users} onChange={set} allowEmpty disabled={!delegate} />,
    },
    { name: 'due', label: 'Срок', type: 'date', row: 'meta' },
    { name: 'priority', label: 'Приоритет', options: PRIORITIES },
  ];

  const row = (t) => {
    const overdue = !t.done && t.due && t.due < today;
    return (
      <li key={t.id} className={`task ${t.done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''}`}>
        <input
          type="checkbox"
          className="task-check"
          checked={t.done}
          onChange={() => toggle(t.id)}
          aria-label={t.done ? `Открыть задачу «${t.title}» снова` : `Закрыть задачу «${t.title}»`}
        />
        <button className="task-main" onClick={() => setEdit(t)}>
          <span className="task-title">
            {t.priority === 'high' && !t.done && <span className="task-flag">Важно</span>}
            {t.title}
          </span>
          {t.note && <span className="task-note">{t.note}</span>}
        </button>
        <div className="task-meta">
          {t.done ? (
            <span className="task-due">Закрыта {fmtDay(t.closedAt.slice(0, 10))}</span>
          ) : (
            t.due && <span className={`task-due ${overdue ? 'is-overdue' : ''}`}>{fmtDue(t.due, today)}</span>
          )}
          {t.createdById && t.createdById !== t.assigneeId && t.createdByName && (
            <span className="task-from" title="Кто поставил задачу">от {t.createdByName}</span>
          )}
          {nameOf(t) ? (
            <span className="task-person" title={nameOf(t)}>
              <i>{initials(nameOf(t))}</i>
              <span>{nameOf(t)}</span>
            </span>
          ) : (
            <span className="task-person is-empty">Без ответственного</span>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      <div className="page-head">
        <h1>Задачи управления</h1>
        {open.length > 0 && (
          <span className="page-count">
            {open.length} {plural(open.length, ['открытая', 'открытые', 'открытых'])}
          </span>
        )}
      </div>

      <form className="task-add" onSubmit={add}>
        <input
          className="task-add-title"
          placeholder="Новая задача и Enter"
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          aria-label="Новая задача"
        />
        <UserPicker
          className="task-add-person"
          value={delegate ? draft.assigneeId : user.id}
          users={users}
          onChange={(id) => setDraft((d) => ({ ...d, assigneeId: id }))}
          allowEmpty
          disabled={!delegate}
        />
        <input
          type="date"
          className="task-add-due"
          value={draft.due}
          onChange={(e) => setDraft((d) => ({ ...d, due: e.target.value }))}
          aria-label="Срок"
        />
        <button type="submit" className="btn btn-primary btn-icon" disabled={!draft.title.trim()}>
          <IconPlus size={16} />
          Добавить
        </button>
      </form>

      {people.length > 0 && (
        <div className="task-filters" role="group" aria-label="Ответственный">
          {[[null, 'Все'], ...people].map(([key, name]) => (
            <button key={key ?? 'all'} className={`cal-type ${assigneeFilter === key ? 'is-current' : ''}`} onClick={() => setAssigneeFilter(key)}>
              {key === user.id ? `${name} (вы)` : name}
            </button>
          ))}
        </div>
      )}

      {open.length === 0 ? (
        <div className="menu-empty">
          <p>{tasks.length ? 'Открытых задач нет' : 'Пока нет ни одной задачи'}</p>
          <span>
            {tasks.length
              ? 'Все задачи закрыты — отличная работа'
              : 'Запишите первую задачу: что сделать, кто отвечает и к какому сроку'}
          </span>
        </div>
      ) : (
        groups.map(([key, label, list]) => (
          <section key={key} className={`task-group is-${key}`}>
            <h3>
              {label}
              <span>{list.length}</span>
            </h3>
            <ul className="tasks">{list.map(row)}</ul>
          </section>
        ))
      )}

      {done.length > 0 && (
        <section className="task-group is-done">
          <button className="task-done-toggle" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
            <IconChevronRight size={16} className={showDone ? 'is-open' : ''} />
            Закрытые
            <span>{done.length}</span>
          </button>
          {showDone && <ul className="tasks">{done.map(row)}</ul>}
        </section>
      )}

      {edit && (
        <EditModal
          title="Задача"
          fields={fields}
          // У старых задач ответственный записан текстом — подбираем учётную запись с тем же именем.
          initial={{
            ...edit,
            assigneeId: edit.assigneeId ?? users.find((u) => u.name.toLowerCase() === (edit.assignee || '').toLowerCase())?.id ?? '',
          }}
          onSave={save}
          onDelete={remove}
          deleteHint="Удалить задачу?"
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}
