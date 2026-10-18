import { useCallback, useEffect, useRef, useState } from 'react';
import logo from '../assets/kakdela-logo.png';
import { PlaylistPlayer, activePlaylistId } from './slides.jsx';

// Экран меню-борда (/tv). Работает без входа в систему: подключается по коду из панели
// «Управление ТВ», дальше сам забирает плейлисты и получает изменения по живому соединению.
// Если интернет пропал — продолжает показывать последнее, что было загружено.

const CACHE = 'kd_tv_state';
const mediaUrl = (id) => `/api/tv/media/${id}`;

const readCache = () => {
  try {
    return JSON.parse(localStorage.getItem(CACHE) || 'null');
  } catch {
    return null;
  }
};
const writeCache = (s) => {
  try {
    localStorage.setItem(CACHE, JSON.stringify(s));
  } catch {
    /* память браузера переполнена — показываем без кэша */
  }
};

function Pairing({ onPaired }) {
  const [pair, setPair] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    let poll = null;
    const start = async () => {
      try {
        const res = await fetch('/api/tv/pair', { method: 'POST' });
        const p = await res.json();
        if (!res.ok) throw new Error(p.error);
        if (!alive) return;
        setPair(p);
        setError('');
        poll = setInterval(async () => {
          const r = await fetch(`/api/tv/pair/${p.code}?secret=${encodeURIComponent(p.secret)}`, { credentials: 'same-origin' }).catch(() => null);
          if (!r) return;
          if (r.status === 404) {
            clearInterval(poll);
            start(); // код устарел — новый
            return;
          }
          const s = await r.json().catch(() => ({}));
          if (s.paired) {
            clearInterval(poll);
            onPaired();
          }
        }, 3000);
      } catch (err) {
        if (!alive) return;
        setError(err.message || 'Нет связи с сервером');
        setTimeout(() => alive && start(), 10_000);
      }
    };
    start();
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [onPaired]);

  return (
    <div className="tv-pair">
      <img src={logo} alt="KAKDELA" className="tv-pair-logo" />
      {pair ? (
        <>
          <p className="tv-pair-label">Код подключения экрана</p>
          <div className="tv-pair-code">
            {pair.code.slice(0, 3)} {pair.code.slice(3)}
          </div>
          <p className="tv-pair-hint">
            Откройте ЕСУ KAKDELA → «Управление ТВ» → «Подключить экран»
            <br />и введите этот код
          </p>
        </>
      ) : (
        <p className="tv-pair-hint">{error || 'Подключаемся…'}</p>
      )}
    </div>
  );
}

export default function TvPlayer() {
  const [mode, setMode] = useState('loading'); // loading | pairing | playing
  const [data, setData] = useState(readCache);
  const [identify, setIdentify] = useState(false);
  const [, setTick] = useState(0);
  const identifyTimer = useRef(null);
  // Версия сайта, с которой экран запустился: вышла новая — перезагружаемся, чтобы взять обновлённую программу.
  const bootVersion = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tv/state', { credentials: 'same-origin', cache: 'no-store' });
      if (res.status === 401) {
        localStorage.removeItem(CACHE);
        setData(null);
        setMode('pairing');
        return;
      }
      if (!res.ok) throw new Error();
      const s = await res.json();
      if (s.version) {
        if (!bootVersion.current) bootVersion.current = s.version;
        else if (s.version !== bootVersion.current) {
          window.location.reload();
          return;
        }
      }
      writeCache(s);
      setData(s);
      setMode('playing');
    } catch {
      // Нет сети — играем то, что сохранено.
      setMode(readCache() ? 'playing' : 'loading');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Живые изменения из панели + страховочный опрос раз в 5 минут.
  useEffect(() => {
    if (mode !== 'playing') return undefined;
    let es = null;
    let retry = null;
    const connect = () => {
      es = new EventSource('/api/tv/stream');
      es.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'update') load();
        if (msg.type === 'reload') window.location.reload();
        if (msg.type === 'unpaired') load();
        if (msg.type === 'identify') {
          setIdentify(true);
          clearTimeout(identifyTimer.current);
          identifyTimer.current = setTimeout(() => setIdentify(false), 15_000);
        }
      };
      es.onerror = () => {
        es.close();
        retry = setTimeout(() => {
          load();
          connect();
        }, 15_000);
      };
    };
    connect();
    const poll = setInterval(load, 5 * 60 * 1000);
    // Раз в минуту сверяемся с расписанием.
    const clock = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => {
      es?.close();
      clearTimeout(retry);
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [mode, load]);

  // Экран не гаснет, курсор не мешает.
  useEffect(() => {
    let lock = null;
    const ask = () => navigator.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    ask();
    const onVisible = () => document.visibilityState === 'visible' && ask();
    document.addEventListener('visibilitychange', onVisible);
    document.documentElement.classList.add('is-tv');
    return () => {
      lock?.release?.();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const fullscreen = () => !document.fullscreenElement && document.documentElement.requestFullscreen?.().catch(() => {});

  if (mode === 'pairing') return <Pairing onPaired={load} />;
  if (!data) return <div className="tv-root" />;

  const { screen, playlists, menus } = data;
  const playlist = playlists?.[activePlaylistId(screen)];
  const rotation = screen?.rotation ?? 0;

  return (
    <div className={`tv-root is-rot-${rotation}`} onClick={fullscreen}>
      <div className="tv-frame">
        {playlist?.items?.length ? (
          <PlaylistPlayer key={playlist.id} items={playlist.items} mediaUrl={mediaUrl} menus={menus} />
        ) : (
          <div className="tv-idle">
            <img src={logo} alt="KAKDELA" />
          </div>
        )}
        {identify && (
          <div className="tv-identify">
            <b>{screen.name}</b>
            {screen.location && <span>{screen.location}</span>}
            <small>{playlist ? `Плейлист «${playlist.name}»` : 'Плейлист не назначен'}</small>
          </div>
        )}
      </div>
    </div>
  );
}
