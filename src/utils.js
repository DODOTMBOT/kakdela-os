export const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

export const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export function fmtMoney(n, withSign = false) {
  const s = `${money.format(Math.abs(Math.round(n)))} ₽`;
  if (n < 0) return `−${s}`;
  if (withSign && n > 0) return `+${s}`;
  return s;
}

export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m: m - 1, d };
};

export const fmtDay = (s) => {
  const { m, d } = parseDate(s);
  return `${d} ${MONTHS_GEN[m]}`;
};
