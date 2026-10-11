import { useEffect, useMemo, useRef, useState } from 'react';
import RichEditor from './RichEditor.jsx';
import FileViewer from './FileViewer.jsx';
import { Attachments, DocPicker } from './DocAttach.jsx';
import { useEscape } from './Popover.jsx';
import { IconClose } from './Icons.jsx';
import { api, initials } from '../api.js';
import { putBlob } from '../fileStore.js';
import { useShared } from '../sync.js';
import { roleLabel } from '../access.js';
import { plural } from '../utils.js';
import { DEFAULT_CATEGORIES, DOCS_KEY, STANDARDS_KEY, STANDARD_CATEGORIES_KEY, categoryTone, isEmptyHtml, sanitizeHtml } from '../standards.js';
import { uid } from '../training.js';

const emptyLesson = () => ({ id: uid('ls'), title: '', html: '', videos: [], attachments: [], standards: [] });
const emptyQuestion = () => ({ id: uid('q'), text: '', options: [{ id: uid('o'), text: '' }, { id: uid('o'), text: '' }], correct: [] });

const move = (list, i, d) => {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

// Выбор статей из «Стандартов»: урок ссылается на статью, текст не копируется.
function StandardPicker({ articles, categories, selected, onSave, onClose }) {
  const [picked, setPicked] = useState(() => new Set(selected));
  const [query, setQuery] = useState('');
  useEscape(onClose);
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const q = query.trim().toLowerCase();
  const list = articles.filter((a) => !q || `${a.title} ${a.description ?? ''}`.toLowerCase().includes(q)).sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  const toggle = (id) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal std-picker" role="dialog" aria-modal="true" aria-label="Статьи из Стандартов">
        <header className="modal-head">
          <h2>Статьи из «Стандартов»</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconClose size={18} />
          </button>
        </header>
        <input className="std-input" type="search" autoFocus placeholder="Поиск по названию статьи" value={query} onChange={(e) => setQuery(e.target.value)} />
        <ul className="std-picker-list">
          {list.length === 0 && <li className="std-picker-empty">{articles.length ? 'Ничего не найдено' : 'В «Стандартах» пока нет статей'}</li>}
          {list.map((a) => (
            <li key={a.id}>
              <label className="std-picker-row">
                <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
                <span className="std-badge" style={categoryTone(categories, catById[a.categoryId] ? a.categoryId : null)}>
                  {catById[a.categoryId]?.name ?? 'Без категории'}
                </span>
                <span className="std-file-name">{a.title}</span>
              </label>
            </li>
          ))}
        </ul>
        <footer className="modal-foot">
          <span className="std-picker-count">{picked.size ? `Выбрано ${picked.size}` : 'Ничего не выбрано'}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" onClick={() => onSave([...picked])}>Прикрепить</button>
        </footer>
      </div>
    </div>
  );
}

// Список прикреплённых статей «Стандартов».
export function StandardLinks({ ids, articles, categories, onOpen, onRemove }) {
  const byId = Object.fromEntries(articles.map((a) => [a.id, a]));
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  if (!ids.length) return null;
  return (
    <ul className="std-files">
      {ids.map((id) => {
        const a = byId[id];
        return (
          <li key={id} className={a ? '' : 'is-missing'}>
            {a ? (
              <button type="button" className="std-file-main" onClick={() => onOpen?.(id)}>
                <span className="std-badge" style={categoryTone(categories, catById[a.categoryId] ? a.categoryId : null)}>
                  {catById[a.categoryId]?.name ?? 'Без категории'}
                </span>
                <span className="std-file-name">{a.title}</span>
              </button>
            ) : (
              <span className="std-file-main">
                <span className="std-file-name">Статья удалена из «Стандартов»</span>
              </span>
            )}
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

// Выбор сотрудников, которым назначен курс.
function AssigneePicker({ users, value, onChange }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const list = users.filter((u) => !q || `${u.name} ${u.position ?? ''}`.toLowerCase().includes(q));
  const set = new Set(value);
  const toggle = (id) => onChange(set.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="tr-assign">
      <div className="tr-assign-head">
        <input className="std-input" type="search" placeholder="Поиск по имени или должности" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="button" className="link-btn" onClick={() => onChange(value.length === users.length ? [] : users.map((u) => u.id))}>
          {value.length === users.length ? 'Снять всех' : 'Выбрать всех'}
        </button>
      </div>
      <ul className="std-picker-list tr-assign-list">
        {list.length === 0 && <li className="std-picker-empty">Никого не нашлось</li>}
        {list.map((u) => (
          <li key={u.id}>
            <label className="std-picker-row">
              <input type="checkbox" checked={set.has(u.id)} onChange={() => toggle(u.id)} />
              <i className="upick-avatar">{initials(u.name)}</i>
              <span className="std-file-name">{u.name}</span>
              <span className="std-file-meta">{[u.position, roleLabel(u.role)].filter(Boolean).join(' · ')}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LessonEditor({ lesson, onChange, docs, docsById, articles, categories }) {
  const [picker, setPicker] = useState(null); // 'docs' | 'standards'
  const [viewId, setViewId] = useState(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState('');
  const videoRef = useRef(null);
  const set = (patch) => onChange({ ...lesson, ...patch });

  const uploadVideos = async (files) => {
    setError('');
    for (const file of files) {
      if (!file.type.startsWith('video/')) {
        setError(`«${file.name}» — не видео`);
        continue;
      }
      const id = uid('vid');
      setUploading((n) => n + 1);
      try {
        await putBlob(id, file);
        onChange((l) => ({ ...l, videos: [...(l.videos ?? []), { id, name: file.name, size: file.size }] }));
      } catch (err) {
        setError(err.message || 'Не удалось загрузить видео');
      }
      setUploading((n) => n - 1);
    }
  };

  return (
    <div className="tr-lesson-edit">
      <label className="field">
        Название урока
        <input value={lesson.title} placeholder="Например, Знакомство с баром" onChange={(e) => set({ title: e.target.value })} />
      </label>
      <div className="field">
        Материал урока
        <RichEditor key={lesson.id} initialHtml={lesson.html} onChange={(html) => onChange((l) => ({ ...l, html }))} placeholder="Текст урока, изображения, таблицы" />
      </div>

      <div className="std-attach">
        <div className="std-attach-head">
          <span>Видео</span>
          <button type="button" className="link-btn" onClick={() => videoRef.current.click()}>
            Загрузить видео
          </button>
          <input
            ref={videoRef}
            type="file"
            accept="video/*"
            multiple
            hidden
            onChange={(e) => {
              const files = [...e.target.files];
              e.target.value = '';
              uploadVideos(files);
            }}
          />
        </div>
        {(lesson.videos ?? []).length > 0 ? (
          <ul className="std-files">
            {lesson.videos.map((v) => (
              <li key={v.id}>
                <span className="std-file-main">
                  <span className="file-badge std-file-badge" style={{ background: '#161616' }}>ВИДЕО</span>
                  <span className="std-file-name">{v.name}</span>
                </span>
                <button type="button" className="link-btn" onClick={() => set({ videos: lesson.videos.filter((x) => x.id !== v.id) })}>
                  Убрать
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="std-muted">{uploading ? 'Загружаем видео…' : 'Можно загрузить видео до 50 МБ или прикрепить видео из «Документов».'}</p>
        )}
        {uploading > 0 && (lesson.videos ?? []).length > 0 && <p className="std-muted">Загружаем видео…</p>}
        {error && <p className="form-error">{error}</p>}
      </div>

      <div className="std-attach">
        <div className="std-attach-head">
          <span>Файлы из «Документов»</span>
          <button type="button" className="link-btn" onClick={() => setPicker('docs')} disabled={!docs.some((n) => n.kind === 'file')}>
            {docs.some((n) => n.kind === 'file') ? 'Прикрепить' : 'В «Документах» пока нет файлов'}
          </button>
        </div>
        <Attachments ids={lesson.attachments ?? []} byId={docsById} onOpen={setViewId} onRemove={(id) => set({ attachments: lesson.attachments.filter((x) => x !== id) })} />
      </div>

      <div className="std-attach">
        <div className="std-attach-head">
          <span>Статьи из «Стандартов»</span>
          <button type="button" className="link-btn" onClick={() => setPicker('standards')} disabled={!articles.length}>
            {articles.length ? 'Прикрепить' : 'В «Стандартах» пока нет статей'}
          </button>
        </div>
        <StandardLinks
          ids={lesson.standards ?? []}
          articles={articles}
          categories={categories}
          onRemove={(id) => set({ standards: lesson.standards.filter((x) => x !== id) })}
        />
      </div>

      {picker === 'docs' && (
        <DocPicker
          nodes={docs}
          selected={(lesson.attachments ?? []).filter((id) => docsById[id])}
          onClose={() => setPicker(null)}
          onSave={(ids) => {
            const cur = lesson.attachments ?? [];
            set({ attachments: [...cur.filter((id) => ids.includes(id) || !docsById[id]), ...ids.filter((id) => !cur.includes(id))] });
            setPicker(null);
          }}
        />
      )}
      {picker === 'standards' && (
        <StandardPicker
          articles={articles}
          categories={categories}
          selected={lesson.standards ?? []}
          onClose={() => setPicker(null)}
          onSave={(ids) => {
            const cur = lesson.standards ?? [];
            set({ standards: [...cur.filter((id) => ids.includes(id)), ...ids.filter((id) => !cur.includes(id))] });
            setPicker(null);
          }}
        />
      )}
      {viewId && docsById[viewId] && <FileViewer node={docsById[viewId]} onClose={() => setViewId(null)} />}
    </div>
  );
}

function TestEditor({ test, onChange }) {
  const questions = test.questions;
  const setQ = (id, patch) => onChange({ ...test, questions: questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) });
  return (
    <div className="tr-test-edit">
      <label className="field tr-pass">
        Проходной балл, %
        <input type="number" min="1" max="100" inputMode="numeric" value={test.passScore} onChange={(e) => onChange({ ...test, passScore: e.target.value })} />
      </label>
      <ol className="tr-questions">
        {questions.map((q, qi) => (
          <li key={q.id} className="tr-question">
            <div className="tr-question-head">
              <span className="tr-question-num">Вопрос {qi + 1}</span>
              <button type="button" className="link-btn" disabled={qi === 0} onClick={() => onChange({ ...test, questions: move(questions, qi, -1) })}>↑</button>
              <button type="button" className="link-btn" disabled={qi === questions.length - 1} onClick={() => onChange({ ...test, questions: move(questions, qi, 1) })}>↓</button>
              <button type="button" className="link-btn" onClick={() => onChange({ ...test, questions: questions.filter((x) => x.id !== q.id) })}>Удалить</button>
            </div>
            <input className="std-input tr-q-text" placeholder="Текст вопроса" value={q.text} onChange={(e) => setQ(q.id, { text: e.target.value })} />
            <ul className="tr-options">
              {q.options.map((o) => (
                <li key={o.id}>
                  <label className="tr-correct" title="Верный ответ">
                    <input
                      type="checkbox"
                      checked={q.correct.includes(o.id)}
                      onChange={(e) => setQ(q.id, { correct: e.target.checked ? [...q.correct, o.id] : q.correct.filter((x) => x !== o.id) })}
                    />
                    верный
                  </label>
                  <input
                    className="std-input"
                    placeholder="Вариант ответа"
                    value={o.text}
                    onChange={(e) => setQ(q.id, { options: q.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })}
                  />
                  <button
                    type="button"
                    className="link-btn"
                    disabled={q.options.length <= 2}
                    onClick={() => setQ(q.id, { options: q.options.filter((x) => x.id !== o.id), correct: q.correct.filter((x) => x !== o.id) })}
                  >
                    Убрать
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="link-btn" onClick={() => setQ(q.id, { options: [...q.options, { id: uid('o'), text: '' }] })}>
              + Вариант
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-outline" onClick={() => onChange({ ...test, questions: [...questions, emptyQuestion()] })}>
        Добавить вопрос
      </button>
      <p className="field-note">Отметьте верные варианты. Если верных несколько, сотрудник должен выбрать их все. Ответы хранятся на сервере и сотрудникам не видны.</p>
    </div>
  );
}

export default function CourseEditor({ course, users, onSave, onDelete, onCancel }) {
  const [title, setTitle] = useState(course?.title ?? '');
  const [description, setDescription] = useState(course?.description ?? '');
  const [coverId, setCoverId] = useState(course?.coverId ?? null);
  const [lessons, setLessons] = useState(() => course?.lessons?.length ? course.lessons : [emptyLesson()]);
  const [openLesson, setOpenLesson] = useState(() => (course?.lessons?.length ? null : lessons[0].id));
  const [test, setTest] = useState(() =>
    course?.test ? { passScore: String(course.test.passScore ?? 80), questions: course.test.questions.map((q) => ({ ...q, correct: [] })) } : null,
  );
  const [keysLoaded, setKeysLoaded] = useState(!course?.test);
  const [assignees, setAssignees] = useState(course?.assignees ?? []);
  const [due, setDue] = useState(course?.due ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const coverRef = useRef(null);

  const [docsRaw] = useShared(DOCS_KEY, []);
  const docs = useMemo(() => docsRaw.filter((n) => n.kind === 'file' || n.kind === 'folder'), [docsRaw]);
  const docsById = useMemo(() => Object.fromEntries(docs.map((n) => [n.id, n])), [docs]);
  const [articles] = useShared(STANDARDS_KEY, []);
  const [categories] = useShared(STANDARD_CATEGORIES_KEY, DEFAULT_CATEGORIES);

  // Верные ответы приходят с сервера — только руководителю, только в редакторе.
  useEffect(() => {
    if (!course?.test) return;
    api(`/api/training/keys/${course.id}`)
      .then(({ keys }) => {
        setTest((t) => t && { ...t, questions: t.questions.map((q) => ({ ...q, correct: keys[q.id] ?? [] })) });
        setKeysLoaded(true);
      })
      .catch((err) => setError(`Не удалось загрузить ответы теста: ${err.message}`));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateLesson = (id, next) => setLessons((list) => list.map((l) => (l.id === id ? (typeof next === 'function' ? next(l) : next) : l)));

  const uploadCover = async (file) => {
    if (!file?.type.startsWith('image/')) return setError('Обложка должна быть изображением');
    setCoverBusy(true);
    try {
      const id = uid('cov');
      await putBlob(id, file);
      setCoverId(id);
    } catch (err) {
      setError(err.message || 'Не удалось загрузить обложку');
    }
    setCoverBusy(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!title.trim()) return setError('Укажите название курса');
    const cleanLessons = lessons.map((l) => ({ ...l, title: l.title.trim(), html: isEmptyHtml(l.html) ? '' : sanitizeHtml(l.html) }));
    const untitled = cleanLessons.findIndex((l) => !l.title);
    if (untitled >= 0) {
      setOpenLesson(cleanLessons[untitled].id);
      return setError(`Укажите название урока ${untitled + 1}`);
    }
    let cleanTest = null;
    const keys = {};
    if (test) {
      if (!keysLoaded) return setError('Ответы теста ещё загружаются');
      const pass = Number(test.passScore);
      if (!(pass >= 1 && pass <= 100)) return setError('Проходной балл — от 1 до 100%');
      if (!test.questions.length) return setError('Добавьте в тест хотя бы один вопрос или уберите тест');
      const questions = [];
      for (const [i, q] of test.questions.entries()) {
        const options = q.options.map((o) => ({ ...o, text: o.text.trim() })).filter((o) => o.text);
        const correct = q.correct.filter((id) => options.some((o) => o.id === id));
        if (!q.text.trim()) return setError(`Вопрос ${i + 1}: введите текст вопроса`);
        if (options.length < 2) return setError(`Вопрос ${i + 1}: нужно минимум два варианта ответа`);
        if (!correct.length) return setError(`Вопрос ${i + 1}: отметьте верный ответ`);
        questions.push({ id: q.id, text: q.text.trim(), options, multiple: correct.length > 1 });
        keys[q.id] = correct;
      }
      cleanTest = { passScore: pass, questions };
    }
    setBusy(true);
    try {
      await onSave(
        { title: title.trim(), description: description.trim(), coverId, lessons: cleanLessons, test: cleanTest, assignees, due: due || null },
        cleanTest ? keys : null,
      );
    } catch (err) {
      setError(err.message || 'Не удалось сохранить курс');
      setBusy(false);
    }
  };

  return (
    <form className="std-editor tr-editor" onSubmit={submit}>
      <div className="page-head">
        <div>
          <span className="rv-crumb">Обучение</span>
          <h1>{course ? 'Редактирование курса' : 'Новый курс'}</h1>
        </div>
      </div>

      <h2 className="tr-section-title">Основное</h2>
      <div className="std-panel std-form">
        <div className="tr-main-row">
          <div className="tr-main-fields">
            <label className="field">
              Название
              <input autoFocus={!course} value={title} placeholder="Например, Стажировка бариста" onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              Описание
              <textarea rows={3} value={description} placeholder="Чему научится сотрудник" onChange={(e) => setDescription(e.target.value)} />
            </label>
          </div>
          <div className="field tr-cover-field">
            Обложка
            <button type="button" className={`tr-cover-pick ${coverId ? 'has-cover' : ''}`} onClick={() => coverRef.current.click()} disabled={coverBusy}>
              {coverId ? <img src={`/api/files/${coverId}`} alt="" /> : <span>{coverBusy ? 'Загружаем…' : 'Загрузить изображение'}</span>}
            </button>
            {coverId && (
              <button type="button" className="link-btn" onClick={() => setCoverId(null)}>
                Убрать обложку
              </button>
            )}
            <input
              ref={coverRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files[0];
                e.target.value = '';
                if (f) uploadCover(f);
              }}
            />
          </div>
        </div>
      </div>

      <h2 className="tr-section-title">
        Уроки <span>{lessons.length}</span>
      </h2>
      <ol className="tr-lessons-edit">
        {lessons.map((l, i) => {
          const open = openLesson === l.id;
          const extras = [
            (l.videos ?? []).length && `${l.videos.length} видео`,
            (l.attachments ?? []).length && `${l.attachments.length} ${plural(l.attachments.length, ['файл', 'файла', 'файлов'])}`,
            (l.standards ?? []).length && `${l.standards.length} ${plural(l.standards.length, ['статья', 'статьи', 'статей'])}`,
          ].filter(Boolean);
          return (
            <li key={l.id} className={open ? 'is-open' : ''}>
              <div className="tr-lesson-row">
                <span className="tr-lesson-num">{i + 1}</span>
                <button type="button" className="tr-lesson-name" onClick={() => setOpenLesson(open ? null : l.id)}>
                  {l.title || 'Без названия'}
                  {extras.length > 0 && <small>{extras.join(' · ')}</small>}
                </button>
                <button type="button" className="link-btn" disabled={i === 0} onClick={() => setLessons((list) => move(list, i, -1))} aria-label="Выше">↑</button>
                <button type="button" className="link-btn" disabled={i === lessons.length - 1} onClick={() => setLessons((list) => move(list, i, 1))} aria-label="Ниже">↓</button>
                <button type="button" className="link-btn" onClick={() => setOpenLesson(open ? null : l.id)}>{open ? 'Свернуть' : 'Изменить'}</button>
                <button type="button" className="link-btn" disabled={lessons.length <= 1} onClick={() => setLessons((list) => list.filter((x) => x.id !== l.id))}>
                  Удалить
                </button>
              </div>
              {open && (
                <LessonEditor
                  lesson={l}
                  onChange={(next) => updateLesson(l.id, next)}
                  docs={docs}
                  docsById={docsById}
                  articles={articles}
                  categories={categories}
                />
              )}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="btn btn-outline tr-add"
        onClick={() => {
          const l = emptyLesson();
          setLessons((list) => [...list, l]);
          setOpenLesson(l.id);
        }}
      >
        Добавить урок
      </button>

      <h2 className="tr-section-title">Тест</h2>
      <div className="std-panel">
        {test ? (
          <>
            <TestEditor test={test} onChange={setTest} />
            <button type="button" className="link-btn tr-remove-test" onClick={() => setTest(null)}>
              Убрать тест из курса
            </button>
          </>
        ) : (
          <div className="tr-no-test">
            <p className="std-muted">Тест проходится после всех уроков. Курс засчитывается, когда набран проходной балл.</p>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setTest({ passScore: '80', questions: [emptyQuestion()] });
                setKeysLoaded(true);
              }}
            >
              Добавить тест
            </button>
          </div>
        )}
      </div>

      <h2 className="tr-section-title">
        Назначение <span>{assignees.length}</span>
      </h2>
      <div className="std-panel std-form">
        <label className="field tr-due">
          Пройти до
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        <AssigneePicker users={users} value={assignees} onChange={setAssignees} />
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="std-actions">
        {confirmDelete ? (
          <>
            <span className="std-confirm">Удалить курс вместе с результатами сотрудников? Вместо этого его можно отправить в архив.</span>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Нет</button>
            <button type="button" className="btn btn-danger" onClick={onDelete}>Удалить</button>
          </>
        ) : (
          <>
            {course && (
              <button type="button" className="btn btn-ghost btn-left" onClick={() => setConfirmDelete(true)}>
                Удалить
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Отмена</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
          </>
        )}
      </div>
    </form>
  );
}
