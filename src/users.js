// Коллеги для выбора ответственного. Список общий для всех экранов и обновляется при открытии.
import { useEffect, useState } from 'react';
import { api } from './api.js';

let cache = null;

// Список перечитывается при возвращении во вкладку и раз в 20 секунд — новые коллеги появляются сами.
export function useUsers(me) {
  const [users, setUsers] = useState(cache ?? (me ? [me] : []));
  useEffect(() => {
    let alive = true;
    const load = () =>
      api('/api/users')
        .then((d) => {
          cache = d.users;
          if (alive) setUsers(d.users);
        })
        .catch(() => {});
    load();
    return onRefresh(load);
  }, []);
  return users;
}

// Вызывать fn при возвращении во вкладку и периодически, пока экран открыт.
export function onRefresh(fn, every = 20_000) {
  const onVisible = () => document.visibilityState === 'visible' && fn();
  const timer = setInterval(onVisible, every);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  };
}

// Руководитель (и супер-админ) ставит задачи кому угодно, сотрудник — только себе.
export const canDelegate = (user) => user?.role === 'admin' || user?.role === 'manager';

export const assignableUsers = (me, users) => (canDelegate(me) ? users : users.filter((u) => u.id === me.id));
