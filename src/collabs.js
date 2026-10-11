// Коллаборации и партнёры (блогеры, компании). Календарь читает их отсюда же.
import { todayIso } from './menus.js';
import { getShared } from './sync.js';

export const COLLABS_KEY = 'ledger:collabs:v1';

export const KINDS = [
  ['blogger', 'Блогер'],
  ['company', 'Компания'],
];

// Вручную выбирается только «Идея» или «Согласовали»; дальше этап определяют даты.
export const STATUSES = [
  ['idea', 'Идея'],
  ['agreed', 'Согласовали'],
];

export const PHASES = [
  ['idea', 'Идея'],
  ['agreed', 'Согласована'],
  ['live', 'Идёт'],
  ['done', 'Завершена'],
];

// Статусы ранней версии раздела.
const LEGACY = { work: 'idea', confirmed: 'agreed', live: 'agreed', done: 'agreed' };

export const EMPTY_COLLABS = { partners: [], collabs: [] };

export function normalizeCollabs(saved) {
  if (!saved || !Array.isArray(saved.partners) || !Array.isArray(saved.collabs)) return EMPTY_COLLABS;
  return { ...saved, collabs: saved.collabs.map((c) => ({ ...c, status: LEGACY[c.status] ?? c.status })) };
}

export const loadCollabs = () => normalizeCollabs(getShared(COLLABS_KEY, EMPTY_COLLABS));

// Согласованная коллаборация с датой — в календаре.
export const isScheduled = (c) => c.status === 'agreed' && Boolean(c.start);

// Этап по календарю: согласована → идёт (с даты начала) → завершена (после окончания).
export function phaseOf(c, today = todayIso()) {
  if (!isScheduled(c)) return c.status === 'agreed' ? 'agreed' : 'idea';
  if (today < c.start) return 'agreed';
  if (today <= (c.end || c.start)) return 'live';
  return 'done';
}
