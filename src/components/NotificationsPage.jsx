import { useState } from 'react';
import { IconClose } from './Icons.jsx';
import { removeNotifications, timeAgo, useNotifications } from '../notifications.js';
import { initials } from '../api.js';

const KIND = {
  task_assigned: 'Задача',
  task_updated: 'Изменение',
  task_done: 'Выполнено',
};

// Строка оповещения: клик ведёт к записи и убирает оповещение, крестик — просто убирает.
export function NotificationItem({ n, open, compact = false }) {
  return (
    <li className={`ntf is-${n.type} ${compact ? 'is-compact' : ''}`}>
      <button
        className="ntf-main"
        onClick={() => {
          removeNotifications([n.id]);
          open(n.link.page, n.link.id);
        }}
      >
        <span className="rail-avatar ntf-avatar" title={n.actorName}>{initials(n.actorName)}</span>
        <span className="ntf-text">
          <span className="ntf-title">{n.title}</span>
          {n.detail && <span className="ntf-detail">{n.detail}</span>}
          <span className="ntf-meta">
            <span className={`ntf-kind is-${n.type}`}>{KIND[n.type] ?? 'Оповещение'}</span>
            от {n.actorName} · {timeAgo(n.createdAt)}
          </span>
        </span>
      </button>
      <button className="row-del ntf-del" aria-label="Убрать оповещение" onClick={() => removeNotifications([n.id])}>
        <IconClose size={14} />
      </button>
    </li>
  );
}

export default function NotificationsPage({ open }) {
  const items = useNotifications();
  const [confirm, setConfirm] = useState(false);

  return (
    <>
      <div className="page-head">
        <h1>Оповещения</h1>
        {items.length > 0 &&
          (confirm ? (
            <span className="fin-confirm">
              Убрать все {items.length}?
              <button className="link-btn" onClick={() => setConfirm(false)}>Нет</button>
              <button
                className="link-btn fin-danger"
                onClick={() => {
                  removeNotifications();
                  setConfirm(false);
                }}
              >
                Очистить
              </button>
            </span>
          ) : (
            <button className="btn btn-outline" onClick={() => setConfirm(true)}>Очистить все</button>
          ))}
      </div>

      {items.length === 0 ? (
        <div className="menu-empty">
          <p>Новых оповещений нет</p>
          <span>Здесь появится, когда вам поставят или изменят задачу, или выполнят задачу, которую поставили вы</span>
        </div>
      ) : (
        <ul className="ntfs">{items.map((n) => <NotificationItem key={n.id} n={n} open={open} />)}</ul>
      )}
    </>
  );
}
