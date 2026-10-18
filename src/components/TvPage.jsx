import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { putBlob } from '../fileStore.js';
import { useShared } from '../sync.js';
import { onRefresh } from '../users.js';
import { plural } from '../utils.js';
import { useEscape } from './Popover.jsx';
import { IconClose } from './Icons.jsx';
import { DocPicker } from './DocAttach.jsx';
import { MENUS_KEY, normalizeMenus } from '../menus.js';
import { FONTS, PRESETS, PlaylistPlayer, SLIDE_TYPES, SlidePreview, activePlaylistId, resolveStyle } from '../tv/slides.jsx';

// Управление ТВ: экраны меню-бордов и что на них показывается.
// Экран подключается кодом, который телевизор показывает по адресу /tv, — ссылки с ключами не нужны.

const ROTATIONS = [
  [0, 'Без поворота'],
  [90, 'На 90° (вертикально)'],
  [270, 'На 270° (вертикально)'],
  [180, 'На 180°'],
];
const DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const filesUrl = (id) => `/api/files/${id}`;
const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const ago = (iso) => {
  if (!iso) return 'ещё не выходил на связь';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'был на связи только что';
  if (min < 60) return `был на связи ${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `был на связи ${h} ч назад`;
  return `был на связи ${new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
};
const totalSec = (items) => items.reduce((s, i) => s + (i.type === 'video' && i.untilEnd !== false ? 0 : i.duration ?? 10), 0);
const fmtSec = (s) => (s >= 60 ? `${Math.floor(s / 60)} мин${s % 60 ? ` ${s % 60} с` : ''}` : `${s} с`);

function Modal({ title, children, onClose, wide = false }) {
  useEscape(onClose);
  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'tv-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconClose size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

// ---------- Подключение экрана ----------

function PairModal({ onDone, onClose }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onDone(await api('/api/tv/admin/screens', { method: 'POST', body: { code, name, location } }));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  return (
    <Modal title="Подключить экран" onClose={onClose}>
      <form className="tv-form" onSubmit={submit}>
        <ol className="tv-steps">
          <li>
            На телевизоре откройте в браузере <b>{window.location.host}/tv</b> — появится код из шести цифр.
          </li>
          <li>Введите код и назовите экран — он подключится сам и сразу начнёт показ.</li>
        </ol>
        <label className="field">
          Код с экрана
          <input
            autoFocus
            className="tv-code-input"
            inputMode="numeric"
            placeholder="000 000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 7))}
          />
        </label>
        <div className="grid-2">
          <label className="field">
            Название
            <input placeholder="Например, Над баром" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Где стоит
            <input placeholder="Например, Зал, у кассы" value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={busy || code.replace(/\D/g, '').length !== 6 || !name.trim()}>
            {busy ? 'Подключаем…' : 'Подключить'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

// ---------- Настройки экрана ----------

function ScreenModal({ screen, playlists, onSave, onRemove, onClose }) {
  const [name, setName] = useState(screen.name);
  const [location, setLocation] = useState(screen.location);
  const [rotation, setRotation] = useState(screen.rotation);
  const [defaultPlaylist, setDefault] = useState(screen.defaultPlaylist ?? '');
  const [schedule, setSchedule] = useState(screen.schedule ?? []);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const setRule = (id, patch) => setSchedule((l) => l.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const submit = async (e) => {
    e.preventDefault();
    try {
      await onSave({ name, location, rotation, defaultPlaylist: defaultPlaylist || null, schedule });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title={screen.name} onClose={onClose} wide>
      <form className="tv-form" onSubmit={submit}>
        <div className="grid-2">
          <label className="field">
            Название
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Где стоит
            <input value={location} onChange={(e) => setLocation(e.target.value)} />
          </label>
        </div>
        <div className="grid-2">
          <label className="field">
            Основной плейлист
            <select value={defaultPlaylist} onChange={(e) => setDefault(e.target.value)}>
              <option value="">Не показывать ничего</option>
              {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">
            Поворот изображения
            <select value={rotation} onChange={(e) => setRotation(Number(e.target.value))}>
              {ROTATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>

        <div className="field">
          Расписание
          <p className="field-note tv-note">В указанные часы вместо основного показывается другой плейлист — например, завтраки до 12:00.</p>
          {schedule.map((r) => (
            <div key={r.id} className="tv-rule">
              <select className="std-input" value={r.playlistId} onChange={(e) => setRule(r.id, { playlistId: e.target.value })} aria-label="Плейлист">
                {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input className="std-input" type="time" value={r.from} onChange={(e) => setRule(r.id, { from: e.target.value })} aria-label="С" />
              <span>—</span>
              <input className="std-input" type="time" value={r.to} onChange={(e) => setRule(r.id, { to: e.target.value })} aria-label="До" />
              <div className="tv-days">
                {DAY_ORDER.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={r.days.includes(d) ? 'is-on' : ''}
                    onClick={() => setRule(r.id, { days: r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d] })}
                  >
                    {DAYS[d]}
                  </button>
                ))}
              </div>
              <button type="button" className="link-btn" onClick={() => setSchedule((l) => l.filter((x) => x.id !== r.id))} aria-label="Убрать правило">
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="link-btn tv-add-rule"
            disabled={!playlists.length}
            onClick={() => setSchedule((l) => [...l, { id: uid('r'), playlistId: playlists[0].id, from: '08:00', to: '12:00', days: [0, 1, 2, 3, 4, 5, 6] }])}
          >
            {playlists.length ? '+ Правило' : 'Сначала создайте плейлист'}
          </button>
        </div>

        {error && <p className="form-error">{error}</p>}
        {confirm ? (
          <footer className="modal-foot modal-confirm">
            <span>Отключить экран? Он перестанет показывать контент и снова выведет код подключения.</span>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>Нет</button>
            <button type="button" className="btn btn-danger" onClick={onRemove}>Отключить</button>
          </footer>
        ) : (
          <footer className="modal-foot">
            <button type="button" className="btn btn-ghost btn-left" onClick={() => setConfirm(true)}>Отключить экран</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
            <button type="submit" className="btn btn-primary">Сохранить</button>
          </footer>
        )}
      </form>
    </Modal>
  );
}

// ---------- Редактор плейлиста ----------

function TextSlideModal({ item, onSave, onClose }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [text, setText] = useState(item?.text ?? '');
  return (
    <Modal title="Текстовый слайд" onClose={onClose}>
      <form className="tv-form" onSubmit={(e) => (e.preventDefault(), (title.trim() || text.trim()) && onSave({ title: title.trim(), text: text.trim() }))}>
        <label className="field">
          Заголовок
          <input autoFocus value={title} placeholder="Например, Тыквенный латте вернулся" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          Текст
          <textarea rows={3} value={text} placeholder="Например, только до конца ноября" onChange={(e) => setText(e.target.value)} />
        </label>
        <footer className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={!title.trim() && !text.trim()}>Готово</button>
        </footer>
      </form>
    </Modal>
  );
}

// Оформление слайда с меню или текстом: готовый стиль, свои цвета, фото на фоне, шрифт, раскладка.
function StyleModal({ item, menus, menuCount, onSave, onApplyAll, onClose }) {
  const [style, setStyle] = useState(() => ({ preset: 'classic', ...(item.style ?? {}) }));
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const st = resolveStyle(style);
  const set = (patch) => setStyle((x) => ({ ...x, ...patch }));
  // Готовый стиль сбрасывает свои цвета — остальное (фон, шрифт, раскладка) остаётся.
  const pickPreset = (key) => setStyle((x) => ({ ...x, preset: key, bg: undefined, fg: undefined, accent: undefined }));

  const upload = async (file) => {
    if (!file?.type.startsWith('image/')) return setError('Для фона нужна картинка');
    setUploading(true);
    try {
      const id = uid('bg');
      await putBlob(id, file);
      set({ bgImageId: id, overlay: style.overlay ?? 55 });
    } catch (err) {
      setError(err.message || 'Не удалось загрузить фон');
    }
    setUploading(false);
  };

  const preview = { ...item, style, duration: 10 };
  return (
    <Modal title="Оформление слайда" onClose={onClose} wide>
      <div className="tv-style">
        <div className="tv-style-form">
          <div className="field">
            Готовый стиль
            <div className="tv-presets">
              {Object.entries(PRESETS).map(([key, p]) => (
                <button key={key} type="button" className={`tv-preset ${style.preset === key ? 'is-on' : ''}`} onClick={() => pickPreset(key)}>
                  <i style={{ background: `linear-gradient(135deg, ${p.bg} 55%, ${p.accent} 55%)` }} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            Свои цвета
            <div className="tv-colors">
              {[
                ['bg', 'Фон'],
                ['fg', 'Текст'],
                ['accent', 'Акцент'],
              ].map(([key, label]) => (
                <label key={key} className="tv-color">
                  <input type="color" value={st[key]} onChange={(e) => set({ [key]: e.target.value })} />
                  {label}
                </label>
              ))}
            </div>
            <p className="field-note tv-note">Акцент — цвет цен и заголовков разделов.</p>
          </div>

          <div className="field">
            Фото на фоне
            {style.bgImageId ? (
              <div className="tv-bgimg">
                <img src={filesUrl(style.bgImageId)} alt="" />
                <span>Затемнение</span>
                <input type="range" min="0" max="90" step="5" value={style.overlay ?? 55} onChange={(e) => set({ overlay: Number(e.target.value) })} aria-label="Затемнение фона" />
                <span>{style.overlay ?? 55}%</span>
                <button type="button" className="link-btn" onClick={() => set({ bgImageId: undefined })}>Убрать</button>
              </div>
            ) : (
              <div className="tv-bgimg">
                <button type="button" className="btn btn-outline" disabled={uploading} onClick={() => fileRef.current.click()}>
                  {uploading ? 'Загружаем…' : 'Загрузить фото'}
                </button>
                <span>Фото заливается цветом фона — так текст остаётся читаемым.</span>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => (upload(e.target.files[0]), (e.target.value = ''))} />
          </div>

          <div className="grid-2">
            <label className="field">
              Шрифт
              <select value={style.font ?? 'sans'} onChange={(e) => set({ font: e.target.value })}>
                {Object.entries(FONTS).map(([key, f]) => <option key={key} value={key}>{f.label}</option>)}
              </select>
            </label>
            <label className="field">
              Выравнивание
              <select value={style.align ?? 'left'} onChange={(e) => set({ align: e.target.value })}>
                <option value="left">По левому краю</option>
                <option value="center">По центру</option>
              </select>
            </label>
          </div>

          {item.type === 'menu' && (
            <div className="grid-2">
              <label className="field">
                Колонки
                <select value={style.columns ?? 0} onChange={(e) => set({ columns: Number(e.target.value) })}>
                  <option value={0}>Автоматически</option>
                  <option value={1}>Одна</option>
                  <option value={2}>Две</option>
                  <option value={3}>Три</option>
                </select>
              </label>
              <label className="field">
                Заголовок
                <input value={style.title ?? ''} placeholder={menus[item.menuId]?.name ?? 'Название меню'} onChange={(e) => set({ title: e.target.value })} />
              </label>
            </div>
          )}

          <label className="tv-toggle">
            <input type="checkbox" checked={Boolean(style.logo)} onChange={(e) => set({ logo: e.target.checked })} />
            Логотип KAKDELA в углу
          </label>

          {error && <p className="form-error">{error}</p>}
        </div>

        <aside className="tv-style-preview">
          Так будет на экране
          <div className="tv-preview-screen">
            <SlidePreview item={preview} mediaUrl={filesUrl} menus={menus} />
          </div>
        </aside>
      </div>
      <footer className="modal-foot">
        {item.type === 'menu' && menuCount > 1 && (
          <button type="button" className="btn btn-ghost btn-left tv-apply-all" onClick={() => onApplyAll(style)}>
            Применить ко всем слайдам меню ({menuCount})
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
        <button type="button" className="btn btn-primary" onClick={() => onSave(style)}>Готово</button>
      </footer>
    </Modal>
  );
}

function PlaylistEditor({ playlist, screens, onSave, onDelete, onBack }) {
  const [name, setName] = useState(playlist.name);
  const [items, setItems] = useState(playlist.items);
  const [picker, setPicker] = useState(null); // 'docs' | 'menu' | 'text' | { text: item }
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef(null);
  const [menusRaw] = useShared(MENUS_KEY, []);
  const menus = useMemo(() => normalizeMenus(menusRaw).filter((m) => !m.archived), [menusRaw]);
  const menusById = useMemo(() => Object.fromEntries(menus.map((m) => [m.id, m])), [menus]);
  const [docsRaw] = useShared('ledger:files:v1', []);
  const mediaDocs = useMemo(
    () => docsRaw.filter((n) => n.kind === 'folder' || (n.kind === 'file' && /^(image|video)\//.test(n.mime || ''))),
    [docsRaw],
  );
  // После сохранения берём версию с сервера — она могла чуть отличаться (порядок полей, проверенные значения).
  useEffect(() => {
    setName(playlist.name);
    setItems(playlist.items);
  }, [playlist.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = name !== playlist.name || JSON.stringify(items) !== JSON.stringify(playlist.items);
  const usedOn = screens.filter((s) => s.defaultPlaylist === playlist.id || s.schedule.some((r) => r.playlistId === playlist.id));

  const setItem = (id, patch) => setItems((l) => l.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const move = (i, d) =>
    setItems((l) => {
      const j = i + d;
      if (j < 0 || j >= l.length) return l;
      const n = [...l];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const add = (item) => {
    setItems((l) => [...l, { id: uid('s'), duration: 10, ...item }]);
    setSaved(false);
  };

  const upload = async (files) => {
    setError('');
    for (const file of files) {
      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : null;
      if (!kind) {
        setError(`«${file.name}» — не изображение и не видео`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const id = uid('tv');
        await putBlob(id, file);
        add({ type: kind, fileId: id, name: file.name, fit: 'cover', ...(kind === 'video' ? { untilEnd: true } : {}) });
      } catch (err) {
        setError(err.message || 'Не удалось загрузить файл');
      }
      setUploading((n) => n - 1);
    }
  };

  const save = async () => {
    setError('');
    try {
      await onSave({ name, items });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const label = (i) =>
    i.type === 'menu' ? menusById[i.menuId]?.name ?? 'Меню удалено' : i.type === 'text' ? i.title || i.text : i.name || SLIDE_TYPES[i.type];

  // Для предпросмотра меню берём из общих данных (как увидит экран).
  const previewMenus = useMemo(() => Object.fromEntries(menus.map((m) => [m.id, { ...m, categories: m.categories ?? [] }])), [menus]);

  return (
    <>
      <nav className="crumbs std-crumbs" aria-label="Путь">
        <span className="crumb-wrap">
          <button className="crumb" onClick={onBack}>Плейлисты</button>
        </span>
      </nav>
      <div className="page-head std-head">
        <input className="tv-title-input" value={name} onChange={(e) => (setName(e.target.value), setSaved(false))} aria-label="Название плейлиста" />
        <div className="docs-actions">
          {saved && !dirty && <span className="tv-saved">Сохранено — экраны уже обновились</span>}
          <button className="btn btn-primary" disabled={!dirty} onClick={save}>
            Сохранить
          </button>
        </div>
      </div>
      <p className="std-meta">
        {items.length} {plural(items.length, ['слайд', 'слайда', 'слайдов'])} · цикл {fmtSec(totalSec(items))}
        {items.some((i) => i.type === 'video' && i.untilEnd !== false) && ' + видео'}
        {' · '}
        {usedOn.length ? `показывается: ${usedOn.map((s) => s.name).join(', ')}` : 'пока не назначен ни одному экрану'}
      </p>
      {error && <p className="form-error">{error}</p>}

      <div className="tv-editor">
        <div className="tv-editor-main">
          {items.length === 0 ? (
            <div className="menu-empty">
              <p>Плейлист пуст</p>
              <span>Добавьте фото, видео, меню или текстовый слайд</span>
            </div>
          ) : (
            <ol className="tv-items">
              {items.map((i, k) => (
                <li key={i.id}>
                  <span className="tv-item-thumb">
                    {i.type === 'image' ? <img src={filesUrl(i.fileId)} alt="" /> : i.type === 'video' ? <video src={filesUrl(i.fileId)} muted preload="metadata" /> : <b>{i.type === 'menu' ? 'Меню' : 'Aa'}</b>}
                  </span>
                  <span className="tv-item-main">
                    <span className="tv-item-title">{label(i)}</span>
                    <span className="tv-item-sub">
                      {SLIDE_TYPES[i.type]}
                      {(i.type === 'image' || i.type === 'video') && (
                        <select className="tv-inline" value={i.fit ?? 'cover'} onChange={(e) => setItem(i.id, { fit: e.target.value })} aria-label="Заполнение">
                          <option value="cover">на весь экран</option>
                          <option value="contain">целиком</option>
                        </select>
                      )}
                      {i.type === 'menu' && (
                        <>
                          <label className="tv-check">
                            <input type="checkbox" checked={i.showPrices !== false} onChange={(e) => setItem(i.id, { showPrices: e.target.checked })} />
                            цены
                          </label>
                          <label className="tv-check">
                            <input type="checkbox" checked={Boolean(i.showDescriptions)} onChange={(e) => setItem(i.id, { showDescriptions: e.target.checked })} />
                            описания
                          </label>
                        </>
                      )}
                      {i.type === 'text' && (
                        <button className="link-btn" onClick={() => setPicker({ text: i })}>
                          изменить
                        </button>
                      )}
                      {(i.type === 'menu' || i.type === 'text') && (
                        <button className="link-btn tv-style-link" onClick={() => setPicker({ style: i })}>
                          оформление{i.style ? ` · ${PRESETS[i.style.preset]?.label ?? 'своё'}` : ''}
                        </button>
                      )}
                    </span>
                  </span>
                  <span className="tv-item-time">
                    {i.type === 'video' && (
                      <select className="tv-inline" value={i.untilEnd !== false ? 'end' : 'time'} onChange={(e) => setItem(i.id, { untilEnd: e.target.value === 'end' })} aria-label="Длительность видео">
                        <option value="end">до конца</option>
                        <option value="time">по времени</option>
                      </select>
                    )}
                    {(i.type !== 'video' || i.untilEnd === false) && (
                      <>
                        <input
                          className="std-input tv-sec"
                          type="number"
                          min="3"
                          max="600"
                          value={i.duration}
                          onChange={(e) => setItem(i.id, { duration: Number(e.target.value) })}
                          aria-label="Секунд на экране"
                        />
                        <small>сек</small>
                      </>
                    )}
                  </span>
                  <span className="tv-item-actions">
                    <button className="link-btn" disabled={k === 0} onClick={() => move(k, -1)} aria-label="Выше">↑</button>
                    <button className="link-btn" disabled={k === items.length - 1} onClick={() => move(k, 1)} aria-label="Ниже">↓</button>
                    <button className="link-btn" onClick={() => setItems((l) => l.filter((x) => x.id !== i.id))} aria-label="Убрать слайд">✕</button>
                  </span>
                </li>
              ))}
            </ol>
          )}

          <div className="tv-add">
            <button className="btn btn-outline" onClick={() => fileRef.current.click()} disabled={uploading > 0}>
              {uploading ? 'Загружаем…' : 'Фото или видео'}
            </button>
            <button className="btn btn-outline" onClick={() => setPicker('docs')}>Из Документов</button>
            <button className="btn btn-outline" onClick={() => setPicker('menu')}>Меню</button>
            <button className="btn btn-outline" onClick={() => setPicker('text')}>Текст</button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              multiple
              hidden
              onChange={(e) => {
                const f = [...e.target.files];
                e.target.value = '';
                upload(f);
              }}
            />
          </div>

          <div className="tv-danger">
            {confirm ? (
              <>
                <span>Удалить плейлист?</span>
                <button className="link-btn" onClick={() => setConfirm(false)}>Нет</button>
                <button className="link-btn std-danger" onClick={onDelete}>Удалить</button>
              </>
            ) : (
              <button className="link-btn" onClick={() => setConfirm(true)}>Удалить плейлист</button>
            )}
          </div>
        </div>

        <aside className="tv-preview">
          <span className="tv-preview-label">Предпросмотр</span>
          <div className="tv-preview-screen">
            {items.length ? <PlaylistPlayer items={items} mediaUrl={filesUrl} menus={previewMenus} /> : <div className="tv-idle" />}
          </div>
        </aside>
      </div>

      {picker === 'docs' && (
        <DocPicker
          nodes={mediaDocs}
          selected={[]}
          onClose={() => setPicker(null)}
          onSave={(ids) => {
            for (const id of ids) {
              const n = docsRaw.find((x) => x.id === id);
              const kind = n.mime.startsWith('video/') ? 'video' : 'image';
              add({ type: kind, fileId: id, name: n.name, fit: 'cover', ...(kind === 'video' ? { untilEnd: true } : {}) });
            }
            setPicker(null);
          }}
        />
      )}
      {picker === 'menu' && (
        <Modal title="Слайд с меню" onClose={() => setPicker(null)}>
          <p className="field-note tv-note">Меню берётся из раздела «Основное и сезонные меню» и обновляется на экранах само, когда там меняются блюда или цены.</p>
          {menus.length === 0 ? (
            <p className="std-muted">В разделе меню пока ничего нет.</p>
          ) : (
            <ul className="std-picker-list">
              {menus.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="std-picker-row"
                    onClick={() => {
                      add({ type: 'menu', menuId: m.id, showPrices: true, showDescriptions: false, duration: 20 });
                      setPicker(null);
                    }}
                  >
                    <span className="std-file-name">{m.name}</span>
                    <span className="std-file-meta">{m.type === 'extra' ? 'дополнительное' : 'основное'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
      {picker?.style && (
        <StyleModal
          item={picker.style}
          menus={previewMenus}
          menuCount={items.filter((x) => x.type === 'menu').length}
          onClose={() => setPicker(null)}
          onSave={(style) => {
            setItem(picker.style.id, { style });
            setPicker(null);
          }}
          onApplyAll={(style) => {
            setItems((l) => l.map((x) => (x.type === 'menu' ? { ...x, style: { ...style, title: x.id === picker.style.id ? style.title : x.style?.title } } : x)));
            setPicker(null);
          }}
        />
      )}
      {(picker === 'text' || picker?.text) && (
        <TextSlideModal
          item={picker?.text}
          onClose={() => setPicker(null)}
          onSave={(v) => {
            if (picker?.text) setItem(picker.text.id, v);
            else add({ type: 'text', ...v, duration: 8 });
            setPicker(null);
          }}
        />
      )}
    </>
  );
}

// ---------- Раздел ----------

export default function TvPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('screens');
  const [openPlaylist, setOpenPlaylist] = useState(null);
  const [modal, setModal] = useState(null); // 'pair' | { screen } | 'new-playlist'
  const [newName, setNewName] = useState('');
  const [flash, setFlash] = useState('');

  const load = useCallback(() => api('/api/tv/admin').then(setData, (err) => setError(err.message)), []);
  useEffect(() => {
    load();
    return onRefresh(load, 15_000);
  }, [load]);

  const call = async (fn) => {
    setError('');
    try {
      setData(await fn());
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const command = async (screen, type) => {
    const res = await api(`/api/tv/admin/screens/${screen.id}/command`, { method: 'POST', body: { type } }).catch((err) => ({ error: err.message }));
    setFlash(res.error ? res.error : res.delivered ? (type === 'identify' ? `На экране «${screen.name}» показано название` : `Экран «${screen.name}» перезагружается`) : `Экран «${screen.name}» сейчас не в сети`);
    setTimeout(() => setFlash(''), 4000);
  };

  if (!data) return error ? <p className="docs-error">{error}</p> : <p className="sync-loading">Загружаем экраны…</p>;

  const { screens, playlists } = data;
  const byId = Object.fromEntries(playlists.map((p) => [p.id, p]));
  const pl = openPlaylist && byId[openPlaylist];

  if (pl) {
    return (
      <PlaylistEditor
        key={pl.id}
        playlist={pl}
        screens={screens}
        onBack={() => setOpenPlaylist(null)}
        onSave={(body) => call(() => api(`/api/tv/admin/playlists/${pl.id}`, { method: 'PUT', body }))}
        onDelete={() => call(() => api(`/api/tv/admin/playlists/${pl.id}`, { method: 'DELETE' })).then(() => setOpenPlaylist(null), () => {})}
      />
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Управление ТВ</h1>
        <div className="docs-actions">
          {tab === 'screens' ? (
            <button className="btn btn-primary" onClick={() => setModal('pair')}>Подключить экран</button>
          ) : (
            <button className="btn btn-primary" onClick={() => setModal('new-playlist')}>Новый плейлист</button>
          )}
        </div>
      </div>

      <div className="tabs menu-tabs" role="tablist">
        {[
          ['screens', 'Экраны', screens.length],
          ['playlists', 'Плейлисты', playlists.length],
        ].map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>
            {label}
            <span>{n}</span>
          </button>
        ))}
      </div>

      {error && <p className="docs-error">{error}</p>}
      {flash && <p className="tv-flash">{flash}</p>}

      {tab === 'screens' &&
        (screens.length === 0 ? (
          <div className="menu-empty">
            <p>Экраны не подключены</p>
            <span>Откройте на телевизоре {window.location.host}/tv и введите код с экрана в «Подключить экран»</span>
          </div>
        ) : (
          <ul className="tv-list">
            {screens.map((s) => {
              const now = byId[activePlaylistId(s)];
              return (
                <li key={s.id}>
                  <span className={`tv-dot ${s.online ? 'is-on' : ''}`} aria-hidden="true" />
                  <span className="tv-row-main">
                    <span className="tv-row-title">
                      {s.name}
                      {s.location && <small>{s.location}</small>}
                    </span>
                    <span className="tv-row-sub">
                      {s.waiting ? 'ждёт подключения — код введён, экран вот-вот появится' : s.online ? 'в сети' : ago(s.lastSeenAt)}
                      {' · '}
                      {now ? `сейчас: «${now.name}»` : 'ничего не показывает'}
                      {s.schedule.length > 0 && ` · ${s.schedule.length} ${plural(s.schedule.length, ['правило', 'правила', 'правил'])} расписания`}
                      {s.rotation ? ` · поворот ${s.rotation}°` : ''}
                    </span>
                  </span>
                  <span className="tv-row-actions">
                    <button className="link-btn" onClick={() => command(s, 'identify')}>Показать название</button>
                    <button className="link-btn" onClick={() => command(s, 'reload')}>Перезагрузить</button>
                    <button className="btn btn-outline" onClick={() => setModal({ screen: s })}>Настроить</button>
                  </span>
                </li>
              );
            })}
          </ul>
        ))}

      {tab === 'playlists' &&
        (playlists.length === 0 ? (
          <div className="menu-empty">
            <p>Плейлистов пока нет</p>
            <span>Плейлист — это набор слайдов: фото, видео, меню и объявления, которые идут по кругу</span>
          </div>
        ) : (
          <ul className="tv-list">
            {playlists.map((p) => {
              const on = screens.filter((s) => s.defaultPlaylist === p.id || s.schedule.some((r) => r.playlistId === p.id));
              return (
                <li key={p.id}>
                  <button className="tv-row-btn" onClick={() => setOpenPlaylist(p.id)}>
                    <span className="tv-row-main">
                      <span className="tv-row-title">{p.name}</span>
                      <span className="tv-row-sub">
                        {p.items.length} {plural(p.items.length, ['слайд', 'слайда', 'слайдов'])}
                        {p.items.length > 0 && ` · ${[...new Set(p.items.map((i) => SLIDE_TYPES[i.type].toLowerCase()))].join(', ')}`}
                        {' · '}
                        {on.length ? `на экранах: ${on.map((s) => s.name).join(', ')}` : 'не назначен'}
                      </span>
                    </span>
                    <span className="tv-row-sub">изменён {new Date(p.updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ))}

      {modal === 'pair' && <PairModal onClose={() => setModal(null)} onDone={(d) => (setData(d), setModal(null), setTab('screens'))} />}
      {modal?.screen && (
        <ScreenModal
          screen={modal.screen}
          playlists={playlists}
          onClose={() => setModal(null)}
          onSave={(body) => call(() => api(`/api/tv/admin/screens/${modal.screen.id}`, { method: 'PATCH', body })).then(() => setModal(null))}
          onRemove={() => call(() => api(`/api/tv/admin/screens/${modal.screen.id}`, { method: 'DELETE' })).then(() => setModal(null), () => {})}
        />
      )}
      {modal === 'new-playlist' && (
        <Modal title="Новый плейлист" onClose={() => setModal(null)}>
          <form
            className="tv-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              const before = new Set(playlists.map((p) => p.id));
              await call(() => api('/api/tv/admin/playlists', { method: 'POST', body: { name: newName } })).then((d) => d, () => null);
              setNewName('');
              setModal(null);
              setTab('playlists');
              const fresh = await api('/api/tv/admin');
              setData(fresh);
              const created = fresh.playlists.find((p) => !before.has(p.id));
              if (created) setOpenPlaylist(created.id);
            }}
          >
            <label className="field">
              Название
              <input autoFocus placeholder="Например, Основной зал — день" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </label>
            <footer className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Отмена</button>
              <button type="submit" className="btn btn-primary" disabled={!newName.trim()}>Создать</button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
