// Календарь: ручные события раздела «Календарь» и типы событий.
// Сюда же сводятся события других разделов (меню, мероприятия, коллаборации).
import { loadMenus } from './menus.js';
import { FORMATS, label, loadCafeEvents, modeText } from './cafeEvents.js';
import { isScheduled, loadCollabs } from './collabs.js';
import { getShared } from './sync.js';

export const CAL_KEY = 'ledger:marketing:v1';

export const CAL_TYPES = [
  { id: 'promo', label: 'Акция', bg: '#fde4e4', fg: '#d23c3c' },
  { id: 'social', label: 'Соцсети', bg: '#ebe6fb', fg: '#6650c6' },
  { id: 'email', label: 'Рассылка', bg: '#e1eefb', fg: '#2f6db3' },
  { id: 'ads', label: 'Реклама', bg: '#fff0d4', fg: '#a96c10' },
  { id: 'event', label: 'Мероприятие', bg: '#e4f0dc', fg: '#3f7d1f' },
  // Даты дополнительных меню — подтягиваются из раздела «Меню», вручную не создаются.
  { id: 'menu', label: 'Меню', bg: '#dcf2ee', fg: '#0f766e' },
  // Согласованные коллаборации — из раздела «Коллаборации».
  { id: 'collab', label: 'Коллаборация', bg: '#fce7f1', fg: '#b4235f' },
];
export const calTypeById = Object.fromEntries(CAL_TYPES.map((t) => [t.id, t]));

export const endOf = (e) => e.end || e.start;

// События календаря из дополнительных меню, включая архивные.
export function menuEvents() {
  const menus = loadMenus();
  const names = Object.fromEntries(menus.map((m) => [m.id, m.name]));
  return menus
    .filter((m) => m.type === 'extra' && m.start && m.end)
    .map((m) => ({
      id: `menu:${m.id}`,
      menuId: m.id,
      type: 'menu',
      title: `Меню «${m.name}»`,
      start: m.start,
      end: m.end === m.start ? '' : m.end,
      note: [names[m.parentId] && `к «${names[m.parentId]}»`, m.archived && 'в архиве'].filter(Boolean).join(', '),
    }));
}

// Мероприятия кафе (кроме отменённых) — тоже автоматически.
export function cafeEvents() {
  return loadCafeEvents()
    .filter((e) => e.status !== 'cancelled' && e.date)
    .map((e) => ({
      id: `cafe:${e.id}`,
      cafeEventId: e.id,
      type: 'event',
      title: e.start ? `${e.start} ${e.title}` : e.title,
      start: e.date,
      end: '',
      note: [label(FORMATS, e.format), modeText(e)].filter(Boolean).join(' · '),
    }));
}

// Согласованные коллаборации с датами.
export function collabEvents() {
  const { partners, collabs } = loadCollabs();
  const names = Object.fromEntries(partners.map((p) => [p.id, p.name]));
  return collabs
    .filter(isScheduled)
    .map((c) => ({
      id: `collab:${c.id}`,
      collabId: c.id,
      type: 'collab',
      title: c.title,
      start: c.start,
      end: c.end || '',
      note: c.partnerIds.map((id) => names[id]).filter(Boolean).join(', ') || 'Партнёр не выбран',
    }));
}

// События, которые календарь берёт из других разделов: доп. меню, мероприятия, коллаборации.
export const linkedEvents = () => [...menuEvents(), ...cafeEvents(), ...collabEvents()];

// Всё, что видно в календаре: ручные события и события из других разделов.
export const calendarEvents = () => [...getShared(CAL_KEY, []), ...linkedEvents()];
