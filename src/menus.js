// Меню хранятся общим списком: основные (type: 'main') и дополнительные (type: 'extra'),
// прикреплённые к основному через parentId и идущие с start по end. Календарь читает их отсюда же.
import { iso } from './data.js';
import { MONTHS_GEN } from './utils.js';
import { getShared } from './sync.js';

export const MENUS_KEY = 'ledger:menus:v1';

// Меню, созданные до появления типов, считаются основными.
export const normalizeMenus = (list) => (Array.isArray(list) ? list.map((m) => ({ type: 'main', ...m })) : []);

export const loadMenus = () => normalizeMenus(getShared(MENUS_KEY, []));

export const todayIso = () => {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
};

// upcoming — ещё не началось, active — идёт, finished — закончилось.
export function menuStatus(menu, today = todayIso()) {
  if (menu.start > today) return 'upcoming';
  if (menu.end < today) return 'finished';
  return 'active';
}

const fmtDate = (s, withYear) => {
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}${withYear ? ` ${y}` : ''}`;
};

export function fmtPeriod(start, end) {
  const year = String(new Date().getFullYear());
  const withYear = start.slice(0, 4) !== year || end.slice(0, 4) !== year;
  return `${fmtDate(start, withYear && start.slice(0, 4) !== end.slice(0, 4))} — ${fmtDate(end, withYear)}`;
}

export function statusText(menu, today = todayIso()) {
  const status = menuStatus(menu, today);
  if (status === 'upcoming') return `Начнётся ${fmtDate(menu.start)}`;
  if (status === 'finished') return `Закончилось ${fmtDate(menu.end)}`;
  return `Идёт до ${fmtDate(menu.end)}`;
}
