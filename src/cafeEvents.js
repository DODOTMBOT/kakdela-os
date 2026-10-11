// Мероприятия кафе (квизы, встречи, клубы). Календарь читает их отсюда же.

import { getShared } from './sync.js';

export const EVENTS_KEY = 'ledger:cafe-events:v1';

export const FORMATS = [
  ['quiz', 'Квиз'],
  ['meetup', 'Встреча'],
  ['club', 'Клуб по интересам'],
  ['lecture', 'Лекция / мастер-класс'],
  ['party', 'Вечеринка'],
  ['private', 'Частное мероприятие'],
  ['other', 'Другое'],
];

// Как мероприятие влияет на работу кафе.
export const MODES = [
  ['closed', 'Кафе закрыто для гостей'],
  ['night', 'Ночью, после закрытия'],
  ['open', 'Без закрытия'],
];

export const STATUSES = [
  ['planned', 'Планируется'],
  ['confirmed', 'Подтверждено'],
  ['done', 'Проведено'],
  ['cancelled', 'Отменено'],
];

export const label = (list, value) => list.find(([v]) => v === value)?.[1] ?? '';

export const loadCafeEvents = () => getShared(EVENTS_KEY, []);

export const timeRange = (e) => [e.start, e.end].filter(Boolean).join('–');

export function modeText(e) {
  const t = timeRange(e);
  if (e.mode === 'closed') return `Кафе закрыто${t ? ` ${t}` : ''}`;
  if (e.mode === 'night') return `После закрытия${t ? `, ${t}` : ''}`;
  return t ? `${t}, без закрытия` : 'Без закрытия';
}
