import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import Sidebar, { NAV } from './components/Sidebar.jsx';
import ComingSoonPage from './components/ComingSoonPage.jsx';
import ReviewsPage from './components/ReviewsPage.jsx';
import HomePage from './components/HomePage.jsx';
import NotificationsPage from './components/NotificationsPage.jsx';
import MenuPage from './components/MenuPage.jsx';
import MarketingPage from './components/MarketingPage.jsx';
import IdeasPage from './components/IdeasPage.jsx';
import DocsPage from './components/DocsPage.jsx';
import FinModelPage from './components/FinModelPage.jsx';
import TasksPage from './components/TasksPage.jsx';
import CollabsPage from './components/CollabsPage.jsx';
import EventsPage from './components/EventsPage.jsx';
import UsersPage from './components/UsersPage.jsx';
import StandardsPage from './components/StandardsPage.jsx';
import TrainingPage from './components/TrainingPage.jsx';
import EditModal from './components/EditModal.jsx';
import { api } from './api.js';
import { useSyncRejection, useSyncStatus } from './sync.js';

const PASSWORD_FIELDS = [
  { name: 'current', label: 'Текущий пароль', type: 'password', required: true },
  { name: 'next', label: 'Новый пароль', type: 'password', required: true, placeholder: 'не короче 8 символов' },
  { name: 'repeat', label: 'Новый пароль ещё раз', type: 'password', required: true },
];

// У каждого раздела свой адрес: после обновления страницы остаёмся там же, работают «назад» и «вперёд».
const ROUTES = {
  home: '/',
  notifications: '/notifications',
  tasks: '/tasks',
  menu: '/menu',
  marketing: '/calendar',
  events: '/events',
  collabs: '/collabs',
  ideas: '/ideas',
  docs: '/docs',
  reports: '/reports',
  users: '/users',
  // Разделы в разработке.
  shifts: '/shifts',
  standards: '/standards',
  training: '/training',
  reviews: '/quality/reviews',
  openings: '/openings',
  finance: '/finance',
  analytics: '/analytics',
  network: '/network',
};
const COMING_SOON = new Set(['shifts', 'openings', 'finance', 'analytics', 'network']);
// Разделы в разработке, закрытые для перехода (в меню помечены «скоро»).
const LOCKED = new Set(NAV.flatMap((g) => g.items).filter((i) => i.soon).map((i) => i.id));
const navItem = (id) => NAV.flatMap((g) => g.items).find((i) => i.id === id);
const PAGE_BY_PATH = {
  ...Object.fromEntries(Object.entries(ROUTES).map(([page, path]) => [path, page])),
  // «Контроль качества» стал разделом с подразделами; старый адрес ведёт к отзывам.
  '/quality': 'reviews',
};
// Плавная смена страниц: где браузер умеет View Transitions, старая страница гаснет, а новая проявляется.
function withTransition(update) {
  if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return update();
  document.startViewTransition(() => flushSync(update));
}

const pageFromLocation = () => {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  // У статей стандартов свои адреса: /standards/<id>, /standards/<id>/edit, /standards/new.
  if (path.startsWith('/standards/')) return 'standards';
  // У обучения тоже: /training/courses, /training/<курс>, /training/<курс>/lesson/<урок> и т. п.
  if (path.startsWith('/training/')) return 'training';
  const page = PAGE_BY_PATH[path] ?? 'home';
  // Закрытый раздел по прямой ссылке — на главную.
  if (LOCKED.has(page)) {
    window.history.replaceState(null, '', '/');
    return 'home';
  }
  return page;
};

export default function App({ user, setUser, logout }) {
  const [page, setPage] = useState(pageFromLocation);
  const [passwordForm, setPasswordForm] = useState(false);
  // Какую запись открыть при переходе из календаря или со сводки.
  const [menuFocus, setMenuFocus] = useState(null);
  const [eventFocus, setEventFocus] = useState(null);
  const [collabFocus, setCollabFocus] = useState(null);
  const [taskFocus, setTaskFocus] = useState(null);

  const open = useCallback((target, id = null) => {
    if (LOCKED.has(target)) return;
    withTransition(() => {
      setMenuFocus(target === 'menu' ? id : null);
      setEventFocus(target === 'events' ? id : null);
      setCollabFocus(target === 'collabs' ? id : null);
      setTaskFocus(target === 'tasks' ? id : null);
      setPage(target);
    });
    // Из оповещения о назначенном курсе — сразу на страницу курса.
    const path = target === 'training' && id ? `/training/${encodeURIComponent(id)}` : (ROUTES[target] ?? '/');
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
    // Разделы со своей внутренней навигацией (стандарты) узнают о переходе.
    window.dispatchEvent(new Event('kd:navigate'));
  }, []);

  useEffect(() => {
    const onPop = () =>
      withTransition(() => {
        setMenuFocus(null);
        setEventFocus(null);
        setCollabFocus(null);
        setTaskFocus(null);
        setPage(pageFromLocation());
      });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return (
    <div className="app">
      <Sidebar
        page={page}
        onPage={(p) => open(p)}
        user={user}
        onChangePassword={() => setPasswordForm(true)}
        onLogout={logout}
      />

      {COMING_SOON.has(page) ? (
        <main className="main" key={page}>
          <ComingSoonPage key={page} title={navItem(page).label} Icon={navItem(page).Icon} />
        </main>
      ) : page === 'training' ? (
        <main className="main" key={page}>
          <TrainingPage user={user} />
        </main>
      ) : page === 'standards' ? (
        <main className="main" key={page}>
          <StandardsPage user={user} />
        </main>
      ) : page === 'reviews' ? (
        <main className="main" key={page}>
          <ReviewsPage />
        </main>
      ) : page === 'menu' ? (
        <main className="main" key={page}>
          <MenuPage key={menuFocus ?? 'menu'} focusId={menuFocus} />
        </main>
      ) : page === 'users' && user.role === 'admin' ? (
        <main className="main" key={page}>
          <UsersPage me={user} />
        </main>
      ) : page === 'notifications' ? (
        <main className="main" key={page}>
          <NotificationsPage open={open} />
        </main>
      ) : page === 'events' ? (
        <main className="main" key={page}>
          <EventsPage key={eventFocus ?? 'events'} focusId={eventFocus} />
        </main>
      ) : page === 'collabs' ? (
        <main className="main" key={page}>
          <CollabsPage key={collabFocus ?? 'collabs'} focusId={collabFocus} />
        </main>
      ) : page === 'tasks' ? (
        <main className="main" key={page}>
          <TasksPage key={taskFocus ?? 'tasks'} user={user} focusId={taskFocus} />
        </main>
      ) : page === 'reports' ? (
        <main className="main" key={page}>
          <FinModelPage />
        </main>
      ) : page === 'docs' ? (
        <main className="main" key={page}>
          <DocsPage />
        </main>
      ) : page === 'ideas' ? (
        <main className="main" key={page}>
          <IdeasPage />
        </main>
      ) : page === 'marketing' ? (
        <main className="main" key={page}>
          <MarketingPage
            onOpenMenu={(id) => open('menu', id)}
            onOpenEvent={(id) => open('events', id)}
            onOpenCollab={(id) => open('collabs', id)}
          />
        </main>
      ) : (
        <main className="main" key={page}>
          <HomePage user={user} open={open} />
        </main>
      )}

      <SyncNotice />

      {passwordForm && (
        <ChangePassword
          onDone={(u) => {
            setUser(u);
            setPasswordForm(false);
          }}
          onClose={() => setPasswordForm(false)}
        />
      )}

    </div>
  );
}

// Смена своего пароля; ошибку сервера (например, неверный текущий) форма покажет сама.
function ChangePassword({ onDone, onClose }) {
  return (
    <EditModal
      title="Сменить пароль"
      fields={PASSWORD_FIELDS}
      validate={(v) => (v.next !== v.repeat ? 'Новые пароли не совпадают' : null)}
      submitLabel="Сменить"
      onSave={async (v) => {
        const { user } = await api('/api/auth/password', { method: 'POST', body: { current: v.current, next: v.next } });
        onDone(user);
      }}
      onClose={onClose}
    />
  );
}

// Если сервер недоступен, правки не теряются — они уйдут, когда связь вернётся.
function SyncNotice() {
  const status = useSyncStatus();
  const rejected = useSyncRejection();
  if (rejected) return <div className="sync-notice is-rejected" role="alert">{rejected}</div>;
  if (status !== 'error') return null;
  return <div className="sync-notice" role="status">Нет связи с сервером — изменения сохранятся, когда связь появится</div>;
}
