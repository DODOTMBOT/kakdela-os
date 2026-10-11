import { useEffect, useRef, useState } from 'react';
import { putBlob } from '../fileStore.js';
import { sanitizeHtml, uid } from '../standards.js';

const BLOCKS = [
  ['p', 'Текст'],
  ['h2', 'Заголовок'],
  ['h3', 'Подзаголовок'],
];

const cellOf = (node) => (node?.nodeType === 3 ? node.parentElement : node)?.closest?.('td, th') ?? null;

// Редактор статьи: заголовки, списки, ссылки, таблицы, изображения. Хранит HTML, который
// перед сохранением и при показе проходит очистку (sanitizeHtml).
export default function RichEditor({ initialHtml, onChange, placeholder = 'Текст статьи' }) {
  const ref = useRef(null);
  const fileRef = useRef(null);
  const savedRange = useRef(null);
  const [block, setBlock] = useState('p');
  const [marks, setMarks] = useState({});
  const [cell, setCell] = useState(null);
  const [link, setLink] = useState(null); // строка ввода адреса ссылки
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    ref.current.innerHTML = sanitizeHtml(initialHtml || '') || '<p><br></p>';
    document.execCommand('defaultParagraphSeparator', false, 'p');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = () => onChange(ref.current.innerHTML);

  // Состояние панели под текущее положение курсора.
  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection();
      if (!sel.rangeCount || !ref.current?.contains(sel.anchorNode)) return;
      const el = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
      const b = el.closest('h2, h3, p, li, td, th');
      setBlock(b && ['H2', 'H3'].includes(b.tagName) ? b.tagName.toLowerCase() : 'p');
      setMarks({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList'),
      });
      setCell(cellOf(sel.anchorNode));
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const exec = (cmd, value = null) => {
    ref.current.focus();
    document.execCommand(cmd, false, value);
    emit();
  };

  const saveRange = () => {
    const sel = document.getSelection();
    savedRange.current = sel.rangeCount && ref.current.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
  };
  const restoreRange = () => {
    ref.current.focus();
    const sel = document.getSelection();
    if (savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const insertHtml = (html) => {
    ref.current.focus();
    document.execCommand('insertHTML', false, html);
    emit();
  };

  const applyLink = () => {
    let url = link.trim();
    setLink(null);
    restoreRange();
    if (!url) return;
    if (!/^(https?:|mailto:|tel:)/i.test(url)) url = url.includes('@') && !url.includes('/') ? `mailto:${url}` : `https://${url}`;
    const sel = document.getSelection();
    if (sel.isCollapsed) {
      const a = document.createElement('a');
      a.href = url;
      a.textContent = url.replace(/^(https?:\/\/|mailto:|tel:)/i, '');
      insertHtml(a.outerHTML + '&nbsp;');
    } else exec('createLink', url);
  };

  const insertTable = () => {
    const row = (tag) => `<tr>${`<${tag}><br></${tag}>`.repeat(3)}</tr>`;
    insertHtml(`<table><thead>${row('th')}</thead><tbody>${row('td')}${row('td')}</tbody></table><p><br></p>`);
  };

  // Действия со строками и столбцами таблицы, в которой стоит курсор.
  const tableAction = (action) => {
    if (!cell || !ref.current.contains(cell)) return;
    const tr = cell.parentElement;
    const table = cell.closest('table');
    const index = [...tr.children].indexOf(cell);
    const rows = [...table.querySelectorAll('tr')];
    if (action === 'row+') {
      const fresh = document.createElement('tr');
      for (let i = 0; i < tr.children.length; i++) fresh.appendChild(Object.assign(document.createElement('td'), { innerHTML: '<br>' }));
      (tr.parentElement.tagName === 'THEAD' ? table.tBodies[0] ?? table.createTBody() : tr.parentElement).insertBefore(
        fresh,
        tr.parentElement.tagName === 'THEAD' ? (table.tBodies[0]?.firstChild ?? null) : tr.nextSibling,
      );
    } else if (action === 'col+') {
      for (const r of rows) {
        const ref2 = r.children[index];
        const c = document.createElement(r.parentElement.tagName === 'THEAD' ? 'th' : 'td');
        c.innerHTML = '<br>';
        r.insertBefore(c, ref2?.nextSibling ?? null);
      }
    } else if (action === 'row-') {
      if (rows.length <= 1) table.remove();
      else tr.remove();
    } else if (action === 'col-') {
      if (tr.children.length <= 1) table.remove();
      else for (const r of rows) r.children[index]?.remove();
    } else if (action === 'drop') table.remove();
    setCell(null);
    emit();
  };

  const uploadImages = async (files) => {
    setError('');
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    saveRange();
    setUploading((n) => n + images.length);
    for (const file of images) {
      const id = uid('img');
      try {
        await putBlob(id, file);
        restoreRange();
        insertHtml(`<img src="/api/files/${id}" alt="">`);
        saveRange();
      } catch (err) {
        setError(err.message || 'Не удалось загрузить изображение');
      }
      setUploading((n) => n - 1);
    }
  };

  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      uploadImages(files);
      return;
    }
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    e.preventDefault();
    if (html) insertHtml(sanitizeHtml(html));
    else {
      document.execCommand('insertText', false, text);
      emit();
    }
  };

  const onDrop = (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    const pos = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (pos) {
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(pos);
    }
    uploadImages(files);
  };

  // Кнопки панели не забирают фокус у текста, чтобы выделение не терялось.
  const keep = (e) => e.preventDefault();
  const Btn = ({ on, label, title, onClick }) => (
    <button type="button" className={`re-btn ${on ? 'is-on' : ''}`} title={title} aria-pressed={on || undefined} onMouseDown={keep} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <div className="re">
      <div className="re-bar" role="toolbar" aria-label="Форматирование">
        <select
          className="re-select"
          value={block}
          aria-label="Стиль абзаца"
          onMouseDown={saveRange}
          onChange={(e) => {
            restoreRange();
            exec('formatBlock', `<${e.target.value}>`);
          }}
        >
          {BLOCKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="re-sep" />
        <Btn on={marks.bold} label={<b>Ж</b>} title="Жирный (Ctrl+B)" onClick={() => exec('bold')} />
        <Btn on={marks.italic} label={<i>К</i>} title="Курсив (Ctrl+I)" onClick={() => exec('italic')} />
        <span className="re-sep" />
        <Btn on={marks.ul} label="• Список" title="Маркированный список" onClick={() => exec('insertUnorderedList')} />
        <Btn on={marks.ol} label="1. Список" title="Нумерованный список" onClick={() => exec('insertOrderedList')} />
        <span className="re-sep" />
        <Btn
          label="Ссылка"
          title="Вставить ссылку"
          onClick={() => {
            saveRange();
            setLink('');
          }}
        />
        <Btn label="Таблица" title="Вставить таблицу" onClick={insertTable} />
        <Btn
          label="Изображение"
          title="Загрузить изображение"
          onClick={() => {
            saveRange();
            fileRef.current.click();
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...e.target.files];
            e.target.value = '';
            restoreRange();
            uploadImages(files);
          }}
        />
        {uploading > 0 && <span className="re-status">Загружаем изображение…</span>}
      </div>

      {link !== null && (
        <div className="re-sub">
          <input
            autoFocus
            className="re-input"
            placeholder="Адрес ссылки, например kbkdk.ru"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                setLink(null);
                restoreRange();
              }
            }}
          />
          <button type="button" className="link-btn" onClick={applyLink}>Вставить</button>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setLink(null);
              restoreRange();
            }}
          >
            Отмена
          </button>
        </div>
      )}

      {cell && ref.current?.contains(cell) && (
        <div className="re-sub">
          <span>Таблица:</span>
          <Btn label="+ строка" onClick={() => tableAction('row+')} />
          <Btn label="+ столбец" onClick={() => tableAction('col+')} />
          <Btn label="− строка" onClick={() => tableAction('row-')} />
          <Btn label="− столбец" onClick={() => tableAction('col-')} />
          <Btn label="Удалить таблицу" onClick={() => tableAction('drop')} />
        </div>
      )}

      <div
        ref={ref}
        className="re-area std-content"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        data-placeholder={placeholder}
        onInput={emit}
        onPaste={onPaste}
        onDrop={onDrop}
      />
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
