// Доступ к разделам и записям. Пока ролей нет — каждый пользователь видит всё.
// Когда появятся роли, правила дописываются здесь, и все места, которые спрашивают
// canSee / visibleRecords (например, сводка на главной), начнут учитывать их сами.

// Роли пользователей. Должность — свободный текст и на доступ не влияет.
export const ROLES = [
  ['manager', 'Руководитель'],
  ['employee', 'Сотрудник'],
];
const ROLE_LABEL = { admin: 'Супер-админ', ...Object.fromEntries(ROLES) };
export const roleLabel = (role) => ROLE_LABEL[role] ?? 'Сотрудник';

// Какие разделы видит каждая роль. Пока правила не заданы — все видят всё.
const ROLE_SECTIONS = {
  admin: 'all',
  manager: 'all',
  employee: 'all',
};

// Разделы, к которым может относиться доступ.
export const SECTIONS = ['tasks', 'menu', 'calendar', 'events', 'collabs', 'ideas', 'docs', 'reports'];

// Видит ли пользователь раздел целиком.
export function canSee(user, section) {
  if (!user || !SECTIONS.includes(section)) return false;
  const allowed = ROLE_SECTIONS[user.role] ?? ROLE_SECTIONS.employee;
  return allowed === 'all' || allowed.includes(section);
}

// Какие записи раздела показывать пользователю.
export function visibleRecords(user, section, records) {
  return canSee(user, section) ? records : [];
}
