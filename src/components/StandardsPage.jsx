import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShared } from '../sync.js';
import { useEscape } from './Popover.jsx';
import { IconClose } from './Icons.jsx';
import FileViewer from './FileViewer.jsx';
import RichEditor from './RichEditor.jsx';
import { Attachments, DocPicker } from './DocAttach.jsx';
import { plural } from '../utils.js';
import {
  DEFAULT_CATEGORIES,
  DOCS_KEY,
  STANDARDS_KEY,
  STANDARD_CATEGORIES_KEY,
  canEditStandards,
  categoryTone,
  fmtUpdated,
  isEmptyHtml,
  plainText,
  sanitizeHtml,
  uid,
} from '../standards.js';

const BASE = '/standards';
const NO_CATEGORY = 'none';

// Адрес внутри раздела: /standards, /standards/new, /standards/:id, /standards/:id/edit.
function routeFromLocation() {
  const parts = window.location.pathname.replace(/\/+$/, '').split('/').slice(2);
  if (parts[0] === 'new') return { mode: 'edit', id: null };
  if (parts[0] && parts[1] === 'edit') return { mode: 'edit', id: decodeURIComponent(parts[0]) };
  if (parts[0]) return { mode: 'view', id: decodeURIComponent(parts[0]) };
  return { mode: 'list' };
}
const pathOf = (r) => (r.mode === 'list' ? BASE : r.mode === 'edit' ? (r.id ? `${BASE}/${r.id}/edit` : `${BASE}/new`) : `${BASE}/${r.id}`);

// ---------- Категории ----------

function CategoriesModal({ categories, counts, onSave, onClose }) {
  const [list, setList] = useState(categories);
  const [fresh, setFresh] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState('');
  useEscape(onClose);

  const add = () => {
    const name = fresh.trim();
    if (!name) return;
    if (list.some((c) => c.name.toLowerCase() === name.toLowerCase())) return setError('Такая категория уже есть');
    setList((l) => [...l, { id: uid('sc'), name }]);
    setFresh('');
    setError('');
  };

  const save = () => {
    const cleaned = list.map((c) => ({ ...c, name: c.name.trim() }));
    if (cleaned.some((c) => !c.name)) return setError('У категории должно быть название');
    onSave(cleaned);
  };

  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Категории">
        <header className="modal-head">
          <h2>Категории</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconClose size={18} />
          </button>
        </header>
        <ul className="std-cats">
          {list.map((c, i) => (
            <li key={c.id}>
              <input
                className="std-input"
                value={c.name}
                aria-label="Название категории"
                onChange={(e) => setList((l) => l.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))}
              />
              <span className="std-cats-count">{counts[c.id] ?? 0}</span>
              <button type="button" className="link-btn" disabled={i === 0} onClick={() => setList((l) => [...l.slice(0, i - 1), l[i], l[i - 1], ...l.slice(i + 1)])} aria-label="Выше">
                ↑
              </button>
              {confirm === c.id ? (
                <button type="button" className="link-btn std-danger" onClick={() => setList((l) => l.filter((x) => x.id !== c.id))}>
                  Точно удалить?
                </button>
              ) : (
                <button type="button" className="link-btn" onClick={() => setConfirm(c.id)}>
                  Удалить
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="std-cats-add">
          <input
            className="std-input"
            placeholder="Новая категория"
            value={fresh}
            onChange={(e) => setFresh(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          />
          <button type="button" className="btn btn-outline" onClick={add}>Добавить</button>
        </div>
        <p className="field-note">Статьи удалённой категории останутся в разделе «Без категории».</p>
        {error && <p className="form-error">{error}</p>}
        <footer className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" onClick={save}>Сохранить</button>
        </footer>
      </div>
    </div>
  );
}

// ---------- Редактор статьи ----------

function ArticleEditor({ article, categories, docs, docsById, defaultCategory, onSave, onDelete, onCancel }) {
  const [title, setTitle] = useState(article?.title ?? '');
  const [description, setDescription] = useState(article?.description ?? '');
  const [categoryId, setCategoryId] = useState(article?.categoryId ?? defaultCategory ?? categories[0]?.id ?? '');
  const [html, setHtml] = useState(article?.html ?? '');
  const [attachments, setAttachments] = useState(article?.attachments ?? []);
  const [picker, setPicker] = useState(false);
  const [viewId, setViewId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) return setError('Укажите название статьи');
    onSave({
      title: title.trim(),
      description: description.trim(),
      categoryId: categoryId || null,
      html: isEmptyHtml(html) ? '' : sanitizeHtml(html),
      attachments,
    });
  };

  return (
    <form className="std-editor" onSubmit={submit}>
      <div className="page-head">
        <div>
          <span className="rv-crumb">Стандарты</span>
          <h1>{article ? 'Редактирование статьи' : 'Новая статья'}</h1>
        </div>
      </div>

      <div className="std-panel std-form">
        <label className="field">
          Название
          <input autoFocus={!article} value={title} placeholder="Например, Приготовление капучино" onChange={(e) => (setTitle(e.target.value), setError(''))} />
        </label>
        <div className="std-form-row">
          <label className="field">
            Краткое описание
            <input value={description} placeholder="О чём статья — одной строкой" onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="field">
            Категория
            <select value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Без категории</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="field">
          Содержимое
          <RichEditor initialHtml={article?.html ?? ''} onChange={setHtml} />
        </div>

        <div className="std-attach">
          <div className="std-attach-head">
            <span>Файлы из «Документов»</span>
            <button type="button" className="link-btn" onClick={() => setPicker(true)} disabled={!docs.some((n) => n.kind === 'file')}>
              {docs.some((n) => n.kind === 'file') ? 'Прикрепить' : 'В «Документах» пока нет файлов'}
            </button>
          </div>
          {attachments.length ? (
            <Attachments ids={attachments} byId={docsById} onOpen={setViewId} onRemove={(id) => setAttachments((a) => a.filter((x) => x !== id))} />
          ) : (
            <p className="std-muted">Файлы не копируются — статья ссылается на них в разделе «Документы».</p>
          )}
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="std-actions">
        {confirmDelete ? (
          <>
            <span className="std-confirm">Удалить статью без возможности восстановления?</span>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Нет</button>
            <button type="button" className="btn btn-danger" onClick={onDelete}>Удалить</button>
          </>
        ) : (
          <>
            {article && (
              <button type="button" className="btn btn-ghost btn-left" onClick={() => setConfirmDelete(true)}>
                Удалить
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Отмена</button>
            <button type="submit" className="btn btn-primary">Сохранить</button>
          </>
        )}
      </div>

      {picker && (
        <DocPicker
          nodes={docs}
          selected={attachments.filter((id) => docsById[id])}
          onClose={() => setPicker(false)}
          onSave={(ids) => {
            // Порядок: уже прикреплённые остаются на своих местах, новые — в конец.
            setAttachments((a) => [...a.filter((id) => ids.includes(id) || !docsById[id]), ...ids.filter((id) => !a.includes(id))]);
            setPicker(false);
          }}
        />
      )}
      {viewId && docsById[viewId] && <FileViewer node={docsById[viewId]} onClose={() => setViewId(null)} />}
    </form>
  );
}

// ---------- Раздел ----------

export default function StandardsPage({ user }) {
  const [articles, setArticles] = useShared(STANDARDS_KEY, []);
  const [categories, setCategories] = useShared(STANDARD_CATEGORIES_KEY, DEFAULT_CATEGORIES);
  const [docsRaw] = useShared(DOCS_KEY, []);
  const docs = useMemo(() => docsRaw.filter((n) => n.kind === 'file' || n.kind === 'folder'), [docsRaw]);
  const docsById = useMemo(() => Object.fromEntries(docs.map((n) => [n.id, n])), [docs]);
  const canEdit = canEditStandards(user);

  const [route, setRoute] = useState(routeFromLocation);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [catsOpen, setCatsOpen] = useState(false);
  const [viewId, setViewId] = useState(null);

  // Назад/вперёд в браузере и повторный клик по разделу в меню.
  useEffect(() => {
    const sync = () => setRoute(routeFromLocation());
    window.addEventListener('popstate', sync);
    window.addEventListener('kd:navigate', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('kd:navigate', sync);
    };
  }, []);

  // replace — заменить текущий адрес (после сохранения «назад» ведёт не в редактор, а к прежней странице).
  const go = useCallback((r, { replace = false } = {}) => {
    const path = pathOf(r);
    if (window.location.pathname !== path) window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
    setRoute(r);
    window.scrollTo(0, 0);
  }, []);

  const catById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  const catOf = (a) => (a.categoryId && catById[a.categoryId] ? a.categoryId : NO_CATEGORY);

  const counts = useMemo(() => {
    const c = {};
    for (const a of articles) c[catOf(a)] = (c[catOf(a)] ?? 0) + 1;
    return c;
  }, [articles, catById]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchIndex = useMemo(
    () => Object.fromEntries(articles.map((a) => [a.id, `${a.title} ${a.description ?? ''} ${plainText(a.html)}`.toLowerCase()])),
    [articles],
  );

  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return articles
      .filter((a) => category === 'all' || catOf(a) === category)
      .filter((a) => words.every((w) => searchIndex[a.id]?.includes(w)))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }, [articles, category, query, searchIndex, catById]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (id, data) => {
    const now = new Date().toISOString();
    const by = { updatedAt: now, updatedById: user.id, updatedByName: user.name };
    if (id) {
      setArticles((list) => list.map((a) => (a.id === id ? { ...a, ...data, ...by, revision: (a.revision ?? 1) + 1 } : a)));
      go({ mode: 'view', id }, { replace: true });
    } else {
      const fresh = { id: uid('st'), ...data, revision: 1, createdAt: now, createdById: user.id, createdByName: user.name, ...by };
      setArticles((list) => [...list, fresh]);
      go({ mode: 'view', id: fresh.id }, { replace: true });
    }
  };

  const remove = (id) => {
    setArticles((list) => list.filter((a) => a.id !== id));
    go({ mode: 'list' }, { replace: true });
  };

  // ----- Редактирование -----
  if (route.mode === 'edit' && canEdit) {
    const article = route.id ? articles.find((a) => a.id === route.id) : null;
    if (route.id && !article) return <Missing onBack={() => go({ mode: 'list' })} />;
    return (
      <ArticleEditor
        key={route.id ?? 'new'}
        article={article}
        categories={categories}
        docs={docs}
        docsById={docsById}
        defaultCategory={category !== 'all' && category !== NO_CATEGORY ? category : undefined}
        onSave={(data) => save(route.id, data)}
        onDelete={() => remove(route.id)}
        onCancel={() => go(route.id ? { mode: 'view', id: route.id } : { mode: 'list' }, { replace: true })}
      />
    );
  }

  // ----- Статья -----
  if (route.mode === 'view' || route.mode === 'edit') {
    const a = articles.find((x) => x.id === route.id);
    if (!a) return <Missing onBack={() => go({ mode: 'list' })} />;
    const cat = catById[a.categoryId];
    return (
      <article className="std-article">
        <nav className="crumbs std-crumbs" aria-label="Путь">
          <span className="crumb-wrap">
            <button className="crumb" onClick={() => go({ mode: 'list' })}>Стандарты</button>
            <span className="crumb-sep">/</span>
          </span>
          <span className="crumb-wrap">
            <button
              className="crumb"
              onClick={() => {
                setCategory(cat ? cat.id : NO_CATEGORY);
                go({ mode: 'list' });
              }}
            >
              {cat?.name ?? 'Без категории'}
            </button>
          </span>
        </nav>
        <div className="page-head std-head">
          <h1>
            <CategoryBadge categories={categories} id={cat ? cat.id : null} name={cat?.name} />
            {a.title}
          </h1>
          {canEdit && (
            <button className="btn btn-outline" onClick={() => go({ mode: 'edit', id: a.id })}>
              Редактировать
            </button>
          )}
        </div>
        {a.description && <p className="std-desc">{a.description}</p>}
        <p className="std-meta">
          Обновлено {fmtUpdated(a.updatedAt)}
          {a.updatedByName && ` · ${a.updatedByName}`}
        </p>

        {a.attachments?.length > 0 && (
          <section className="std-attach is-view">
            <h2 className="std-attach-title">Файлы</h2>
            <Attachments ids={a.attachments} byId={docsById} onOpen={setViewId} />
          </section>
        )}
        <div className="std-panel">
          {a.html ? (
            <div className="std-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(a.html) }} />
          ) : (
            <p className="std-muted">Текст статьи пока не добавлен.</p>
          )}
        </div>

        {viewId && docsById[viewId] && <FileViewer node={docsById[viewId]} onClose={() => setViewId(null)} />}
      </article>
    );
  }

  // ----- Список -----
  const tabs = [
    { id: 'all', name: 'Все', count: articles.length },
    ...categories.map((c) => ({ id: c.id, name: c.name, count: counts[c.id] ?? 0 })),
    ...(counts[NO_CATEGORY] ? [{ id: NO_CATEGORY, name: 'Без категории', count: counts[NO_CATEGORY] }] : []),
  ];

  return (
    <>
      <div className="page-head">
        <h1>Стандарты</h1>
        {canEdit && (
          <div className="docs-actions">
            <button className="btn btn-outline" onClick={() => setCatsOpen(true)}>Категории</button>
            <button className="btn btn-primary" onClick={() => go({ mode: 'edit', id: null })}>Новая статья</button>
          </div>
        )}
      </div>

      <div className="tabs menu-tabs std-tabs" role="tablist" aria-label="Категории">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={category === t.id} className={category === t.id ? 'is-active' : ''} onClick={() => setCategory(t.id)}>
            {t.name}
            <span>{t.count}</span>
          </button>
        ))}
      </div>

      <input
        className="std-input std-search"
        type="search"
        placeholder="Поиск по названию, описанию и тексту статей"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Поиск по статьям"
      />

      {filtered.length === 0 ? (
        <div className="menu-empty">
          <p>{articles.length ? 'Ничего не найдено' : 'Статей пока нет'}</p>
          <span>
            {articles.length
              ? 'Измените запрос или выберите другую категорию'
              : canEdit
                ? 'Создайте первую статью — стандарт, инструкцию или регламент'
                : 'Здесь появятся стандарты и инструкции, когда их добавят руководители'}
          </span>
        </div>
      ) : (
        <ul className="std-list">
          {filtered.map((a) => (
            <li key={a.id}>
              <button className="std-row" onClick={() => go({ mode: 'view', id: a.id })}>
                <span className="std-row-main">
                  <span className="std-row-title">
                    <CategoryBadge categories={categories} id={catOf(a) === NO_CATEGORY ? null : a.categoryId} name={catById[a.categoryId]?.name} />
                    {a.title}
                  </span>
                  {a.description && <span className="std-row-desc">{a.description}</span>}
                </span>
                <span className="std-row-meta">
                  {a.attachments?.length > 0 && <span>{a.attachments.length} {plural(a.attachments.length, ['файл', 'файла', 'файлов'])}</span>}
                  <span>{fmtUpdated(a.updatedAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {catsOpen && (
        <CategoriesModal
          categories={categories}
          counts={counts}
          onClose={() => setCatsOpen(false)}
          onSave={(list) => {
            setCategories(list);
            if (category !== 'all' && category !== NO_CATEGORY && !list.some((c) => c.id === category)) setCategory('all');
            setCatsOpen(false);
          }}
        />
      )}
    </>
  );
}

function Missing({ onBack }) {
  return (
    <div className="menu-empty std-missing">
      <p>Статья не найдена</p>
      <span>Возможно, её удалили</span>
      <button className="link-btn" onClick={onBack}>К списку стандартов</button>
    </div>
  );
}

function CategoryBadge({ categories, id, name }) {
  return (
    <span className="std-badge" style={categoryTone(categories, id)}>
      {name ?? 'Без категории'}
    </span>
  );
}
