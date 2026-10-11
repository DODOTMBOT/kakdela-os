import { useEffect, useMemo, useState } from 'react';
import { useShared } from '../sync.js';
import { canSee, visibleRecords } from '../access.js';
import { TASKS_KEY, isOverdue } from '../tasks.js';
import { CAL_KEY, calTypeById, calendarEvents, endOf } from '../calendar.js';
import { MENUS_KEY, todayIso } from '../menus.js';
import { EVENTS_KEY, FORMATS, label, modeText } from '../cafeEvents.js';
import { COLLABS_KEY, EMPTY_COLLABS, KINDS, PHASES, isScheduled, normalizeCollabs, phaseOf } from '../collabs.js';
import { IDEAS_KEY, IDEA_COLUMNS, ideaStatus } from '../ideas.js';
import { iso } from '../data.js';
import { MONTHS_GEN, fmtMoney } from '../utils.js';
import { useNotifications } from '../notifications.js';
import { NotificationItem } from './NotificationsPage.jsx';
import { api } from '../api.js';
import { onRefresh } from '../users.js';

const HORIZON_DAYS = 28;
const LIST_LIMIT = 6;
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WEEKDAYS_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const PHASE_LABEL = Object.fromEntries(PHASES);
const KIND_LABEL = Object.fromEntries(KINDS);
const PRIORITY_LABEL = { high: 'высокий', normal: 'обычный', low: 'низкий' };

const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s, n) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
};
const shortDate = (s) => {
  const d = parse(s);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()].slice(0, 3)}`;
};

function when(date, today) {
  if (date === today) return 'сегодня';
  if (date === addDays(today, 1)) return 'завтра';
  return `${shortDate(date)}, ${WEEKDAYS[parse(date).getDay()]}`;
}

const period = (start, end) => (end && end !== start ? `${shortDate(start)} – ${shortDate(end)}` : shortDate(start));

// Задача «моя», если она назначена на мою учётную запись; у старых задач — по имени или логину.
const isMine = (task, user) => {
  if (task.assigneeId) return task.assigneeId === user.id;
  const who = (task.assignee || '').trim().toLowerCase();
  return Boolean(who) && (who === user.name.trim().toLowerCase() || who === user.login);
};

const inWindow = (start, end, today, horizon) => start <= horizon && (end || start) >= today;

const avgFmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Сводка по отзывам: средняя, сколько каких оценок и когда был последний отзыв.
function reviewStats(list) {
  const rated = list.filter((r) => typeof r.rating === 'number');
  const stars = [5, 4, 3, 2, 1].map((n) => [n, rated.filter((r) => Math.round(r.rating) === n).length]);
  const last = list.reduce((max, r) => (r.date && r.date > max ? r.date : max), '');
  return { total: list.length, avg: rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : null, stars, last };
}

function ReviewStats({ stats, today }) {
  const max = Math.max(1, ...stats.stars.map(([, c]) => c));
  return (
    <>
      <div className="hr-avg">
        <b>{stats.avg == null ? '—' : avgFmt.format(stats.avg)}</b>
        <span>средняя оценка</span>
      </div>
      <ul className="hr-stars">
        {stats.stars.map(([n, c]) => (
          <li key={n}>
            <span>{n}</span>
            <i>
              <em style={{ width: `${(c / max) * 100}%` }} />
            </i>
            <b>{c}</b>
          </li>
        ))}
      </ul>
      <p className="hr-last">Последний отзыв: {stats.last ? when(stats.last.slice(0, 10), today) : 'нет'}</p>
    </>
  );
}

// Раздел главной: заголовок и относящиеся к нему блоки.
function Section({ title, wide = false, single = false, children }) {
  return (
    <section className={`hs ${wide ? 'is-wide' : ''} ${single ? 'is-single' : ''}`}>
      <h2 className="hs-title">{title}</h2>
      <div className="hs-grid">{children}</div>
    </section>
  );
}

function Block({ title, count, note, children, onOpen }) {
  return (
    <section className="hb">
      <header className="hb-head">
        <h3>{title}</h3>
        {count !== undefined && <span className="hb-count">{count}</span>}
        {note && <span className="hb-note">{note}</span>}
        <button className="hb-go" onClick={onOpen} aria-label={`Открыть раздел «${title}»`}>
          Раздел
        </button>
      </header>
      {children}
    </section>
  );
}

// Список, строки которого раскрываются на месте.
function List({ items, empty, renderHead, renderBody }) {
  const [openId, setOpenId] = useState(null);
  const [all, setAll] = useState(false);
  if (!items.length) return <p className="hb-empty">{empty}</p>;
  const shown = all ? items : items.slice(0, LIST_LIMIT);
  return (
    <>
      <ul className="hl">
        {shown.map((item) => {
          const open = openId === item.id;
          return (
            <li key={item.id} className={open ? 'is-open' : ''}>
              {renderHead(item, open, () => setOpenId(open ? null : item.id))}
              {open && <div className="hl-body">{renderBody(item)}</div>}
            </li>
          );
        })}
      </ul>
      {items.length > LIST_LIMIT && (
        <button className="hb-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Свернуть' : `Ещё ${items.length - LIST_LIMIT}`}
        </button>
      )}
    </>
  );
}

function Row({ date, dateClass = '', title, tag, onToggle, open, lead }) {
  return (
    <div className="hl-row">
      {lead}
      <button className="hl-head" onClick={onToggle} aria-expanded={open}>
        <span className={`hl-date ${dateClass}`}>{date}</span>
        <span className="hl-title">{title}</span>
        {tag}
      </button>
    </div>
  );
}

function Facts({ items }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <dl className="hl-facts">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const OpenLink = ({ onClick, children = 'Открыть в разделе' }) => (
  <button className="hl-link" onClick={onClick}>
    {children}
  </button>
);

export default function HomePage({ user, open }) {
  const today = todayIso();
  const horizon = addDays(today, HORIZON_DAYS - 1);

  const [tasksRaw, setTasks] = useShared(TASKS_KEY, []);
  const [calRaw] = useShared(CAL_KEY, []);
  const [menusRaw] = useShared(MENUS_KEY, []);
  const [cafeRaw] = useShared(EVENTS_KEY, []);
  const [collabsRaw] = useShared(COLLABS_KEY, EMPTY_COLLABS);
  const [ideasRaw] = useShared(IDEAS_KEY, []);
  const notifications = useNotifications();

  const tasks = useMemo(() => {
    const open = visibleRecords(user, 'tasks', tasksRaw).filter((t) => !t.done);
    const mine = open
      .filter((t) => isMine(t, user))
      .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.priority === 'high' ? -1 : b.priority === 'high' ? 1 : 0));
    return { open: open.length, mine, overdue: mine.filter((t) => isOverdue(t, today)).length };
  }, [tasksRaw, user, today]);

  const calendar = useMemo(() => {
    // Ровно то же, что в разделе «Календарь»: ручные события, доп. меню, мероприятия, коллаборации.
    const all = visibleRecords(user, 'calendar', calendarEvents()).filter((e) => {
      if (e.menuId) return canSee(user, 'menu');
      if (e.cafeEventId) return canSee(user, 'events');
      if (e.collabId) return canSee(user, 'collabs');
      return true;
    });
    const planned = all.filter((e) => endOf(e) >= today);
    const soon = planned.filter((e) => inWindow(e.start, e.end, today, horizon)).sort((a, b) => a.start.localeCompare(b.start));
    return { planned: planned.length, soon };
  }, [calRaw, menusRaw, cafeRaw, collabsRaw, user, today, horizon]); // eslint-disable-line react-hooks/exhaustive-deps

  const events = useMemo(() => {
    const planned = visibleRecords(user, 'events', cafeRaw)
      .filter((e) => e.status !== 'cancelled' && e.status !== 'done' && e.date >= today)
      .sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
    return { planned: planned.length, soon: planned.filter((e) => e.date <= horizon) };
  }, [cafeRaw, user, today, horizon]);

  const collabs = useMemo(() => {
    const { partners, collabs: list } = normalizeCollabs(collabsRaw);
    const byId = Object.fromEntries(partners.map((p) => [p.id, p]));
    const visible = visibleRecords(user, 'collabs', list);
    const scheduled = visible.filter((c) => isScheduled(c) && phaseOf(c, today) !== 'done');
    const soon = scheduled
      .filter((c) => inWindow(c.start, c.end, today, horizon))
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((c) => ({ ...c, partners: c.partnerIds.map((id) => byId[id]).filter(Boolean) }));
    return { scheduled: scheduled.length, ideas: visible.filter((c) => phaseOf(c, today) === 'idea').length, soon };
  }, [collabsRaw, user, today, horizon]);

  const ideas = useMemo(() => {
    const visible = visibleRecords(user, 'ideas', ideasRaw);
    const counts = Object.fromEntries(IDEA_COLUMNS.map((c) => [c.id, 0]));
    for (const i of visible) counts[ideaStatus(i)] = (counts[ideaStatus(i)] ?? 0) + 1;
    const fresh = visible.filter((i) => ideaStatus(i) === 'new');
    return { total: visible.length, counts, fresh };
  }, [ideasRaw, user]);

  const [reviewsData, setReviewsData] = useState(null);
  useEffect(() => {
    const load = () => api('/api/reviews').then(setReviewsData, () => {});
    load();
    return onRefresh(load, 120_000);
  }, []);
  const reviews = useMemo(() => {
    if (!reviewsData) return null;
    const all = reviewsData.reviews ?? [];
    return [
      ...(reviewsData.links ?? []).map((l) => ({ key: l.id, title: l.name, stats: reviewStats(all.filter((r) => r.linkId === l.id)) })),
      { key: 'all', title: 'Всего', stats: reviewStats(all) },
    ];
  }, [reviewsData]);

  const closeTask = (id) =>
    setTasks((list) => list.map((t) => (t.id === id ? { ...t, done: true, closedAt: new Date().toISOString() } : t)));

  const now = new Date();

  return (
    <>
      <div className="page-head">
        <h1>Главная</h1>
        <span className="home-date">
          {WEEKDAYS_FULL[now.getDay()]}, {now.getDate()} {MONTHS_GEN[now.getMonth()]}
        </span>
      </div>

      {/* Блоки сгруппированы по разделам, как в меню. */}
      <div className="home-sections">
        <Section title="Оповещения">
            <Block title="Новые" count={notifications.length} note={notifications.length ? null : 'новых нет'} onOpen={() => open('notifications')}>
              {notifications.length === 0 ? (
                <p className="hb-empty">Когда вам поставят или изменят задачу, это появится здесь</p>
              ) : (
                <>
                  <ul className="ntfs is-compact">
                    {notifications.slice(0, 5).map((n) => (
                      <NotificationItem key={n.id} n={n} open={open} compact />
                    ))}
                  </ul>
                  {notifications.length > 5 && (
                    <button className="hb-more" onClick={() => open('notifications')}>
                      Все {notifications.length}
                    </button>
                  )}
                </>
              )}
            </Block>
        </Section>

        {canSee(user, 'tasks') && (
          <Section title="Задачи">
                {canSee(user, 'tasks') && (
                  <Block
                    title="Мои задачи"
                    count={tasks.mine.length}
                    note={tasks.overdue ? <span className="hb-alert">просрочено {tasks.overdue}</span> : `всего открыто ${tasks.open}`}
                    onOpen={() => open('tasks')}
                  >
                    <List
                      items={tasks.mine}
                      empty="На вас нет открытых задач"
                      renderHead={(t, isOpen, toggle) => (
                        <Row
                          open={isOpen}
                          onToggle={toggle}
                          lead={
                            <input
                              type="checkbox"
                              className="hl-check"
                              aria-label={`Закрыть задачу «${t.title}»`}
                              onChange={() => closeTask(t.id)}
                            />
                          }
                          date={t.due ? when(t.due, today) : 'без срока'}
                          dateClass={isOverdue(t, today) ? 'is-overdue' : ''}
                          title={t.title}
                          tag={t.priority === 'high' ? <span className="task-flag">Важно</span> : null}
                        />
                      )}
                      renderBody={(t) => (
                        <>
                          {t.note && <p className="hl-text">{t.note}</p>}
                          <Facts
                            items={[
                              ['Срок', t.due ? `${when(t.due, today)}${isOverdue(t, today) ? ' — просрочено' : ''}` : 'не указан'],
                              ['Приоритет', PRIORITY_LABEL[t.priority]],
                              ['Поставил', t.createdById && t.createdById !== user.id ? t.createdByName : null],
                            ]}
                          />
                          <OpenLink onClick={() => open('tasks', t.id)}>Открыть задачу</OpenLink>
                        </>
                      )}
                    />
                  </Block>
                )}
          </Section>
        )}

        {canSee(user, 'ideas') && (
          <Section title="Идеи">
                {canSee(user, 'ideas') && (
                  <Block title="По стадиям" count={ideas.total} onOpen={() => open('ideas')}>
                    <ul className="hi-stages">
                      {IDEA_COLUMNS.map((c) => (
                        <li key={c.id}>
                          <i style={{ background: c.dot }} />
                          <span>{c.label}</span>
                          <b>{ideas.counts[c.id]}</b>
                        </li>
                      ))}
                    </ul>
                    {ideas.fresh.length > 0 && (
                      <>
                        <h3 className="hb-sub">Новые</h3>
                        <List
                          items={ideas.fresh}
                          empty=""
                          renderHead={(i, isOpen, toggle) => (
                            <Row open={isOpen} onToggle={toggle} date={shortDate(i.date)} title={i.title} />
                          )}
                          renderBody={(i) => (
                            <>
                              <p className="hl-text">{i.note || 'Без описания'}</p>
                              <OpenLink onClick={() => open('ideas')}>Открыть доску</OpenLink>
                            </>
                          )}
                        />
                      </>
                    )}
                  </Block>
                )}
          </Section>
        )}

        {reviews && (
          <Section title="Отзывы" wide single>
            <Block title="Оценки гостей" count={reviews.at(-1).stats.total} note="по загруженным отзывам" onOpen={() => open('reviews')}>
              <div className="hr-cols">
                {reviews.map(({ key, title, stats }) => (
                  <div key={key} className="hr-col">
                    <h4>
                      {title} <span>{stats.total}</span>
                    </h4>
                    <ReviewStats stats={stats} today={today} />
                  </div>
                ))}
              </div>
            </Block>
          </Section>
        )}

        {(canSee(user, 'events') || canSee(user, 'calendar') || canSee(user, 'collabs')) && (
          <Section title="Маркетинг" wide>
                {canSee(user, 'events') && (
                  <Block
                    title="Мероприятия"
                    count={events.soon.length}
                    note={events.planned > events.soon.length ? `всего впереди ${events.planned}` : 'на 4 недели'}
                    onOpen={() => open('events')}
                  >
                    <List
                      items={events.soon}
                      empty="В ближайшие 4 недели мероприятий нет"
                      renderHead={(e, isOpen, toggle) => (
                        <Row
                          open={isOpen}
                          onToggle={toggle}
                          date={when(e.date, today)}
                          title={e.title}
                          tag={e.mode === 'closed' ? <span className="ev-mode is-closed">закрыто</span> : e.mode === 'night' ? <span className="ev-mode is-night">ночью</span> : null}
                        />
                      )}
                      renderBody={(e) => (
                        <>
                          {e.description && <p className="hl-text">{e.description}</p>}
                          <Facts
                            items={[
                              ['Формат', label(FORMATS, e.format)],
                              ['Кафе', modeText(e)],
                              ['Ведущий', e.host],
                              ['Гостей', e.guestsPlan !== null && e.guestsPlan !== undefined ? `план ${e.guestsPlan}` : null],
                              ['Статус', e.status === 'confirmed' ? 'подтверждено' : 'планируется'],
                            ]}
                          />
                          <OpenLink onClick={() => open('events', e.id)}>Открыть мероприятие</OpenLink>
                        </>
                      )}
                    />
                  </Block>
                )}

                {canSee(user, 'calendar') && (
                  <Block
                    title="Календарь"
                    count={calendar.soon.length}
                    note={calendar.planned > calendar.soon.length ? `всего впереди ${calendar.planned}` : 'на 4 недели'}
                    onOpen={() => open('marketing')}
                  >
                    <List
                      items={calendar.soon}
                      empty="В ближайшие 4 недели событий нет"
                      renderHead={(e, isOpen, toggle) => {
                        const t = calTypeById[e.type] ?? calTypeById.promo;
                        return (
                          <Row
                            open={isOpen}
                            onToggle={toggle}
                            date={e.start < today ? 'идёт' : when(e.start, today)}
                            title={e.title}
                            tag={<span className="hl-type" style={{ color: t.fg }}>{t.label.toLowerCase()}</span>}
                          />
                        );
                      }}
                      renderBody={(e) => (
                        <>
                          <Facts
                            items={[
                              ['Тип', calTypeById[e.type]?.label],
                              ['Даты', period(e.start, e.end)],
                              ['Заметка', e.note],
                            ]}
                          />
                          {e.menuId ? (
                            <OpenLink onClick={() => open('menu', e.menuId)}>Открыть меню</OpenLink>
                          ) : e.cafeEventId ? (
                            <OpenLink onClick={() => open('events', e.cafeEventId)}>Открыть мероприятие</OpenLink>
                          ) : e.collabId ? (
                            <OpenLink onClick={() => open('collabs', e.collabId)}>Открыть коллаборацию</OpenLink>
                          ) : (
                            <OpenLink onClick={() => open('marketing')}>Открыть календарь</OpenLink>
                          )}
                        </>
                      )}
                    />
                  </Block>
                )}

                {canSee(user, 'collabs') && (
                  <Block
                    title="Коллаборации"
                    count={collabs.soon.length}
                    note={[collabs.scheduled > collabs.soon.length && `согласовано ${collabs.scheduled}`, collabs.ideas && `в идеях ${collabs.ideas}`].filter(Boolean).join(', ') || 'на 4 недели'}
                    onOpen={() => open('collabs')}
                  >
                    <List
                      items={collabs.soon}
                      empty="В ближайшие 4 недели согласованных коллабораций нет"
                      renderHead={(c, isOpen, toggle) => {
                        const phase = phaseOf(c, today);
                        return (
                          <Row
                            open={isOpen}
                            onToggle={toggle}
                            date={phase === 'live' ? 'идёт' : when(c.start, today)}
                            title={c.title}
                            tag={<span className="hl-sub">{c.partners.map((p) => p.name).join(', ') || 'без партнёра'}</span>}
                          />
                        );
                      }}
                      renderBody={(c) => (
                        <>
                          {c.mechanics && <p className="hl-text">{c.mechanics}</p>}
                          <Facts
                            items={[
                              ['Даты', period(c.start, c.end)],
                              ['Статус', PHASE_LABEL[phaseOf(c, today)]],
                              ['Партнёры', c.partners.length ? c.partners.map((p) => `${p.name} (${[KIND_LABEL[p.kind]?.toLowerCase(), p.topic].filter(Boolean).join(', ')})`).join('; ') : 'не выбраны'],
                              ['Бюджет', c.budget !== null && c.budget !== undefined ? fmtMoney(c.budget) : null],
                            ]}
                          />
                          <OpenLink onClick={() => open('collabs', c.id)}>Открыть коллаборацию</OpenLink>
                        </>
                      )}
                    />
                  </Block>
                )}
          </Section>
        )}
      </div>
    </>
  );
}
