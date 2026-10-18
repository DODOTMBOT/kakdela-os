// Доступ ролей к разделам.
// Супер-админ видит всё. Для руководителя и сотрудника супер-админ закрывает разделы на странице
// «Роли и доступ» — настройка хранится в общих данных (ACCESS_KEY) как список закрытых разделов
// для каждой роли. Закрытый раздел пропадает из меню и с главной, а прямая ссылка ведёт
// на страницу «Нет доступа». Сервер не даёт менять данные закрытых разделов (server/access.js).

import { getShared } from './sync.js';

export const ACCESS_KEY = 'ledger:access:v1';

// Роли пользователей. Должность — свободный текст и на доступ не влияет.
export const ROLES = [
  ['employee', 'Сотрудник'],
  ['manager', 'Руководитель'],
  ['admin', 'Супер-админ'],
];
const ROLE_LABEL = Object.fromEntries(ROLES);
export const roleLabel = (role) => ROLE_LABEL[role] ?? 'Сотрудник';

// Роли, для которых доступ настраивается (супер-админу открыто всё).
export const CONFIGURABLE_ROLES = ['manager', 'employee'];
// Всегда открыты всем.
export const ALWAYS_OPEN = ['home', 'notifications'];
// Только для супер-админа.
export const ADMIN_ONLY = ['users', 'roles'];
// Только для руководителей и супер-админа (сотрудникам не открываются ни при каких настройках).
export const MANAGERS_ONLY = ['tv'];

// Может ли пользователь открыть раздел (id страницы, как в меню).
export function canOpen(user, page, config = getShared(ACCESS_KEY, {})) {
  if (!user) return false;
  if (ADMIN_ONLY.includes(page)) return user.role === 'admin';
  if (MANAGERS_ONLY.includes(page) && user.role === 'employee') return false;
  if (user.role === 'admin' || ALWAYS_OPEN.includes(page)) return true;
  const denied = config?.[user.role];
  return !(Array.isArray(denied) && denied.includes(page));
}

// Разделы данных, о которых спрашивает сводка на главной, — это те же страницы.
const SECTION_PAGE = { calendar: 'marketing' };

// Видит ли пользователь раздел целиком.
export function canSee(user, section) {
  return canOpen(user, SECTION_PAGE[section] ?? section);
}

// Какие записи раздела показывать пользователю.
export function visibleRecords(user, section, records) {
  return canSee(user, section) ? records : [];
}
