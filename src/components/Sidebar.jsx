import { useEffect, useRef, useState } from 'react';
import {
  IconBell,
  IconBookOpen,
  IconBulb,
  IconCalendar,
  IconChart,
  IconCheckSquare,
  IconChevronRight,
  IconClipboard,
  IconClock,
  IconFolder,
  IconGraduation,
  IconHome,
  IconLink,
  IconMapPinPlus,
  IconMegaphone,
  IconShieldCheck,
  IconSliders,
  IconTicket,
  IconUsers,
  IconWallet,
} from './Icons.jsx';
import logo from '../assets/kakdela-logo.png';
import { initials } from '../api.js';
import { roleLabel } from '../access.js';
import { useNotifications } from '../notifications.js';

// Структура меню. Пункт с children — раскрывающийся раздел.
// adminOnly — виден только супер-админу; hidden — временно убран из меню (страница и данные сохраняются,
// чтобы вернуть — удалите hidden). separated — группа визуально отделена от остальных.
export const NAV = [
  {
    title: 'Рабочее пространство',
    items: [
      { id: 'home', label: 'Главная', Icon: IconHome },
      { id: 'tasks', label: 'Задачи', Icon: IconCheckSquare },
    ],
  },
  {
    title: 'Управление кафе',
    items: [
      { id: 'menu', label: 'Меню', Icon: IconBookOpen },
      { id: 'shifts', label: 'Смены', Icon: IconClock },
      { id: 'standards', label: 'Стандарты', Icon: IconClipboard },
      { id: 'training', label: 'Обучение', Icon: IconGraduation },
      {
        id: 'quality-group',
        label: 'Контроль качества',
        Icon: IconShieldCheck,
        children: [{ id: 'reviews', label: 'Отзывы', Icon: IconShieldCheck }],
      },
      { id: 'docs', label: 'Документы', Icon: IconFolder },
    ],
  },
  {
    title: 'Развитие',
    items: [
      {
        id: 'marketing-group',
        label: 'Маркетинг',
        Icon: IconMegaphone,
        children: [
          { id: 'marketing', label: 'Календарь', Icon: IconCalendar },
          { id: 'events', label: 'Мероприятия', Icon: IconTicket },
          { id: 'collabs', label: 'Коллаборации', Icon: IconLink },
        ],
      },
      { id: 'ideas', label: 'Идеи', Icon: IconBulb },
      { id: 'openings', label: 'Открытие точек', Icon: IconMapPinPlus },
    ],
  },
  {
    title: 'Управление',
    separated: true,
    items: [
      // soon — раздел в разработке: виден в меню, но открыть его нельзя.
      { id: 'finance', label: 'Финансы', Icon: IconWallet, soon: true },
      { id: 'analytics', label: 'Аналитика', Icon: IconChart, soon: true },
      // Скрытый модуль финмодели и анализа P&L — страница /reports работает, в меню не показывается.
      { id: 'reports', label: 'Анализ отчётности', Icon: IconChart, hidden: true },
      { id: 'users', label: 'Пользователи', Icon: IconUsers, adminOnly: true },
      { id: 'network', label: 'Настройки сети', Icon: IconSliders },
    ],
  },
];

const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
const groupOf = (page) => NAV.flatMap((g) => g.items).find((i) => i.children?.some((c) => c.id === page))?.id;

export default function Sidebar({ page, onPage, user, onChangePassword, onLogout }) {
  const [open, setOpen] = useState(() => new Set([groupOf(page)].filter(Boolean)));
  const [account, setAccount] = useState(false);
  const [sheet, setSheet] = useState(false);
  const notifications = useNotifications();
  const navRef = useRef(null);
  const count = notifications.length;

  // Раздел с текущей страницей раскрыт.
  useEffect(() => {
    const g = groupOf(page);
    if (g) setOpen((s) => (s.has(g) ? s : new Set(s).add(g)));
  }, [page]);

  // Меню аккаунта закрывается по нажатию вне меню; всё всплывающее — по Escape.
  useEffect(() => {
    if (!account && !sheet) return undefined;
    const onDown = (e) => !navRef.current?.contains(e.target) && setAccount(false);
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setAccount(false);
      setSheet(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [account, sheet]);

  const toggle = (id) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const go = (id) => {
    setAccount(false);
    setSheet(false);
    onPage(id);
  };

  const visible = (item) => !item.hidden && (!item.adminOnly || user.role === 'admin');

  const renderItem = (item, { child = false, forceOpen = false } = {}) => {
    // Иконки (Icon) в меню не показываем — они используются на страницах-заглушках.
    const { id, label, children } = item;
    if (children) {
      const expanded = forceOpen || open.has(id);
      const hasActive = children.some((c) => c.id === page);
      return (
        <div key={id} className={`sb-folder ${expanded ? 'is-open' : ''}`}>
          <button
            className={`sb-item ${hasActive && !expanded ? 'is-active' : ''} ${hasActive ? 'has-active' : ''}`}
            aria-expanded={expanded}
            onClick={() => !forceOpen && toggle(id)}
          >
            <span className="sb-label">{label}</span>
            {!forceOpen && <IconChevronRight size={14} className="sb-chevron" />}
          </button>
          {expanded && <div className="sb-children">{children.map((c) => renderItem(c, { child: true }))}</div>}
        </div>
      );
    }
    if (item.soon) {
      return (
        <div key={id} className="sb-item is-soon" aria-disabled="true" title="Раздел в разработке">
          <span className="sb-label">{label}</span>
          <span className="sb-soon">скоро</span>
        </div>
      );
    }
    return (
      <button
        key={id}
        className={`sb-item ${child ? 'is-child' : ''} ${id === page ? 'is-active' : ''}`}
        aria-current={id === page ? 'page' : undefined}
        onClick={() => go(id)}
      >
        <span className="sb-label">{label}</span>
      </button>
    );
  };

  const renderGroups = (forceOpen) =>
    NAV.map((g) => {
      const items = g.items.filter(visible);
      if (!items.length) return null;
      return (
        <div key={g.title} className={`sb-group ${g.separated ? 'is-separated' : ''}`}>
          <div className="sb-group-title">{g.title}</div>
          {items.map((i) => renderItem(i, { forceOpen }))}
        </div>
      );
    });

  const bellBadge = count > 0 && <span className="sb-badge">{count > 99 ? '99+' : count}</span>;

  const accountMenu = account && (
    <div className="sb-account" role="menu">
      <div className="sb-account-head">
        <b>{user.name}</b>
        <span>{[user.position, roleLabel(user.role)].filter(Boolean).join(' · ')}</span>
        <span>{user.login}</span>
      </div>
      {user.role === 'admin' && (
        <button role="menuitem" className={page === 'users' ? 'is-active' : ''} onClick={() => go('users')}>
          Пользователи
        </button>
      )}
      <button
        role="menuitem"
        onClick={() => {
          setAccount(false);
          onChangePassword();
        }}
      >
        Сменить пароль
      </button>
      <button role="menuitem" className="sb-account-logout" onClick={onLogout}>
        Выйти
      </button>
    </div>
  );

  const avatarButton = (extra = '') => (
    <button
      className={`sb-user ${extra} ${account ? 'is-open' : ''}`}
      aria-expanded={account}
      aria-haspopup="menu"
      aria-label="Аккаунт"
      onClick={() => {
        setAccount((v) => !v);
        setSheet(false);
      }}
    >
      <span className="rail-avatar">{initials(user.name)}</span>
      <span className="sb-user-text">
        <span>{user.name}</span>
        <small>{user.position || roleLabel(user.role)}</small>
      </span>
    </button>
  );

  return (
    <nav className="sb" aria-label="Основная навигация" ref={navRef}>
      {/* Компьютер: логотип с колокольчиком, группы разделов, аккаунт. */}
      <div className="sb-head">
        <img src={logo} alt="KAKDELA — клуб : кофе" />
        <button
          className={`sb-bell ${page === 'notifications' ? 'is-active' : ''} ${count ? 'has-new' : ''}`}
          onClick={() => go('notifications')}
          aria-label={count ? `Оповещения: ${count} новых` : 'Оповещения: новых нет'}
          title={count ? `Оповещения: ${count}` : 'Оповещений нет'}
        >
          <IconBell size={19} />
          {bellBadge}
        </button>
      </div>

      <div className="sb-scroll">{renderGroups(false)}</div>

      <div className="sb-foot">
        {avatarButton()}
        {!isMobile() && accountMenu}
      </div>

      {/* Телефон: нижняя панель с главными разделами, остальное — в выезжающей панели «Ещё». */}
      <div className="sb-tabbar">
        {[
          { id: 'home', label: 'Главная' },
          { id: 'tasks', label: 'Задачи' },
          { id: 'notifications', label: 'Оповещения', badge: true },
        ].map(({ id, label, badge }) => (
          <button key={id} className={`sb-tab ${page === id && !sheet ? 'is-active' : ''}`} onClick={() => go(id)}>
            <span className="sb-tab-label">{label}</span>
            {badge && bellBadge}
          </button>
        ))}
        <button
          className={`sb-tab ${sheet ? 'is-active' : ''}`}
          aria-expanded={sheet}
          onClick={() => {
            setSheet((v) => !v);
            setAccount(false);
          }}
        >
          <span className="sb-tab-label">Ещё</span>
        </button>
        {avatarButton('is-tab')}
        {isMobile() && accountMenu}
      </div>

      {sheet && (
        <>
          <div className="sb-sheet-backdrop" onClick={() => setSheet(false)} />
          <div className="sb-sheet" role="dialog" aria-label="Все разделы">
            <div className="sb-sheet-grip" />
            {renderGroups(true)}
          </div>
        </>
      )}
    </nav>
  );
}
