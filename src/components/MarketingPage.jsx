import { useMemo, useState } from 'react';
import EditModal from './EditModal.jsx';
import { IconChevronLeft, IconChevronRight, IconPlus } from './Icons.jsx';
import { iso } from '../data.js';
import { MONTHS, MONTHS_GEN, fmtDay, plural } from '../utils.js';
import { MENUS_KEY } from '../menus.js';
import { CAL_KEY, CAL_TYPES, calTypeById, endOf, linkedEvents } from '../calendar.js';
import { useShared } from '../sync.js';
import { EVENTS_KEY } from '../cafeEvents.js';
import { COLLABS_KEY } from '../collabs.js';

const uid = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const TYPES = CAL_TYPES;
const typeById = calTypeById;
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const FIELDS = [
  { name: 'title', label: 'Название', required: true, placeholder: 'Например, Скидка 20% на бизнес-ланч' },
  { name: 'type', label: 'Тип', options: TYPES.filter((t) => t.id !== 'menu' && t.id !== 'collab').map((t) => [t.id, t.label]) },
  { name: 'start', label: 'Начало', type: 'date', required: true },
  { name: 'end', label: 'Окончание (если несколько дней)', type: 'date' },
  { name: 'note', label: 'Заметка', textarea: true, placeholder: 'Каналы, бюджет, ответственный' },
];

const validate = (v) => (v.end && v.end < v.start ? 'Окончание не может быть раньше начала' : null);
const fmtRange = (e) => (e.end && e.end !== e.start ? `${fmtDay(e.start)} — ${fmtDay(e.end)}` : fmtDay(e.start));

export default function MarketingPage({ onOpenMenu, onOpenEvent, onOpenCollab }) {
  const today = useMemo(() => new Date(), []);
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());

  const [events, setEvents] = useShared(CAL_KEY, []);
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [hidden, setHidden] = useState(() => new Set());
  // { item?, date? }
  const [edit, setEdit] = useState(null);


  const { y, m } = cursor;
  const shift = (delta) => {
    const d = new Date(y, m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
  };

  // Подписка на разделы, из которых календарь берёт события: чужие правки появляются сразу.
  const [menusRaw] = useShared(MENUS_KEY, []);
  const [cafeRaw] = useShared(EVENTS_KEY, []);
  const [collabsRaw] = useShared(COLLABS_KEY, null);
  const fromMenus = useMemo(() => linkedEvents(), [menusRaw, cafeRaw, collabsRaw]); // eslint-disable-line react-hooks/exhaustive-deps
  const openEvent = (e) =>
    e.menuId
      ? onOpenMenu?.(e.menuId)
      : e.cafeEventId
        ? onOpenEvent?.(e.cafeEventId)
        : e.collabId
          ? onOpenCollab?.(e.collabId)
          : setEdit({ item: e });

  const visible = useMemo(
    () =>
      [...events, ...fromMenus]
        .filter((e) => !hidden.has(e.type))
        .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title)),
    [events, fromMenus, hidden],
  );

  const weeks = useMemo(() => {
    const offset = (new Date(y, m, 1).getDay() + 6) % 7;
    const count = Math.ceil((offset + new Date(y, m + 1, 0).getDate()) / 7);
    return Array.from({ length: count }, (_, w) =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(y, m, 1 - offset + w * 7 + i);
        const date = iso(d.getFullYear(), d.getMonth(), d.getDate());
        return {
          date,
          day: d.getDate(),
          outside: d.getMonth() !== m,
          weekStart: i === 0,
          events: visible.filter((e) => e.start <= date && endOf(e) >= date),
        };
      }),
    );
  }, [y, m, visible]);

  const monthStart = iso(y, m, 1);
  const monthEnd = iso(y, m, new Date(y, m + 1, 0).getDate());
  const monthEvents = visible.filter((e) => e.start <= monthEnd && endOf(e) >= monthStart);

  const toggleType = (id) =>
    setHidden((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const save = (values) => {
    const event = { ...values, end: values.end && values.end !== values.start ? values.end : '' };
    setEvents((list) =>
      edit.item ? list.map((e) => (e.id === edit.item.id ? { ...e, ...event } : e)) : [...list, { id: uid(), ...event }],
    );
    if (event.start > monthEnd || endOf(event) < monthStart) {
      setCursor({ y: Number(event.start.slice(0, 4)), m: Number(event.start.slice(5, 7)) - 1 });
    }
    setEdit(null);
  };

  const remove = () => {
    setEvents((list) => list.filter((e) => e.id !== edit.item.id));
    setEdit(null);
  };

  const isCurrentMonth = y === today.getFullYear() && m === today.getMonth();

  return (
    <>
      <div className="page-head">
        <h1>Календарь</h1>
        <button className="btn btn-primary btn-icon" onClick={() => setEdit({ date: isCurrentMonth ? todayIso : monthStart })}>
          <IconPlus size={16} />
          Добавить событие
        </button>
      </div>

      <div className="cal-toolbar">
        <h2>{MONTHS[m]} {y}</h2>
        <div className="pager">
          <button aria-label="Предыдущий месяц" onClick={() => shift(-1)}>
            <IconChevronLeft size={18} />
          </button>
          <button aria-label="Следующий месяц" onClick={() => shift(1)}>
            <IconChevronRight size={18} />
          </button>
        </div>
        {!isCurrentMonth && (
          <button className="btn btn-outline cal-today" onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>
            Сегодня
          </button>
        )}

        <div className="cal-types" aria-label="Фильтр по типу">
          {TYPES.map((t) => (
            <button
              key={t.id}
              className={`cal-type ${hidden.has(t.id) ? 'is-off' : ''}`}
              aria-pressed={!hidden.has(t.id)}
              onClick={() => toggleType(t.id)}
            >
              <i style={{ background: t.fg }} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cal-layout">
        <div className="cal">
          <div className="cal-weekdays">
            {WEEKDAYS.map((d) => <div key={d}>{d}</div>)}
          </div>
          {weeks.map((week) => (
            <div key={week[0].date} className="cal-week">
              {week.map((cell) => (
                <div
                  key={cell.date}
                  className={`cal-cell ${cell.outside ? 'is-outside' : ''} ${cell.date === todayIso ? 'is-today' : ''}`}
                  onClick={() => setEdit({ date: cell.date })}
                >
                  <div className="cal-cell-head">
                    <span className="cal-num">{cell.day}</span>
                    <button
                      className="cal-add"
                      aria-label={`Добавить событие на ${fmtDay(cell.date)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEdit({ date: cell.date });
                      }}
                    >
                      <IconPlus size={14} />
                    </button>
                  </div>
                  {cell.events.map((e) => {
                    const t = typeById[e.type] ?? TYPES[0];
                    const head = e.start === cell.date || cell.weekStart;
                    return (
                      <button
                        key={e.id}
                        className={`cal-chip ${head ? '' : 'is-cont'}`}
                        style={{ background: t.bg, color: t.fg }}
                        title={`${e.title} · ${fmtRange(e)}`}
                        aria-label={`${e.title}, ${fmtRange(e)}`}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          openEvent(e);
                        }}
                      >
                        {head ? e.title : ' '}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>

        <aside className="cal-list">
          <h3>
            {monthEvents.length
              ? `${monthEvents.length} ${plural(monthEvents.length, ['событие', 'события', 'событий'])} в ${MONTHS_GEN[m].replace(/[яа]$/, 'е')}`
              : 'В этом месяце событий нет'}
          </h3>
          {monthEvents.length === 0 ? (
            <p className="cal-list-hint">Нажмите на день в календаре, чтобы запланировать акцию, пост или рассылку</p>
          ) : (
            <ul className="rows">
              {monthEvents.map((e) => {
                const t = typeById[e.type] ?? TYPES[0];
                return (
                  <li key={e.id}>
                    <button className="cal-item" onClick={() => openEvent(e)}>
                      <span className="cal-item-main">
                        <span className="row-title">{e.title}</span>
                        <span className="row-sub">{fmtRange(e)}{e.note ? ` · ${e.note}` : ''}</span>
                      </span>
                      <span className="pill" style={{ background: t.bg, color: t.fg }}>{t.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>

      {edit && (
        <EditModal
          title={edit.item ? 'Событие' : 'Новое событие'}
          fields={FIELDS}
          initial={edit.item ?? { type: TYPES[0].id, start: edit.date }}
          validate={validate}
          onSave={save}
          onDelete={edit.item ? remove : undefined}
          deleteHint="Удалить событие?"
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}
