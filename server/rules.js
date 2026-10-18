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
  // Проработка блюд: предлагать может любой, решение (подтвердить / отклонить) — только руководитель.
  // Автор может менять и удалять только свои блюда, пока они на согласовании.
  'ledger:dish-lab:v1': (prev, next, user) => {
    if (!Array.isArray(next)) return 'Некорректные данные блюд';
    if (canDelegate(user)) return null;
    const before = new Map((Array.isArray(prev) ? prev : []).map((d) => [d?.id, d]));
    const after = new Set(next.map((d) => d?.id));
    for (const [id, d] of before) {
      if (!after.has(id) && (d.createdById !== user.id || d.status !== 'review')) return 'Удалить можно только своё блюдо на согласовании';
    }
    for (const d of next) {
      const old = before.get(d?.id);
      if (!old) {
        if (d.status !== 'review' || d.decision || d.createdById !== user.id) return 'Новое блюдо отправляется на согласование от своего имени';
        continue;
      }
      if (JSON.stringify(old) === JSON.stringify(d)) continue;
      if (d.status !== old.status || JSON.stringify(d.decision ?? null) !== JSON.stringify(old.decision ?? null)) return 'Подтвердить или отклонить блюдо может только руководитель';
      if (old.createdById !== user.id || old.status !== 'review' || d.createdById !== old.createdById) return 'Изменить можно только своё блюдо на согласовании';
    }
    return null;
  },
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
