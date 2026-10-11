// Запросы к серверу приложения. 401 на любом запросе (кроме проверки входа) означает,
// что сессия закончилась — об этом узнаёт AuthGate и показывает окно входа.

export const AUTH_EXPIRED = 'auth:expired';

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/me' && path !== '/api/auth/login' && path !== '/api/auth/password') {
      window.dispatchEvent(new Event(AUTH_EXPIRED));
    }
    throw Object.assign(new Error(data.error || `Ошибка ${res.status}`), { status: res.status });
  }
  return data;
}

export function randomPassword(length = 12) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
