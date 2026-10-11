// Задачи управления.

export const TASKS_KEY = 'ledger:tasks:v1';

export const isOverdue = (t, today) => !t.done && Boolean(t.due) && t.due < today;
