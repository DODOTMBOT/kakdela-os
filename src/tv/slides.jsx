import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import logo from '../assets/kakdela-logo.png';

// Слайды меню-бордов: одинаково на телевизоре и в предпросмотре панели.
// mediaUrl(fileId) — откуда брать файл: экран берёт через /api/tv/media, панель — через /api/files.

const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export const SLIDE_TYPES = { image: 'Изображение', video: 'Видео', menu: 'Меню', text: 'Текст' };

// Какой плейлист играет сейчас: первое подходящее правило расписания, иначе основной.
export function activePlaylistId(screen, date = new Date()) {
  const day = date.getDay();
  const t = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  for (const r of screen?.schedule ?? []) {
    if (!r.days.includes(day)) continue;
    const inside = r.from < r.to ? t >= r.from && t < r.to : t >= r.from || t < r.to; // через полночь
    if (inside) return r.playlistId;
  }
  return screen?.defaultPlaylist ?? null;
}

// ---------- Оформление слайдов меню и текста ----------
// item.style: { preset, bg, fg, accent, bgImageId, overlay (0–90, %), font, columns (0 — авто), align, logo, title }

export const PRESETS = {
  classic: { label: 'Классика', bg: '#111111', fg: '#ffffff', accent: '#ffffff' },
  light: { label: 'Светлый', bg: '#f4efe6', fg: '#1d1a17', accent: '#b5562b' },
  coffee: { label: 'Кофейный', bg: '#2b1d16', fg: '#f3e9dc', accent: '#d9a066' },
  green: { label: 'Зелёный', bg: '#1f3a2e', fg: '#f1ede4', accent: '#c8d5a0' },
};

export const FONTS = {
  sans: { label: 'Как на сайте', family: "'Poppins', system-ui, sans-serif" },
  serif: { label: 'С засечками', family: "'Playfair Display', Georgia, serif", google: 'Playfair+Display:wght@400;600;700' },
  condensed: { label: 'Узкий, плакатный', family: "'Oswald', 'Arial Narrow', sans-serif", google: 'Oswald:wght@400;500;600' },
  rounded: { label: 'Округлый', family: "'Comfortaa', system-ui, sans-serif", google: 'Comfortaa:wght@400;600;700' },
};

const loadedFonts = new Set();
function ensureFont(key) {
  const f = FONTS[key];
  if (!f?.google || loadedFonts.has(key) || typeof document === 'undefined') return;
  loadedFonts.add(key);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
  document.head.appendChild(link);
}

// Итоговое оформление: классика ← выбранный готовый стиль ← свои настройки.
export const resolveStyle = (style = {}) => {
  const preset = PRESETS[style.preset] ?? PRESETS.classic;
  const own = Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  return { ...PRESETS.classic, ...preset, ...own };
};

// Светлый ли цвет — тогда белый логотип делаем тёмным.
export const isLight = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 150;
};

function Themed({ style, mediaUrl, className, children }) {
  const st = resolveStyle(style);
  useEffect(() => ensureFont(st.font), [st.font]);
  return (
    <div
      className={`tvs-themed ${className} is-${st.align === 'center' ? 'center' : 'left'}`}
      style={{ '--bg': st.bg, '--fg': st.fg, '--accent': st.accent, fontFamily: FONTS[st.font]?.family }}
    >
      {st.bgImageId && (
        <>
          <img className="tvs-bg" src={mediaUrl(st.bgImageId)} alt="" />
          <div className="tvs-bg-dim" style={{ opacity: (st.overlay ?? 50) / 100 }} />
        </>
      )}
      <div className="tvs-content">{children}</div>
      {st.logo && <img className={`tvs-logo ${isLight(st.fg) ? '' : 'is-dark'}`} src={logo} alt="KAKDELA" />}
    </div>
  );
}

function MenuSlide({ item, menu, mediaUrl }) {
  if (!menu) {
    return (
      <Themed style={item.style} mediaUrl={mediaUrl} className="tvs-text">
        <h2>Меню не найдено</h2>
      </Themed>
    );
  }
  const st = resolveStyle(item.style);
  const dishes = menu.categories.reduce((n, c) => n + c.dishes.length, 0);
  const columns = Number(st.columns) || (dishes > 18 ? 3 : 2);
  return (
    <Themed style={item.style} mediaUrl={mediaUrl} className={`tvs-menu ${dishes > 18 ? 'is-dense' : ''}`}>
      <h1>{st.title || menu.name}</h1>
      <div className="tvs-menu-cols" style={{ columns }}>
        {menu.categories
          .filter((c) => c.dishes.length)
          .map((c) => (
            <section key={c.id}>
              <h2>{c.name}</h2>
              <ul>
                {c.dishes.map((d) => (
                  <li key={d.id}>
                    <div className="tvs-dish">
                      <span className="tvs-dish-name">{d.name}</span>
                      {d.weight && <span className="tvs-dish-weight">{d.weight}</span>}
                      <span className="tvs-dots" />
                      {item.showPrices !== false && d.price !== null && d.price !== '' && <span className="tvs-dish-price">{money.format(d.price)} ₽</span>}
                    </div>
                    {item.showDescriptions && d.description && <p>{d.description}</p>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </Themed>
  );
}

export function Slide({ item, mediaUrl, menus, onEnded, single = false }) {
  if (item.type === 'image') return <img className={`tvs-media is-${item.fit ?? 'cover'}`} src={mediaUrl(item.fileId)} alt="" />;
  if (item.type === 'video') {
    return <video className={`tvs-media is-${item.fit ?? 'cover'}`} src={mediaUrl(item.fileId)} autoPlay muted playsInline loop={single} onEnded={onEnded} onError={onEnded} />;
  }
  if (item.type === 'menu') return <MenuSlide item={item} menu={menus?.[item.menuId]} mediaUrl={mediaUrl} />;
  return (
    <Themed style={item.style} mediaUrl={mediaUrl} className="tvs-text">
      {item.title && <h2>{item.title}</h2>}
      {item.text && <p>{item.text}</p>}
    </Themed>
  );
}

// Масштаб текста слайдов — 1% меньшей стороны экрана (и на ТВ, и в предпросмотре).
export function useStageScale() {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => el.style.setProperty('--u', `${Math.min(el.clientWidth, el.clientHeight) / 100}px`);
    fit();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fit);
      return () => window.removeEventListener('resize', fit);
    }
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return ref;
}

// Один слайд без смены — для предпросмотра оформления.
export function SlidePreview({ item, mediaUrl, menus }) {
  const stage = useStageScale();
  return (
    <div className="tvs-stage" ref={stage}>
      <div className="tvs-slide">
        <Slide item={item} mediaUrl={mediaUrl} menus={menus} />
      </div>
    </div>
  );
}

// Проигрывание по кругу: каждый слайд — своё время, видео — до конца (если так настроено).
export function PlaylistPlayer({ items, mediaUrl, menus, paused = false }) {
  const [index, setIndex] = useState(0);
  const timer = useRef(null);
  const stage = useStageScale();
  const list = items ?? [];
  const current = list[index % Math.max(1, list.length)];

  useEffect(() => setIndex(0), [list.length]);

  const next = () => setIndex((i) => (list.length ? (i + 1) % list.length : 0));

  useEffect(() => {
    clearTimeout(timer.current);
    if (!current || paused || list.length < 2) return undefined;
    if (current.type === 'video' && current.untilEnd !== false) {
      // Подстраховка: если видео не закончится само — переключаемся через 10 минут.
      timer.current = setTimeout(next, 10 * 60 * 1000);
    } else timer.current = setTimeout(next, (current.duration ?? 10) * 1000);
    return () => clearTimeout(timer.current);
  }, [current?.id, index, paused, list.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Следующее изображение (и фон следующего слайда) загружаем заранее, чтобы смена была без пауз.
  useEffect(() => {
    const n = list[(index + 1) % Math.max(1, list.length)];
    if (n?.type === 'image') new Image().src = mediaUrl(n.fileId);
    if (n?.style?.bgImageId) new Image().src = mediaUrl(n.style.bgImageId);
  }, [index, list, mediaUrl]);

  return (
    <div className="tvs-stage" ref={stage}>
      {current && (
        <div key={`${current.id}-${index}`} className="tvs-slide">
          <Slide
            item={current}
            mediaUrl={mediaUrl}
            menus={menus}
            single={list.length === 1}
            onEnded={() => {
              if (list.length > 1) next();
            }}
          />
        </div>
      )}
    </div>
  );
}
