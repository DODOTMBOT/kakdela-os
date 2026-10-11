// Идеи: канбан-доска со статусами-колонками.

export const IDEAS_KEY = 'ledger:ideas:v1';

// tint — фон карточек в колонке, over — подсветка колонки при перетаскивании.
export const IDEA_COLUMNS = [
  { id: 'new', label: 'Новые', dot: '#161616', tint: '#ffffff', over: '#e2e2df' },
  { id: 'rework', label: 'Доработать', dot: '#e0a12b', tint: '#fdf4df', over: '#f6e6c0' },
  { id: 'accepted', label: 'Принято', dot: '#6cc644', tint: '#ecf7e5', over: '#d7edca' },
  { id: 'rejected', label: 'Отказ', dot: '#f05252', tint: '#fdecec', over: '#f8d6d6' },
  { id: 'backlog', label: 'Бэклог', dot: '#9a9a9a', tint: '#f3f3f2', over: '#dededb' },
];

export const ideaStatus = (idea) => idea.status ?? 'new';
