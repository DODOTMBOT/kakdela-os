// Общие данные: каждый раздел хранится на сервере под своим ключом и виден всем пользователям.
// Изменения отправляются с версией, от которой их сделали. Если кто-то успел сохранить раньше,
// правки объединяются (merge3) и отправляются снова. Чужие изменения приходят через SSE.

import { useEffect, useState } from 'react';
import { api } from './api.js';
import { migrateLegacyBlobs } from './fileStore.js';

const PUSH_DELAY = 400;

const cache = new Map(); // текущее значение у этого пользователя
const base = new Map(); // { value, version } — последнее значение, известное серверу
const listeners = new Map();
const timers = new Map();
const inflight = new Set();
const statusListeners = new Set();
let stream = null;
let status = 'idle'; // idle | saving | error
const rejectListeners = new Set();

const setStatus = (s) => {
  if (s === status) return;
  status = s;
  statusListeners.forEach((fn) => fn(s));
};

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const byId = (arr) => Array.isArray(arr) && arr.length > 0 && arr.every((x) => isObj(x) && typeof x.id === 'string');

// Трёхстороннее объединение: base — общее прошлое, mine — мои правки, theirs — чужие.
// Списки записей с id объединяются по записям, объекты — по полям; при прямом конфликте выигрывают мои правки.
export function merge3(b, mine, theirs) {
  if (same(mine, b)) return theirs;
  if (same(theirs, b) || same(mine, theirs)) return mine;
  if ((byId(mine) || byId(theirs)) && Array.isArray(mine) && Array.isArray(theirs)) {
    const bArr = Array.isArray(b) ? b : [];
    const bMap = new Map(bArr.map((x) => [x.id, x]));
    const mMap = new Map(mine.map((x) => [x.id, x]));
    const tMap = new Map(theirs.map((x) => [x.id, x]));
    const ids = new Set([...mMap.keys(), ...tMap.keys()]);
    const result = new Map();
    for (const id of ids) {
      const inB = bMap.has(id);
      const m = mMap.get(id);
      const t = tMap.get(id);
      if (m && t) result.set(id, merge3(bMap.get(id), m, t));
      else if (m && !t) {
        // У них удалено: оставляем, только если я эту запись менял (или она новая у меня).
        if (!inB || !same(m, bMap.get(id))) result.set(id, m);
      } else if (t && !m) {
        if (!inB || !same(t, bMap.get(id))) result.set(id, t);
      }
    }
    // Порядок: если я переставлял — мой, иначе их; новые записи — в конец.
    const iReordered = !same(mine.map((x) => x.id).filter((id) => bMap.has(id)), bArr.map((x) => x.id).filter((id) => mMap.has(id)));
    const order = iReordered ? [...mine, ...theirs] : [...theirs, ...mine];
    const seen = new Set();
    const out = [];
    for (const x of order) {
      if (result.has(x.id) && !seen.has(x.id)) {
        seen.add(x.id);
        out.push(result.get(x.id));
      }
    }
    return out;
  }
  if (isObj(mine) && isObj(theirs)) {
    const bObj = isObj(b) ? b : {};
    const out = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const v = merge3(bObj[k], mine[k], theirs[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return mine;
}

function notify(key) {
  const value = cache.get(key);
  listeners.get(key)?.forEach((fn) => fn(value));
}

async function push(key) {
  if (inflight.has(key)) return;
  inflight.add(key);
  setStatus('saving');
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const value = cache.get(key);
      const known = base.get(key) ?? { value: null, version: 0 };
      if (same(value, known.value)) break;
      try {
        const { version } = await api(`/api/data/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: { value, baseVersion: known.version },
        });
        base.set(key, { value: clone(value), version });
      } catch (err) {
        if (err.status === 403) {
          // Сервер не разрешил это изменение — возвращаем последнее сохранённое состояние.
          cache.set(key, clone(known.value));
          notify(key);
          rejectListeners.forEach((fn) => fn(err.message));
          break;
        }
        if (err.status !== 409) throw err;
        await pull(key);
      }
    }
    setStatus(timers.size || inflight.size > 1 ? 'saving' : 'idle');
  } catch {
    setStatus('error');
    // Повторим позже: данные остаются у пользователя и уйдут при следующей попытке.
    schedule(key, 5000);
  } finally {
    inflight.delete(key);
  }
}

function schedule(key, delay = PUSH_DELAY) {
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      push(key);
    }, delay),
  );
}

// Забрать свежее значение с сервера и объединить с несохранёнными правками.
async function pull(key) {
  const remote = await api(`/api/data/${encodeURIComponent(key)}`);
  const known = base.get(key) ?? { value: null, version: 0 };
  if (remote.version <= known.version) return;
  const local = cache.get(key);
  const merged = local === undefined || same(local, known.value) ? remote.value : merge3(known.value, local, remote.value);
  base.set(key, { value: clone(remote.value), version: remote.version });
  cache.set(key, merged);
  notify(key);
  if (!same(merged, remote.value)) schedule(key);
}

// Раз в жизни приложения: перенести на сервер то, что уже накоплено в этом браузере.
const LEGACY_KEYS = [
  'ledger:menus:v1',
  'ledger:marketing:v1',
  'ledger:ideas:v1',
  'ledger:files:v1',
  'ledger:finmodel:v1',
  'ledger:pnl-analysis:v1',
  'ledger:tasks:v1',
  'ledger:collabs:v1',
  'ledger:cafe-events:v1',
];

export async function initSync() {
  const all = await api('/api/data');
  for (const [key, doc] of Object.entries(all)) {
    base.set(key, { value: clone(doc.value), version: doc.version });
    cache.set(key, doc.value);
  }
  for (const key of LEGACY_KEYS) {
    if (base.get(key)?.value != null) continue;
    try {
      const local = JSON.parse(localStorage.getItem(key));
      if (local != null) {
        cache.set(key, local);
        schedule(key, 0);
        if (key === 'ledger:files:v1' && Array.isArray(local)) {
          migrateLegacyBlobs(local.filter((n) => n.kind === 'file').map((n) => n.id));
        }
      }
    } catch {
      /* нечего переносить */
    }
  }
  stream?.close();
  stream = new EventSource('/api/data/stream');
  stream.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'notifications') {
        window.dispatchEvent(new Event('notifications:changed'));
        return;
      }
      const { key, version } = msg;
      if (version > (base.get(key)?.version ?? 0) && !inflight.has(key)) pull(key).catch(() => {});
    } catch {
      /* служебное сообщение */
    }
  };
  // После обрыва связи EventSource переподключается сам; заодно сверяемся со свежими данными.
  stream.onopen = () => {
    api('/api/data')
      .then((fresh) => {
        for (const [key, doc] of Object.entries(fresh)) {
          if (doc.version > (base.get(key)?.version ?? 0) && !inflight.has(key)) pull(key).catch(() => {});
        }
      })
      .catch(() => {});
  };
}

export function stopSync() {
  stream?.close();
  stream = null;
  timers.forEach(clearTimeout);
  timers.clear();
  cache.clear();
  base.clear();
}

export function getShared(key, fallback) {
  return cache.has(key) && cache.get(key) !== null ? cache.get(key) : fallback;
}

export function setShared(key, value) {
  cache.set(key, value);
  notify(key);
  schedule(key);
}

// Как useState, только значение общее для всех пользователей.
export function useShared(key, fallback) {
  const [value, setValue] = useState(() => getShared(key, typeof fallback === 'function' ? fallback() : fallback));
  useEffect(() => {
    const fn = (v) => setValue(v ?? (typeof fallback === 'function' ? fallback() : fallback));
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    return () => listeners.get(key).delete(fn);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (next) => {
    const current = getShared(key, value);
    const resolved = typeof next === 'function' ? next(current) : next;
    setShared(key, resolved);
  };
  return [value, update];
}

// Сообщение, если сервер отклонил изменение по правилам доступа.
export function useSyncRejection() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    let timer;
    const fn = (m) => {
      setMessage(m);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(''), 5000);
    };
    rejectListeners.add(fn);
    return () => {
      rejectListeners.delete(fn);
      clearTimeout(timer);
    };
  }, []);
  return message;
}

export function useSyncStatus() {
  const [s, setS] = useState(status);
  useEffect(() => {
    statusListeners.add(setS);
    return () => statusListeners.delete(setS);
  }, []);
  return s;
}

// Не даём закрыть вкладку, пока правки не ушли на сервер.
window.addEventListener('beforeunload', (e) => {
  if (timers.size || inflight.size) e.preventDefault();
});
