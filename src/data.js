const pad = (n, len = 2) => String(n).padStart(len, '0');

// Дата в формате ГГГГ-ММ-ДД; m — месяц с нуля, как в Date.
export const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
