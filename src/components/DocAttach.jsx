import { useMemo, useState } from 'react';
import { useEscape } from './Popover.jsx';
import { IconClose } from './Icons.jsx';
import { fileBadge, fmtSize } from '../files.js';
import { plural } from '../utils.js';

// Файлы из раздела «Документы», прикреплённые к статье или уроку: список и окно выбора.
// Прикрепляется только ссылка на файл (его id) — без копирования и дубликатов.

const docSort = (a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'ru') : a.kind === 'folder' ? -1 : 1);

// Путь к файлу в «Документах»: «Папка / Подпапка».
export function folderPath(byId, node) {
  const parts = [];
  for (let id = node?.parent; id && byId[id]; id = byId[id].parent) parts.unshift(byId[id].name);
  return parts.join(' / ');
}

export function Attachments({ ids, byId, onOpen, onRemove }) {
  if (!ids.length) return null;
  return (
    <ul className="std-files">
      {ids.map((id) => {
        const node = byId[id];
        if (!node) {
          return (
            <li key={id} className="is-missing">
              <span className="std-file-main">
                <span className="std-file-name">Файл удалён из «Документов»</span>
              </span>
              {onRemove && (
                <button type="button" className="link-btn" onClick={() => onRemove(id)}>
                  Убрать
                </button>
              )}
            </li>
          );
        }
        const badge = fileBadge(node);
        const where = folderPath(byId, node);
        return (
          <li key={id}>
            <button type="button" className="std-file-main" onClick={() => onOpen(id)}>
              <span className="file-badge std-file-badge" style={{ background: badge.color }}>{badge.label}</span>
              <span className="std-file-name">{node.name}</span>
              <span className="std-file-meta">{[where && `Документы / ${where}`, fmtSize(node.size)].filter(Boolean).join(' · ')}</span>
            </button>
            {onRemove && (
              <button type="button" className="link-btn" onClick={() => onRemove(id)}>
                Убрать
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Выбор файлов из «Документов»: папки, поиск по всем файлам, отметка нескольких.
export function DocPicker({ nodes, selected, onSave, onClose }) {
  const [picked, setPicked] = useState(() => new Set(selected));
  const [folder, setFolder] = useState(null);
  const [query, setQuery] = useState('');
  useEscape(onClose);

  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const q = query.trim().toLowerCase();
  const items = q
    ? nodes.filter((n) => n.kind === 'file' && n.name.toLowerCase().includes(q)).sort(docSort)
    : nodes.filter((n) => n.parent === folder).sort(docSort);
  const path = [];
  for (let id = folder; id && byId[id]; id = byId[id].parent) path.unshift(byId[id]);

  const toggle = (id) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal std-picker" role="dialog" aria-modal="true" aria-label="Файлы из Документов">
        <header className="modal-head">
          <h2>Файлы из «Документов»</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconClose size={18} />
          </button>
        </header>
        <input className="std-input" type="search" autoFocus placeholder="Поиск по названию файла" value={query} onChange={(e) => setQuery(e.target.value)} />
        {!q && (
          <nav className="crumbs std-picker-crumbs" aria-label="Папка">
            {[{ id: null, name: 'Все документы' }, ...path].map((p, i, arr) => (
              <span key={p.id ?? 'root'} className="crumb-wrap">
                <button type="button" className={`crumb ${i === arr.length - 1 ? 'is-current' : ''}`} onClick={() => setFolder(p.id)}>
                  {p.name}
                </button>
                {i < arr.length - 1 && <span className="crumb-sep">/</span>}
              </span>
            ))}
          </nav>
        )}
        <ul className="std-picker-list">
          {items.length === 0 && <li className="std-picker-empty">{q ? 'Ничего не найдено' : 'Папка пуста'}</li>}
          {items.map((n) =>
            n.kind === 'folder' ? (
              <li key={n.id}>
                <button type="button" className="std-picker-row" onClick={() => setFolder(n.id)}>
                  <span className="std-picker-folder">Папка</span>
                  <span className="std-file-name">{n.name}</span>
                  <span className="std-file-meta">›</span>
                </button>
              </li>
            ) : (
              <li key={n.id}>
                <label className="std-picker-row">
                  <input type="checkbox" checked={picked.has(n.id)} onChange={() => toggle(n.id)} />
                  <span className="file-badge std-file-badge" style={{ background: fileBadge(n).color }}>{fileBadge(n).label}</span>
                  <span className="std-file-name">{n.name}</span>
                  <span className="std-file-meta">{q ? folderPath(byId, n) || 'Все документы' : fmtSize(n.size)}</span>
                </label>
              </li>
            ),
          )}
        </ul>
        <footer className="modal-foot">
          <span className="std-picker-count">
            {picked.size ? `Выбрано ${picked.size} ${plural(picked.size, ['файл', 'файла', 'файлов'])}` : 'Ничего не выбрано'}
          </span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" onClick={() => onSave([...picked])}>Прикрепить</button>
        </footer>
      </div>
    </div>
  );
}

