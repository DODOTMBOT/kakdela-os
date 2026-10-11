// Превью документов. Библиотеки грузятся по требованию, чтобы не утяжелять остальное приложение.
import { getBlob } from './fileStore.js';

const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
const SHEET_EXT = ['xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv'];
const TEXT_EXT = ['txt', 'md', 'json', 'log', 'xml', 'yml', 'yaml'];

// Какой вид превью доступен для файла: pdf | word | sheet | text | null.
export function previewKind(node) {
  const ext = extOf(node.name);
  if (ext === 'pdf' || node.mime === 'application/pdf') return 'pdf';
  if (ext === 'docx') return 'word';
  if (SHEET_EXT.includes(ext)) return 'sheet';
  if (TEXT_EXT.includes(ext) || node.mime?.startsWith('text/')) return 'text';
  return null;
}

let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfjsPromise;
}
const loadMammoth = () => import('mammoth/mammoth.browser.min.js').then((m) => m.default ?? m);
const loadXlsx = () => import('xlsx');

async function blobOf(node) {
  const blob = await getBlob(node.id);
  if (!blob) throw new Error('Файл не найден в хранилище');
  return blob;
}

// Таблица: [{ name, rows: string[][] }] — листы книги или один лист для CSV.
export async function readSheets(node, maxRows) {
  const XLSX = await loadXlsx();
  const blob = await blobOf(node);
  const ext = extOf(node.name);
  const wb =
    ext === 'csv' || ext === 'tsv'
      ? XLSX.read(await blob.text(), { type: 'string', sheetRows: maxRows, raw: true })
      : XLSX.read(await blob.arrayBuffer(), { sheetRows: maxRows });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false }),
  }));
}

// HTML документа Word. Ссылки оставляем только безопасные, скрипты и обработчики выкидываем.
export async function readWordHtml(node) {
  const mammoth = await loadMammoth();
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await (await blobOf(node)).arrayBuffer() });
  const doc = new DOMParser().parseFromString(`<div>${value}</div>`, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, style').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    }
  });
  doc.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (/^(https?:|mailto:|#)/i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else a.removeAttribute('href');
  });
  doc.querySelectorAll('img').forEach((img) => {
    if (!/^data:image\//i.test(img.getAttribute('src') || '')) img.remove();
  });
  return doc.body.firstChild.innerHTML;
}

// Превью для плитки кэшируется на время сессии: повторно открывать папку быстро.
const thumbCache = new Map();

async function makeThumb(node) {
  const kind = previewKind(node);
  if (kind === 'pdf') {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await (await blobOf(node)).arrayBuffer());
    const task = pdfjs.getDocument({ data, isEvalSupported: false });
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 360 / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      return { type: 'image', url: URL.createObjectURL(blob), pages: pdf.numPages };
    } finally {
      task.destroy();
    }
  }
  if (kind === 'sheet') {
    const [first] = await readSheets(node, 8);
    return { type: 'table', rows: (first?.rows ?? []).slice(0, 7).map((r) => r.slice(0, 4)) };
  }
  if (kind === 'word') {
    const mammoth = await loadMammoth();
    const { value } = await mammoth.extractRawText({ arrayBuffer: await (await blobOf(node)).arrayBuffer() });
    return { type: 'text', text: value.trim().slice(0, 600) };
  }
  if (kind === 'text') {
    return { type: 'text', text: (await (await blobOf(node)).slice(0, 2000).text()).trim() };
  }
  return null;
}

export function getThumb(node) {
  const key = `${node.id}:${node.name}`;
  if (!thumbCache.has(key)) {
    thumbCache.set(
      key,
      makeThumb(node).catch((err) => {
        console.warn(`Превью «${node.name}» недоступно:`, err);
        thumbCache.delete(key);
        return null;
      }),
    );
  }
  return thumbCache.get(key);
}

// Текст из загруженного файла (таблица, Word, текст) — для отправки на анализ. null — формат не текстовый.
export async function extractText(file) {
  const ext = extOf(file.name);
  if (SHEET_EXT.includes(ext)) {
    const XLSX = await loadXlsx();
    const wb =
      ext === 'csv' || ext === 'tsv'
        ? XLSX.read(await file.text(), { type: 'string', raw: true })
        : XLSX.read(await file.arrayBuffer());
    return wb.SheetNames.map((name) => `Лист «${name}»:\n${XLSX.utils.sheet_to_csv(wb.Sheets[name], { FS: ';', blankrows: false })}`).join('\n\n');
  }
  if (ext === 'docx') {
    const mammoth = await loadMammoth();
    return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  }
  if (TEXT_EXT.includes(ext) || file.type.startsWith('text/')) return file.text();
  return null;
}
