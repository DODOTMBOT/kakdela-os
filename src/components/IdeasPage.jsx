import { Fragment, useRef, useState } from 'react';
import EditModal from './EditModal.jsx';
import { IconPlus } from './Icons.jsx';
import { fmtDay, plural } from '../utils.js';
import { iso } from '../data.js';
import { useShared } from '../sync.js';
import { IDEAS_KEY, IDEA_COLUMNS, ideaStatus } from '../ideas.js';

const STORAGE_KEY = IDEAS_KEY;
const uid = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const COLUMNS = IDEA_COLUMNS;

const FIELDS = [
  { name: 'title', label: 'Идея', required: true, placeholder: 'Коротко, в одну строку' },
  { name: 'note', label: 'Описание', textarea: true, placeholder: 'Как это может выглядеть, что нужно' },
  { name: 'status', label: 'Статус', options: COLUMNS.map((c) => [c.id, c.label]) },
];

const statusOf = ideaStatus;

const todayIso = () => {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
};

export default function IdeasPage() {
  const [ideas, setIdeas] = useShared(STORAGE_KEY, []);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const titleRef = useRef(null);
  const noteRef = useRef(null);
  const [edit, setEdit] = useState(null);
  const [dragId, setDragId] = useState(null);
  // Куда упадёт карточка: колонка и id карточки, перед которой вставить (null — в конец).
  const [drop, setDrop] = useState(null);


  const add = (e) => {
    e?.preventDefault();
    const title = draft.trim();
    if (!title) return titleRef.current.focus();
    setIdeas((list) => [{ id: uid(), title, note: note.trim(), status: 'new', date: todayIso() }, ...list]);
    setDraft('');
    setNote('');
    titleRef.current.focus();
  };

  const save = (values) => {
    const { status, ...rest } = values;
    setIdeas((list) => list.map((i) => (i.id === edit.id ? { ...i, ...rest } : i)));
    if (status !== statusOf(edit)) move(edit.id, status, null);
    setEdit(null);
  };

  const move = (id, status, beforeId) =>
    setIdeas((list) => {
      const item = list.find((i) => i.id === id);
      if (!item) return list;
      const rest = list.filter((i) => i.id !== id);
      let at = beforeId ? rest.findIndex((i) => i.id === beforeId) : -1;
      if (at === -1) at = rest.findLastIndex((i) => statusOf(i) === status) + 1;
      rest.splice(at, 0, { ...item, status });
      return rest;
    });

  const onDragOver = (e, status) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const cards = [...e.currentTarget.querySelectorAll('[data-id]')].filter((el) => el.dataset.id !== dragId);
    const before = cards.find((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    const beforeId = before?.dataset.id ?? null;
    if (drop?.status !== status || drop?.beforeId !== beforeId) setDrop({ status, beforeId });
  };

  const onDrop = (e, status) => {
    e.preventDefault();
    if (dragId) move(dragId, status, drop?.status === status ? drop.beforeId : null);
    setDragId(null);
    setDrop(null);
  };

  const remove = () => {
    setIdeas((list) => list.filter((i) => i.id !== edit.id));
    setEdit(null);
  };

  return (
    <>
      <div className="page-head">
        <h1>Идеи</h1>
        {ideas.length > 0 && (
          <span className="page-count">{ideas.length} {plural(ideas.length, ['идея', 'идеи', 'идей'])}</span>
        )}
      </div>

      <form className="idea-add" onSubmit={add}>
        <input
          ref={titleRef}
          autoFocus
          className="idea-add-title"
          placeholder="Идея"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.metaKey || e.ctrlKey) add();
              else noteRef.current.focus();
            }
          }}
          aria-label="Новая идея"
        />
        <textarea
          ref={noteRef}
          rows={2}
          className="idea-add-note"
          placeholder="Описание: как это может выглядеть, что нужно"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(e);
          }}
          aria-label="Описание идеи"
        />
        <div className="idea-add-foot">
          <span>⌘/Ctrl + Enter — добавить</span>
          <button type="submit" className="btn btn-primary btn-icon" disabled={!draft.trim()}>
            <IconPlus size={16} />
            Добавить
          </button>
        </div>
      </form>

      <div className="kb">
        {COLUMNS.map((col) => {
          const items = ideas.filter((i) => statusOf(i) === col.id);
          const over = drop?.status === col.id;
          const line = <div className="kb-drop" aria-hidden="true" />;
          return (
            <section
              key={col.id}
              className={`kb-col ${over ? 'is-over' : ''}`}
              style={{ '--tint': col.tint, '--over': col.over }}
              aria-label={col.label}
              onDragOver={(e) => onDragOver(e, col.id)}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setDrop(null)}
              onDrop={(e) => onDrop(e, col.id)}
            >
              <header className="kb-head">
                <i style={{ background: col.dot }} />
                <h3>{col.label}</h3>
                <span>{items.length}</span>
              </header>

              <div className="kb-cards">
                {items.map((i) => (
                  <Fragment key={i.id}>
                    {over && drop.beforeId === i.id && line}
                    <button
                      data-id={i.id}
                      draggable
                      className={`idea ${dragId === i.id ? 'is-dragging' : ''}`}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', i.id);
                        setDragId(i.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDrop(null);
                      }}
                      onClick={() => setEdit(i)}
                    >
                      <span className="idea-title">{i.title}</span>
                      {i.note && <span className="idea-note">{i.note}</span>}
                      <span className="idea-date">{fmtDay(i.date)}</span>
                    </button>
                  </Fragment>
                ))}
                {over && drop.beforeId === null && line}
                {items.length === 0 && !over && (
                  <p className="kb-empty">{col.id === 'new' ? 'Новые идеи появятся здесь' : 'Перетащите карточку сюда'}</p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {edit && (
        <EditModal
          title="Идея"
          fields={FIELDS}
          initial={{ ...edit, status: statusOf(edit) }}
          onSave={save}
          onDelete={remove}
          deleteHint="Удалить идею?"
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}
