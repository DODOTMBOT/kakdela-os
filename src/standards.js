// Стандарты — база знаний кафе: статьи (стандарты, инструкции, регламенты) по категориям.
//
// Статья: { id, title, description, categoryId, html, attachments: [id файла из «Документов"],
//           revision, createdAt, createdById, createdByName, updatedAt, updatedById, updatedByName }.
// revision растёт при каждом сохранении — на него можно будет опереться, когда появятся
// подтверждение ознакомления («прочитал редакцию N»), история изменений и тесты по статье:
// их удобно хранить отдельными разделами данных с привязкой к id статьи и revision.
//
// Файлы прикрепляются ссылкой на id из раздела «Документы» — без копирования и дубликатов.

export const STANDARDS_KEY = 'ledger:standards:v1';
export const STANDARD_CATEGORIES_KEY = 'ledger:standard-categories:v1';
export const DOCS_KEY = 'ledger:files:v1';

export const DEFAULT_CATEGORIES = [
  { id: 'sc-bar', name: 'Бар' },
  { id: 'sc-service', name: 'Сервис' },
  { id: 'sc-sanitary', name: 'Санитария' },
  { id: 'sc-management', name: 'Управление' },
  { id: 'sc-equipment', name: 'Оборудование' },
];

// Цвета бейджей категорий — мягкий фон и тёмный текст, как у остальных меток системы.
// Цвет берётся по порядку категории в списке, так что соседние категории всегда различаются.
const CATEGORY_TONES = [
  ['#fdf0dc', '#8a5a0c'],
  ['#e6f0fb', '#2f5f9e'],
  ['#eaf6e3', '#2f6a14'],
  ['#efe9fb', '#5b43a8'],
  ['#efede7', '#5f584a'],
  ['#fbe8f1', '#a3346b'],
  ['#e2f4f2', '#1f6f68'],
  ['#fdeaea', '#b42d2d'],
];
export function categoryTone(categories, id) {
  const i = categories.findIndex((c) => c.id === id);
  if (i < 0) return { background: 'var(--surface-2)', color: 'var(--ink-2)' };
  const [background, color] = CATEGORY_TONES[i % CATEGORY_TONES.length];
  return { background, color };
}

// Создавать и править стандарты могут руководители; сотрудники только читают.
export const canEditStandards = (user) => user?.role === 'admin' || user?.role === 'manager';

export const uid = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const fmtUpdated = (isoStr) =>
  isoStr ? new Date(isoStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

// Текст статьи без разметки — для поиска.
export function plainText(html) {
  const el = document.createElement('div');
  el.innerHTML = sanitizeHtml(html || '');
  return el.textContent.replace(/\s+/g, ' ').trim();
}

// ---------- Очистка HTML ----------
// Статьи пишут люди, а читают все, поэтому разметку чистим при каждом показе и сохранении:
// остаются только теги форматирования, ссылки на http(s)/почту/телефон и картинки из нашего хранилища.

const ALLOWED = {
  P: [], H2: [], H3: [], H4: [], BR: [], HR: [], BLOCKQUOTE: [],
  STRONG: [], B: [], EM: [], I: [], U: [], S: [],
  UL: [], OL: [], LI: [],
  TABLE: [], THEAD: [], TBODY: [], TR: [], TH: ['colspan', 'rowspan'], TD: ['colspan', 'rowspan'],
  A: ['href'],
  IMG: ['src', 'alt'],
};
const RENAME = { DIV: 'P', H1: 'H2', H5: 'H4', H6: 'H4' };
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'SVG', 'MATH', 'NOSCRIPT', 'TITLE', 'META', 'LINK', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA']);

const safeHref = (v) => /^(https?:|mailto:|tel:)/i.test(v.trim()) ? v.trim() : null;
const safeSrc = (v) => (/^\/api\/files\/[a-z0-9]{6,40}$/.test(v.trim()) || /^https:\/\//i.test(v.trim()) ? v.trim() : null);

function clean(node, doc) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) continue;
    if (child.nodeType !== 1) {
      child.remove();
      continue;
    }
    const tag = child.tagName;
    if (DROP.has(tag)) {
      child.remove();
      continue;
    }
    clean(child, doc);
    if (RENAME[tag]) {
      const repl = doc.createElement(RENAME[tag]);
      while (child.firstChild) repl.appendChild(child.firstChild);
      child.replaceWith(repl);
      continue;
    }
    if (!ALLOWED[tag]) {
      // Неизвестный тег убираем, а содержимое сохраняем.
      child.replaceWith(...child.childNodes);
      continue;
    }
    for (const attr of [...child.attributes]) {
      if (!ALLOWED[tag].includes(attr.name)) child.removeAttribute(attr.name);
    }
    if (tag === 'A') {
      const href = safeHref(child.getAttribute('href') || '');
      if (href) {
        child.setAttribute('href', href);
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      } else child.removeAttribute('href');
    }
    if (tag === 'IMG') {
      const src = safeSrc(child.getAttribute('src') || '');
      if (!src) child.remove();
      else child.setAttribute('src', src);
    }
    for (const a of ['colspan', 'rowspan']) {
      if (child.hasAttribute(a) && !/^\d{1,2}$/.test(child.getAttribute(a))) child.removeAttribute(a);
    }
  }
}

export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  clean(doc.body, doc);
  return doc.body.innerHTML;
}

export const isEmptyHtml = (html) => !plainText(html) && !/<(img|table|hr)\b/i.test(html || '');
