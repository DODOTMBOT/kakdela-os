import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { onRefresh } from '../users.js';
import { timeAgo } from '../notifications.js';
import { plural } from '../utils.js';

const PAGE = 20;
const LONG_TEXT = 420;
const avgFmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const RATINGS = [
  ['', 'Любая оценка'],
  ['neg', 'Негативные (1–3)'],
  ['5', '5'],
  ['4', '4'],
  ['3', '3'],
  ['2', '2'],
  ['1', '1'],
];
const PERIODS = [
  ['', 'За всё время'],
  ['7', 'За 7 дней'],
  ['30', 'За 30 дней'],
  ['90', 'За 3 месяца'],
  ['custom', 'Свой период'],
];
const SORTS = [
  ['new', 'Сначала новые'],
  ['old', 'Сначала старые'],
  ['low', 'Сначала низкие'],
  ['high', 'Сначала высокие'],
];

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const daysAgoIso = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const tone = (r) => (r == null ? '' : r >= 4 ? 'is-good' : r >= 3 ? 'is-mid' : 'is-bad');

function average(list) {
  const rated = list.filter((r) => typeof r.rating === 'number');
  return rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : null;
}

function ReviewRow({ r, platform }) {
  const [full, setFull] = useState(false);
  const long = (r.text || '').length > LONG_TEXT || (r.text || '').split('\n').length > 6;
  return (
    <li className="rv">
      <div className={`rv-score ${tone(r.rating)}`} title={r.ratingOriginal ? `Оценка на площадке: ${r.ratingOriginal}` : undefined}>
        {r.rating == null ? '—' : Math.round(r.rating)}
      </div>
      <div className="rv-body">
        <div className="rv-meta">
          <b>{r.author || 'Аноним'}</b>
          <span>{platform}</span>
          <span>{fmtDate(r.date)}</span>
          {r.url && (
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="rv-ext">
              на площадке ↗
            </a>
          )}
        </div>
        {r.text ? (
          <>
            <p className={`rv-text ${long && !full ? 'is-clamped' : ''}`}>{r.text}</p>
            {long && (
              <button className="rv-toggle" onClick={() => setFull((v) => !v)}>
                {full ? 'Свернуть' : 'Читать полностью'}
              </button>
            )}
          </>
        ) : (
          <p className="rv-text is-empty">Оценка без текста</p>
        )}
        {r.images.length > 0 && (
          <div className="rv-photos">
            {r.images.map((img, i) => (
              <a key={i} href={img.image} target="_blank" rel="noopener noreferrer" aria-label={`Фото ${i + 1}`}>
                <img src={img.preview || img.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
              </a>
            ))}
          </div>
        )}
        {r.replyText ? (
          <div className="rv-reply">
            <div className="rv-reply-head">Ответ заведения{r.replyDate && ` · ${fmtDate(r.replyDate)}`}</div>
            <p>{r.replyText}</p>
          </div>
        ) : (
          <div className="rv-noreply">Без ответа</div>
        )}
      </div>
    </li>
  );
}

export default function ReviewsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [link, setLink] = useState(null);
  const [query, setQuery] = useState('');
  const [rating, setRating] = useState('');
  const [period, setPeriod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('new');
  const [withPhotos, setWithPhotos] = useState(false);
  const [noReply, setNoReply] = useState(false);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    const load = () => api('/api/reviews').then(setData, (err) => setError(err.message));
    load();
    return onRefresh(load, 60_000);
  }, []);

  const syncNow = async () => {
    setSyncing(true);
    setError('');
    try {
      setData(await api('/api/reviews/sync', { method: 'POST' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const links = data?.links ?? [];
  const nameOf = useMemo(() => Object.fromEntries(links.map((l) => [l.id, l.name])), [links]);
  const all = data?.reviews ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const since = period === 'custom' ? from : period ? daysAgoIso(Number(period)) : '';
    const until = period === 'custom' ? to : '';
    const list = all.filter((r) => {
      if (link && r.linkId !== link) return false;
      const score = Math.round(r.rating ?? 0);
      if (rating === 'neg' && !(score >= 1 && score <= 3)) return false;
      if (rating && rating !== 'neg' && score !== Number(rating)) return false;
      const day = (r.date || '').slice(0, 10);
      if (since && day < since) return false;
      if (until && day > until) return false;
      if (withPhotos && !r.images.length) return false;
      if (noReply && r.replyText) return false;
      if (q && !`${r.text ?? ''} ${r.replyText ?? ''} ${r.author ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const byDate = (a, b) => (a.date || '').localeCompare(b.date || '');
    const sorters = {
      new: (a, b) => byDate(b, a),
      old: byDate,
      low: (a, b) => (a.rating ?? 9) - (b.rating ?? 9) || byDate(b, a),
      high: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byDate(b, a),
    };
    return list.sort(sorters[sort]);
  }, [all, link, query, rating, period, from, to, sort, withPhotos, noReply]);

  useEffect(() => setShown(PAGE), [link, query, rating, period, from, to, sort, withPhotos, noReply]);

  const active = Boolean(query || rating || period || withPhotos || noReply);
  const reset = () => {
    setQuery('');
    setRating('');
    setPeriod('');
    setFrom('');
    setTo('');
    setWithPhotos(false);
    setNoReply(false);
  };

  const scope = link ? all.filter((r) => r.linkId === link) : all;
  const unanswered = scope.filter((r) => !r.replyText).length;
  const limits = links.filter((l) => l.access?.message);

  return (
    <div className="rv-page">
      <div className="page-head">
        <div>
          <span className="rv-crumb">Контроль качества</span>
          <h1>Отзывы</h1>
        </div>
        <div className="rv-sync">
          {data?.lastSyncAt && <span>Обновлено {timeAgo(data.lastSyncAt)}</span>}
          <button className="link-btn" onClick={syncNow} disabled={syncing || !data}>
            {syncing ? 'Обновляем…' : 'Обновить'}
          </button>
        </div>
      </div>

      {error && <p className="docs-error">{error}</p>}
      {data && !data.configured && <p className="docs-error">Не задан ключ Rewio на сервере — отзывы не загружаются</p>}
      {data?.lastError && data.configured && <p className="docs-error">Последняя загрузка с ошибкой: {data.lastError}</p>}

      {!data ? (
        <p className="sync-loading">Загружаем отзывы…</p>
      ) : (
        <>
          {/* Сводка по загруженным отзывам — не официальный рейтинг площадок. */}
          <section className="rv-summary">
            {[...links.map((l) => ({ key: l.id, name: l.name, list: all.filter((r) => r.linkId === l.id) })), { key: 'all', name: 'Всего', list: all }].map(
              ({ key, name, list }) => {
                const avg = average(list);
                return (
                  <div key={key} className="rv-sum">
                    <span>{name}</span>
                    <b>{avg == null ? '—' : avgFmt.format(avg)}</b>
                    <small>
                      {list.length} {plural(list.length, ['отзыв', 'отзыва', 'отзывов'])}
                    </small>
                  </div>
                );
              },
            )}
            <div className="rv-sum">
              <span>Без ответа</span>
              <b className={all.some((r) => !r.replyText) ? 'is-alert' : ''}>{all.filter((r) => !r.replyText).length}</b>
              <small>требуют ответа</small>
            </div>
          </section>
          <p className="rv-footnote">
            Средняя — по отзывам, загруженным в систему, а не официальный рейтинг площадки.
            {limits.map((l) => ` ${l.name}: пробный доступ — видны ${l.access.limit_per_link} последних, ещё ${l.access.hidden_total} откроются после оплаты.`)}
          </p>

          <div className="tabs menu-tabs rv-tabs" role="tablist" aria-label="Площадки">
            {[{ id: null, name: 'Все' }, ...links].map((l) => (
              <button key={l.id ?? 'all'} role="tab" aria-selected={link === l.id} className={link === l.id ? 'is-active' : ''} onClick={() => setLink(l.id)}>
                {l.name}
                <span>{l.id ? all.filter((r) => r.linkId === l.id).length : all.length}</span>
              </button>
            ))}
          </div>

          <div className="rv-toolbar">
            <input
              className="rv-search"
              type="search"
              placeholder="Поиск по тексту, ответу или автору"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Поиск по отзывам"
            />
            <select value={rating} onChange={(e) => setRating(e.target.value)} aria-label="Оценка">
              {RATINGS.map(([v, l]) => (
                <option key={v} value={v}>{v && v !== 'neg' ? `Оценка ${l}` : l}</option>
              ))}
            </select>
            <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Период">
              {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {period === 'custom' && (
              <span className="rv-range">
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="С даты" />
                <span>—</span>
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="По дату" />
              </span>
            )}
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Сортировка">
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label className={`rv-check ${withPhotos ? 'is-on' : ''}`}>
              <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />С фото
            </label>
            <label className={`rv-check ${noReply ? 'is-on' : ''}`}>
              <input type="checkbox" checked={noReply} onChange={(e) => setNoReply(e.target.checked)} />
              Без ответа
              <span>{unanswered}</span>
            </label>
          </div>

          <div className="rv-result">
            <span>
              Найдено {filtered.length} {plural(filtered.length, ['отзыв', 'отзыва', 'отзывов'])}
            </span>
            {active && (
              <button className="link-btn" onClick={reset}>
                Сбросить фильтры
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="menu-empty">
              <p>{all.length ? 'Ничего не найдено' : 'Отзывов пока нет'}</p>
              <span>{all.length ? 'Измените фильтры или сбросьте их' : 'Первая загрузка идёт автоматически после запуска сервера'}</span>
            </div>
          ) : (
            <>
              <ul className="rvs">
                {filtered.slice(0, shown).map((r) => (
                  <ReviewRow key={r.id} r={r} platform={nameOf[r.linkId] ?? r.source} />
                ))}
              </ul>
              {filtered.length > shown && (
                <button className="btn btn-outline rv-more" onClick={() => setShown((n) => n + PAGE)}>
                  Показать ещё {Math.min(PAGE, filtered.length - shown)}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
