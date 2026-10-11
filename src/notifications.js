// Оповещения текущего пользователя. Одно хранилище на всё приложение: меню, страница и главная
// показывают одно и то же. Новые приходят по сигналу из потока обновлений (sync.js).
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { onRefresh } from './users.js';

export const NOTIFICATIONS_CHANGED = 'notifications:changed';

let items = [];
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(items));
const apply = (d) => {
  items = d.items;
  emit();
};

export const refreshNotifications = () => api('/api/notifications').then(apply).catch(() => {});

// Убрать одно или несколько оповещений; без аргумента — все.
export function removeNotifications(ids) {
  items = ids ? items.filter((n) => !ids.includes(n.id)) : [];
  emit();
  return api('/api/notifications', { method: 'DELETE', body: ids ? { ids } : { all: true } }).then(apply).catch(refreshNotifications);
}

export function useNotifications() {
  const [list, setList] = useState(items);
  useEffect(() => {
    listeners.add(setList);
    refreshNotifications();
    const onChanged = () => refreshNotifications();
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    const stop = onRefresh(refreshNotifications, 60_000);
    return () => {
      listeners.delete(setList);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
      stop();
    };
  }, []);
  return list;
}

export function timeAgo(iso) {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `сегодня в ${time}`;
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `вчера в ${time}`;
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} в ${time}`;
}
