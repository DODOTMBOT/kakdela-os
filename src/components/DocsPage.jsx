import { useEffect, useMemo, useRef, useState } from 'react';
import EditModal from './EditModal.jsx';
import FileViewer from './FileViewer.jsx';
import { IconEdit, IconFolder, IconUpload } from './Icons.jsx';
import { deleteBlobs, putBlob } from '../fileStore.js';
import { fileBadge, fileKind, fmtSize, useBlobUrl } from '../files.js';
import { getThumb, previewKind } from '../previews.js';
import { fmtDay, plural } from '../utils.js';
import { iso } from '../data.js';
import { useShared } from '../sync.js';

const STORAGE_KEY = 'ledger:files:v1';
const NODE_MIME = 'application/x-ledger-node';
const uid = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const KIND_ORDER = { folder: 0, file: 1 };
const NAME_FIELDS = [{ name: 'name', label: 'Название', required: true, placeholder: 'Например, Договоры' }];

const todayIso = () => {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
};

// id элемента и всех вложенных в него.
function subtree(nodes, id) {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) {
    for (const n of nodes) if (n.parent === ids[i]) ids.push(n.id);
  }
  return ids;
}

function DocThumb({ node }) {
  const [thumb, setThumb] = useState(undefined);
  useEffect(() => {
    let alive = true;
    getThumb(node).then((t) => alive && setThumb(t));
    return () => {
      alive = false;
    };
  }, [node]);

  if (thumb === undefined) return <div className="tile-thumb is-loading" />;
  if (!thumb) {
    const badge = fileBadge(node);
    return (
      <div className="tile-thumb">
        <span className="file-badge" style={{ background: badge.color }}>{badge.label}</span>
      </div>
    );
  }
  if (thumb.type === 'image') {
    return (
      <div className="tile-thumb tile-paper">
        <img src={thumb.url} alt="" />
      </div>
    );
  }
  if (thumb.type === 'table') {
    return (
      <div className="tile-thumb tile-sheet">
        <table>
          <tbody>
            {thumb.rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="tile-thumb tile-text">
      <p>{thumb.text || 'Пустой документ'}</p>
    </div>
  );
}

function Thumb({ node, count }) {
  const kind = node.kind === 'file' ? fileKind(node) : node.kind;
  const url = useBlobUrl(node.id, kind === 'image' || kind === 'video');

  if (node.kind === 'folder') {
    return (
      <div className="tile-thumb tile-folder">
        <IconFolder size={44} />
        <span>{count ? `${count} ${plural(count, ['элемент', 'элемента', 'элементов'])}` : 'Пусто'}</span>
      </div>
    );
  }
  if (kind === 'image' && url) return <div className="tile-thumb"><img src={url} alt="" /></div>;
  if (kind === 'video' && url) {
    return (
      <div className="tile-thumb">
        <video src={url} muted preload="metadata" />
        <span className="tile-play" aria-hidden="true">▶</span>
      </div>
    );
  }
  if (previewKind(node)) return <DocThumb node={node} />;
  const badge = fileBadge(node);
  return (
    <div className="tile-thumb">
      <span className="file-badge" style={{ background: badge.color }}>{badge.label}</span>
    </div>
  );
}

export default function DocsPage() {
  const [rawNodes, setNodes] = useShared(STORAGE_KEY, []);
  // Чек-листы из ранней версии раздела больше не поддерживаются.
  const nodes = useMemo(() => rawNodes.filter((n) => n.kind in KIND_ORDER), [rawNodes]);
  const [folderId, setFolderId] = useState(null);
  // { mode: 'new-folder' | 'rename', node? }
  const [edit, setEdit] = useState(null);
  const [viewId, setViewId] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(0);
  const [fileDrag, setFileDrag] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const inputRef = useRef(null);


  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const current = folderId && byId[folderId] ? folderId : null;

  const path = [];
  for (let id = current; id; id = byId[id]?.parent) path.unshift(byId[id]);

  const items = nodes
    .filter((n) => n.parent === current)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, 'ru'));
  const countIn = (id) => nodes.filter((n) => n.parent === id).length;

  const update = (id, patch) => setNodes((list) => list.map((n) => (n.id === id ? { ...n, ...patch } : n)));

  const remove = (id) => {
    const ids = subtree(nodes, id);
    const fileIds = ids.filter((x) => byId[x]?.kind === 'file');
    if (fileIds.length) deleteBlobs(fileIds).catch(() => {});
    setNodes((list) => list.filter((n) => !ids.includes(n.id)));
    setEdit(null);
    setViewId(null);
  };

  const upload = async (files) => {
    setError('');
    const parent = current;
    const failed = [];
    setUploading((n) => n + files.length);
    for (const file of files) {
      const id = uid();
      try {
        await putBlob(id, file);
        const node = { id, parent, kind: 'file', name: file.name, size: file.size, mime: file.type, date: todayIso() };
        setNodes((list) => [...list, node]);
      } catch {
        failed.push(file.name);
      }
      setUploading((n) => n - 1);
    }
    if (failed.length) setError(`Не удалось сохранить: ${failed.join(', ')}. Возможно, в браузере закончилось место`);
  };

  const saveName = ({ name }) => {
    if (edit.mode === 'rename') update(edit.node.id, { name });
    else setNodes((list) => [...list, { id: uid(), parent: current, kind: 'folder', name, date: todayIso() }]);
    setEdit(null);
  };

  const open = (n) => {
    if (n.kind === 'folder') setFolderId(n.id);
    else setViewId(n.id);
  };

  // Перенос элементов в папку (или в папку из «хлебных крошек»).
  const canDropInto = (targetId) => dragId && targetId !== dragId && !subtree(nodes, dragId).includes(targetId);
  const dropProps = (targetId) => ({
    onDragOver: (e) => {
      if (!canDropInto(targetId)) return;
      e.preventDefault();
      e.stopPropagation();
      if (dropTarget !== targetId) setDropTarget(targetId);
    },
    onDragLeave: (e) => !e.currentTarget.contains(e.relatedTarget) && setDropTarget(null),
    onDrop: (e) => {
      if (!canDropInto(targetId)) return;
      e.preventDefault();
      e.stopPropagation();
      update(dragId, { parent: targetId });
      setDragId(null);
      setDropTarget(null);
    },
  });

  // Файлы, перетащенные с компьютера.
  const pageDrop = {
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      setFileDrag(true);
    },
    onDragLeave: (e) => !e.currentTarget.contains(e.relatedTarget) && setFileDrag(false),
    onDrop: (e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      setFileDrag(false);
      upload([...e.dataTransfer.files]);
    },
  };

  const viewing = viewId && byId[viewId];

  return (
    <div className="docs" {...pageDrop}>
      <div className="page-head">
        <h1>Документы</h1>
        <div className="docs-actions">
          <button className="btn btn-outline btn-icon" onClick={() => setEdit({ mode: 'new-folder' })}>
            <IconFolder size={16} />
            Папка
          </button>
          <button className="btn btn-primary btn-icon" onClick={() => inputRef.current.click()}>
            <IconUpload size={16} />
            Загрузить файлы
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              upload([...e.target.files]);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <nav className="crumbs" aria-label="Путь">
        {[{ id: null, name: 'Все документы' }, ...path].map((p, i, arr) => {
          const last = i === arr.length - 1;
          return (
            <span key={p.id ?? 'root'} className="crumb-wrap">
              <button
                className={`crumb ${last ? 'is-current' : ''} ${dropTarget === p.id && dragId ? 'is-drop' : ''}`}
                aria-current={last ? 'page' : undefined}
                onClick={() => setFolderId(p.id)}
                {...(last ? {} : dropProps(p.id))}
              >
                {p.name}
              </button>
              {!last && <span className="crumb-sep">/</span>}
            </span>
          );
        })}
      </nav>

      {error && (
        <p className="docs-error">
          {error}
          <button className="link-btn" onClick={() => setError('')}>Скрыть</button>
        </p>
      )}
      {uploading > 0 && <p className="docs-status">Загрузка: {uploading}…</p>}

      {items.length === 0 ? (
        <div className={`docs-empty ${fileDrag ? 'is-over' : ''}`}>
          <IconUpload size={28} />
          <p>{current ? 'Папка пуста' : 'Здесь пока ничего нет'}</p>
          <span>Перетащите сюда файлы с компьютера или создайте папку</span>
        </div>
      ) : (
        <div className={`tiles ${fileDrag ? 'is-over' : ''}`}>
          {items.map((n) => (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              draggable
              className={`tile ${dragId === n.id ? 'is-dragging' : ''} ${dropTarget === n.id ? 'is-drop' : ''}`}
              onClick={() => open(n)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open(n))}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData(NODE_MIME, n.id);
                setDragId(n.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropTarget(null);
              }}
              {...(n.kind === 'folder' ? dropProps(n.id) : {})}
            >
              <Thumb node={n} count={n.kind === 'folder' ? countIn(n.id) : 0} />
              <div className="tile-info">
                <span className="tile-name" title={n.name}>{n.name}</span>
                <span className="tile-meta">
                  {n.kind === 'file' && (
                    <>
                      <b style={{ color: fileBadge(n).color }}>{fileBadge(n).label}</b> · {fmtSize(n.size)} ·{' '}
                    </>
                  )}
                  {fmtDay(n.date)}
                </span>
              </div>
              {n.kind === 'folder' && (
                <button
                  className="tile-edit"
                  aria-label={`Изменить папку ${n.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEdit({ mode: 'rename', node: n });
                  }}
                >
                  <IconEdit size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {fileDrag && (
        <div className="docs-drop" aria-hidden="true">
          <IconUpload size={22} />
          Отпустите, чтобы загрузить в «{path.at(-1)?.name ?? 'Все документы'}»
        </div>
      )}

      {edit && (
        <EditModal
          title={edit.mode === 'new-folder' ? 'Новая папка' : 'Переименовать'}
          fields={NAME_FIELDS}
          initial={edit.node ?? {}}
          onSave={saveName}
          onDelete={edit.mode === 'rename' && edit.node.kind === 'folder' ? () => remove(edit.node.id) : undefined}
          deleteHint={
            edit.node && countIn(edit.node.id)
              ? 'Удалить папку вместе со всем содержимым?'
              : 'Удалить папку?'
          }
          onClose={() => setEdit(null)}
        />
      )}

      {viewing && !edit && (
        <FileViewer
          node={viewing}
          onRename={() => setEdit({ mode: 'rename', node: viewing })}
          onDelete={() => remove(viewing.id)}
          onClose={() => setViewId(null)}
        />
      )}

    </div>
  );
}
