import { useState } from 'react';
import EditModal from './EditModal.jsx';
import { IconPlus } from './Icons.jsx';
import { fmtMoney, plural, MONTHS_GEN } from '../utils.js';
import { todayIso } from '../menus.js';
import { EVENTS_KEY, FORMATS, MODES, STATUSES, label, loadCafeEvents, modeText } from '../cafeEvents.js';
import { useShared } from '../sync.js';

const uid = () => `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const NUMBER_FIELDS = ['guestsPlan', 'guestsFact', 'revenue', 'cost'];

const FIELDS = [
  { name: 'title', label: 'Название', required: true, placeholder: 'Например, Квиз «Кино 90-х»' },
  { name: 'format', label: 'Формат', options: FORMATS, row: 'kind' },
  { name: 'mode', label: 'Работа кафе', options: MODES, row: 'kind' },
  { name: 'date', label: 'Дата', type: 'date', required: true, row: 'when' },
  { name: 'start', label: 'Начало', type: 'time', row: 'when' },
  { name: 'end', label: 'Конец', type: 'time', row: 'when' },
  { name: 'status', label: 'Статус', options: STATUSES, row: 'who' },
  { name: 'host', label: 'Ведущий / организатор', placeholder: 'Кто проводит', row: 'who' },
  { name: 'description', label: 'Описание', textarea: true, placeholder: 'Концепция, программа, что нужно подготовить, условия для гостей' },
  { name: 'guestsPlan', label: 'Гостей по плану', inputMode: 'numeric', placeholder: '0', row: 'guests' },
  { name: 'guestsFact', label: 'Гостей по факту', inputMode: 'numeric', placeholder: '—', row: 'guests' },
  { name: 'revenue', label: 'Выручка, ₽', inputMode: 'decimal', placeholder: '—', row: 'money' },
  { name: 'cost', label: 'Расходы, ₽', inputMode: 'decimal', placeholder: '—', row: 'money' },
];

const toNum = (s) => {
  const t = String(s ?? '').replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

const validate = (v) => {
  if (v.start && v.end && v.end <= v.start && v.mode !== 'night') return 'Конец должен быть позже начала';
  const bad = NUMBER_FIELDS.find((k) => toNum(v[k]) === undefined);
  if (bad) return `Поле «${FIELDS.find((f) => f.name === bad).label}» — это число`;
  return null;
};

const isPast = (e, today) => e.status === 'done' || (e.status !== 'cancelled' && e.date < today);
const result = (e) => (e.revenue ?? 0) - (e.cost ?? 0);

function DateBadge({ date }) {
  const [y, m, d] = date.split('-').map(Number);
  return (
    <div className="ev-date">
      <b>{d}</b>
      <span>{MONTHS_GEN[m - 1].slice(0, 3)}</span>
      <small>{WEEKDAYS[new Date(y, m - 1, d).getDay()]}</small>
    </div>
  );
}

export default function EventsPage({ focusId }) {
  const [events, setEvents] = useShared(EVENTS_KEY, []);
  const [view, setView] = useState('upcoming');
  const [edit, setEdit] = useState(() => (focusId ? loadCafeEvents().find((e) => e.id === focusId) ?? null : null));


  const today = todayIso();
  const upcoming = events.filter((e) => e.status !== 'cancelled' && !isPast(e, today)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const past = events.filter((e) => isPast(e, today)).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
  const cancelled = events.filter((e) => e.status === 'cancelled').sort((a, b) => b.date.localeCompare(a.date));
  const list = { upcoming, past, cancelled }[view];

  const held = past.filter((e) => e.status === 'done');
  const guests = held.reduce((s, e) => s + (e.guestsFact ?? 0), 0);
  const money = held.filter((e) => e.revenue !== null || e.cost !== null);
  const total = money.reduce((s, e) => s + result(e), 0);
  const needResults = past.filter((e) => e.status !== 'done').length;

  const save = (values) => {
    const clean = { ...values };
    for (const k of NUMBER_FIELDS) clean[k] = toNum(values[k]);
    setEvents((list) =>
      edit.id ? list.map((e) => (e.id === edit.id ? { ...e, ...clean } : e)) : [...list, { id: uid(), ...clean }],
    );
    setEdit(null);
  };

  const remove = () => {
    setEvents((list) => list.filter((e) => e.id !== edit.id));
    setEdit(null);
  };

  const card = (e) => {
    const done = e.status === 'done';
    const r = result(e);
    const hasMoney = e.revenue !== null || e.cost !== null;
    const overdue = !done && e.status !== 'cancelled' && e.date < today;
    return (
      <button key={e.id} className={`ev is-${e.status} ${overdue ? 'is-overdue' : ''}`} onClick={() => setEdit(e)}>
        <DateBadge date={e.date} />
        <div className="ev-main">
          <div className="ev-tags">
            <span className="ev-format">{label(FORMATS, e.format)}</span>
            <span className={`ev-mode is-${e.mode}`}>{modeText(e)}</span>
          </div>
          <h3>{e.title}</h3>
          {e.description && <p>{e.description}</p>}
          <div className="ev-facts">
            {e.host && <span>Ведущий: {e.host}</span>}
            <span>
              Гости: {done && e.guestsFact !== null ? <b>{e.guestsFact}</b> : '—'}
              {e.guestsPlan !== null && ` из ${e.guestsPlan} план`}
            </span>
            {hasMoney && (
              <span>
                Итог: <b className={r < 0 ? 'is-neg' : ''}>{fmtMoney(r)}</b>
              </span>
            )}
          </div>
        </div>
        <span className={`ev-status is-${overdue ? 'overdue' : e.status}`}>
          {overdue ? 'Внесите итоги' : label(STATUSES, e.status)}
        </span>
      </button>
    );
  };

  return (
    <>
      <div className="page-head">
        <h1>Мероприятия</h1>
        <button className="btn btn-primary btn-icon" onClick={() => setEdit({ format: 'quiz', mode: 'closed', status: 'planned', date: today })}>
          <IconPlus size={16} />
          Новое мероприятие
        </button>
      </div>

      {events.length > 0 && (
        <div className="stats ev-stats">
          <section className="stat">
            <div className="stat-label">Предстоит</div>
            <div className="stat-value">{upcoming.length}</div>
            <div className="stat-sub">
              <span>{upcoming[0] ? `Ближайшее ${Number(upcoming[0].date.slice(8))} ${MONTHS_GEN[Number(upcoming[0].date.slice(5, 7)) - 1]}` : 'Нет запланированных'}</span>
            </div>
          </section>
          <section className="stat">
            <div className="stat-label">Проведено</div>
            <div className="stat-value">{held.length}</div>
            <div className="stat-sub">
              <span>{needResults ? `${needResults} ждут итогов` : 'Итоги внесены'}</span>
            </div>
          </section>
          <section className="stat">
            <div className="stat-label">Гостей пришло</div>
            <div className="stat-value">{guests}</div>
            <div className="stat-sub">
              <span>{held.length ? `≈ ${Math.round(guests / held.length)} в среднем` : '—'}</span>
            </div>
          </section>
          <section className="stat">
            <div className="stat-label">Результат</div>
            <div className={`stat-value ${total < 0 ? 'is-neg' : ''}`}>{money.length ? fmtMoney(total) : '—'}</div>
            <div className="stat-sub"><span>Выручка минус расходы по проведённым</span></div>
          </section>
        </div>
      )}

      <div className="tabs menu-tabs" role="tablist">
        {[
          ['upcoming', 'Предстоящие', upcoming.length],
          ['past', 'Прошедшие', past.length],
          ['cancelled', 'Отменённые', cancelled.length],
        ].map(([v, l, n]) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'is-active' : ''} onClick={() => setView(v)}>
            {l}
            <span>{n}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="menu-empty">
          <p>
            {view === 'upcoming' ? 'Нет запланированных мероприятий' : view === 'past' ? 'Прошедших мероприятий пока нет' : 'Отменённых нет'}
          </p>
          {view === 'upcoming' && <span>Квизы, встречи, клубы по интересам — всё, ради чего кафе закрывается или работает ночью. Даты сразу попадут в календарь</span>}
        </div>
      ) : (
        <div className="evs">{list.map(card)}</div>
      )}

      {edit && (
        <EditModal
          title={edit.id ? 'Мероприятие' : 'Новое мероприятие'}
          fields={FIELDS}
          initial={Object.fromEntries(Object.entries(edit).map(([k, v]) => [k, v ?? '']))}
          validate={validate}
          onSave={save}
          onDelete={edit.id ? remove : undefined}
          deleteHint="Удалить мероприятие? Оно пропадёт и из календаря"
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}
