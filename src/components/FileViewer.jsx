import { useEffect, useState } from 'react';
import { useEscape } from './Popover.jsx';
import { IconClose, IconDownload, IconEdit } from './Icons.jsx';
import { downloadFile, fileBadge, fileKind, fmtSize, useBlobUrl } from '../files.js';
import { previewKind, readSheets, readWordHtml } from '../previews.js';
import { fmtDay } from '../utils.js';

const MAX_ROWS = 1000;

// Загрузка превью документа: { data } | { error }.
function useAsync(fn, deps) {
  const [state, setState] = useState(null);
  useEffect(() => {
    let alive = true;
    setState(null);
    fn()
      .then((data) => alive && setState({ data }))
      .catch(() => alive && setState({ error: true }));
    return () => {
      alive = false;
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

function WordPreview({ node }) {
  const state = useAsync(() => readWordHtml(node), [node.id]);
  if (!state) return <div className="viewer-none">Открываем документ…</div>;
  if (state.error) return <div className="viewer-none">Не удалось прочитать документ — попробуйте скачать его</div>;
  return <div className="viewer-doc" dangerouslySetInnerHTML={{ __html: state.data || '<p>Документ пуст</p>' }} />;
}

function SheetPreview({ node }) {
  const state = useAsync(() => readSheets(node, MAX_ROWS + 1), [node.id]);
  const [sheet, setSheet] = useState(0);
  if (!state) return <div className="viewer-none">Открываем таблицу…</div>;
  if (state.error || !state.data.length) return <div className="viewer-none">Не удалось прочитать таблицу — попробуйте скачать её</div>;

  const sheets = state.data;
  const current = sheets[Math.min(sheet, sheets.length - 1)];
  const rows = current.rows.slice(0, MAX_ROWS);
  const width = Math.max(1, ...rows.map((r) => r.length));
  return (
    <div className="viewer-sheet">
      {sheets.length > 1 && (
        <div className="tabs viewer-tabs" role="tablist">
          {sheets.map((s, i) => (
            <button key={s.name} role="tab" aria-selected={i === sheet} className={i === sheet ? 'is-active' : ''} onClick={() => setSheet(i)}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="viewer-table">
        {rows.length === 0 ? (
          <p className="viewer-none">Лист пуст</p>
        ) : (
          <table>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <th>{i + 1}</th>
                  {Array.from({ length: width }, (_, j) => <td key={j}>{r[j]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {current.rows.length > MAX_ROWS && <p className="viewer-note">Показаны первые {MAX_ROWS} строк — полная таблица в файле</p>}
    </div>
  );
}

function TextPreview({ url }) {
  const [text, setText] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then((r) => r.text())
      .then((t) => alive && setText(t.length > 200000 ? `${t.slice(0, 200000)}\n…` : t));
    return () => {
      alive = false;
    };
  }, [url]);
  return <pre className="viewer-text">{text ?? 'Загрузка…'}</pre>;
}

export default function FileViewer({ node, onRename, onDelete, onClose }) {
  const url = useBlobUrl(node.id);
  const kind = fileKind(node);
  const badge = fileBadge(node);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEscape(onClose);

  const doc = previewKind(node);
  let preview;
  if (doc === 'word') preview = <WordPreview node={node} />;
  else if (doc === 'sheet') preview = <SheetPreview node={node} />;
  else if (!url) preview = <div className="viewer-none">Загрузка…</div>;
  else if (kind === 'image') preview = <img className="viewer-media" src={url} alt={node.name} />;
  else if (kind === 'video') preview = <video className="viewer-media" src={url} controls />;
  else if (kind === 'audio') preview = <div className="viewer-none"><audio src={url} controls /></div>;
  else if (kind === 'pdf') preview = <iframe className="viewer-pdf" src={url} title={node.name} />;
  else if (kind === 'text') preview = <TextPreview url={url} />;
  else {
    preview = (
      <div className="viewer-none">
        <span className="file-badge file-badge-lg" style={{ background: badge.color }}>{badge.label}</span>
        <p>Предпросмотр для этого типа файла недоступен — скачайте, чтобы открыть</p>
      </div>
    );
  }

  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal viewer" role="dialog" aria-modal="true" aria-label={node.name}>
        <header className="modal-head">
          <div className="viewer-title">
            <h2>{node.name}</h2>
            <span>{fmtSize(node.size)} · {fmtDay(node.date)}</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconClose size={18} />
          </button>
        </header>

        <div className="viewer-body">{preview}</div>

        {confirmDelete ? (
          <footer className="modal-foot modal-confirm">
            <span>Удалить файл без возможности восстановления?</span>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Нет</button>
            <button type="button" className="btn btn-danger" onClick={onDelete}>Удалить</button>
          </footer>
        ) : (
          <footer className="modal-foot">
            {/* Из «Стандартов» файл открывается только для просмотра — без удаления и переименования. */}
            {onDelete && <button type="button" className="btn btn-ghost btn-left" onClick={() => setConfirmDelete(true)}>Удалить</button>}
            {onRename && (
              <button type="button" className="btn btn-outline btn-icon" onClick={onRename}>
                <IconEdit size={16} />
                Переименовать
              </button>
            )}
            <button type="button" className="btn btn-primary btn-icon" disabled={!url} onClick={() => downloadFile(url, node.name)}>
              <IconDownload size={16} />
              Скачать
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
