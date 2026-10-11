// Правила, которые сервер проверяет при сохранении общих данных — их нельзя обойти из браузера.
// Каждое правило получает прежнее значение раздела, новое и пользователя; возвращает текст ошибки или null.

const canDelegate = (user) => user.role === 'admin' || user.role === 'manager';

export const validators = {
  // Руководитель назначает задачи кому угодно, сотрудник — только себе.
  'ledger:tasks:v1': (prev, next, user) => {
    if (!Array.isArray(next)) return 'Некорректные данные задач';
    if (canDelegate(user)) return null;
    const before = new Map((Array.isArray(prev) ? prev : []).map((t) => [t?.id, t]));
    for (const task of next) {
      const old = before.get(task?.id);
      const assigneeChanged = !old || old.assigneeId !== task.assigneeId;
      if (assigneeChanged && task.assigneeId !== user.id) return 'Сотрудник может назначать задачи только себе';
    }
    return null;
  },

  // Стандарты и их категории создают и правят только руководители; сотрудники читают.
  'ledger:standards:v1': (prev, next, user) => standardsRule(prev, next, user, 'статьи'),
  'ledger:standard-categories:v1': (prev, next, user) => standardsRule(prev, next, user, 'категории'),
  // Курсы обучения создают, назначают и архивируют только руководители.
  'ledger:courses:v1': (prev, next, user) => {
    if (!Array.isArray(next)) return 'Некорректные данные курсов';
    if (canDelegate(user)) return null;
    return JSON.stringify(prev ?? null) === JSON.stringify(next) ? null : 'Изменять курсы могут только руководители';
  },
};

function standardsRule(prev, next, user, what) {
  if (!Array.isArray(next)) return `Некорректные данные стандартов (${what})`;
  if (canDelegate(user)) return null;
  return JSON.stringify(prev ?? null) === JSON.stringify(next) ? null : `Изменять стандарты (${what}) могут только руководители`;
}
