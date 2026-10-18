// Доступ ролей к разделам. Настройку меняет супер-админ на странице «Роли и доступ»;
// она хранится в общих данных (ledger:access:v1) в виде закрытых разделов для каждой роли:
// { manager: ['finance', …], employee: ['reports', …] }. Супер-админу открыто всё.
//
// Сервер не даёт изменить данные закрытого раздела и закрывает API отзывов и обучения.
// Меню, прямые ссылки и блоки главной страницы скрываются в браузере (src/access.js).

export const ACCESS_KEY = 'ledger:access:v1';

// Какие общие данные принадлежат разделу.
const PAGE_KEYS = {
  tasks: ['ledger:tasks:v1'],
  menu: ['ledger:menus:v1'],
  dishlab: ['ledger:dish-lab:v1'],
  marketing: ['ledger:marketing:v1'],
  events: ['ledger:cafe-events:v1'],
  collabs: ['ledger:collabs:v1'],
  ideas: ['ledger:ideas:v1'],
  docs: ['ledger:files:v1'],
  standards: ['ledger:standards:v1', 'ledger:standard-categories:v1'],
  training: ['ledger:courses:v1'],
  reports: ['ledger:finmodel:v1', 'ledger:pnl-analysis:v1'],
};
const PAGE_OF_KEY = Object.fromEntries(Object.entries(PAGE_KEYS).flatMap(([page, keys]) => keys.map((k) => [k, page])));

export function pageAllowed(config, user, page) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const denied = config?.[user.role];
  return !(Array.isArray(denied) && denied.includes(page));
}

// Проверка перед сохранением раздела данных: текст ошибки или null.
function onlyAddsOwnThoughts(prev, next, user) {
  if (!Array.isArray(next)) return false;
  const before = new Map((Array.isArray(prev) ? prev : []).map((i) => [i?.id, JSON.stringify(i)]));
  const after = new Set(next.map((i) => i?.id));
  if ([...before.keys()].some((id) => !after.has(id))) return false; // ничего не удалено
  return next.every((i) => {
    if (before.has(i?.id)) return before.get(i.id) === JSON.stringify(i); // старые не тронуты
    return i?.status === 'new' && i.source === 'thoughts' && i.authorId === user.id; // новые — свои, в «Новых»
  });
}

export function writeGuard(key, user, read, next) {
  if (key === ACCESS_KEY) return user.role === 'admin' ? null : 'Доступ ролей настраивает только супер-админ';
  const config = read(ACCESS_KEY);
  const page = PAGE_OF_KEY[key];
  if (!page || pageAllowed(config, user, page)) return null;
  // Доска идей закрыта, но «Пространство мыслей» открыто — можно только добавить свои новые мысли.
  if (key === 'ledger:ideas:v1' && pageAllowed(config, user, 'thoughts') && onlyAddsOwnThoughts(read(key), next, user)) return null;
  return 'Этот раздел закрыт для вашей роли';
}

// Для серверных модулей со своим API (отзывы, обучение).
export const createAccess = (data) => ({
  allowed: async (user, page) => pageAllowed(await data.get(ACCESS_KEY), user, page),
});
