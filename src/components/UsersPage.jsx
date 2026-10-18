import { useCallback, useEffect, useState } from 'react';
import EditModal from './EditModal.jsx';
import { IconPlus } from './Icons.jsx';
import { api, initials, randomPassword } from '../api.js';
import { ROLES, roleLabel } from '../access.js';
import { onRefresh } from '../users.js';

const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDate = (iso) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

const DAYS = [
  ['1', '1 день'],
  ['3', '3 дня'],
  ['7', '7 дней'],
  ['14', '14 дней'],
];

function CopyField({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <input readOnly value={value} onFocus={(e) => e.target.select()} aria-label="Скопировать" />
      <button
        type="button"
        className="btn btn-outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* без доступа к буферу — значение можно выделить вручную */
          }
        }}
      >
        {copied ? 'Скопировано' : 'Скопировать'}
      </button>
    </div>
  );
}

function statusOf(u) {
  if (u.disabled) return ['off', 'Отключён'];
  if (u.mustChange) return ['pending', 'Ждёт смены пароля'];
  return ['ok', 'Активен'];
}

export default function UsersPage({ me }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  // { kind: 'add' | 'invite' | 'reset', user? }
  const [edit, setEdit] = useState(null);
  // Что показать админу один раз: ссылку-приглашение или выданный пароль.
  const [notice, setNotice] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => api('/api/admin/users').then(setData, (err) => setError(err.message)), []);
  useEffect(() => {
    load();
    return onRefresh(load);
  }, [load]);

  const act = async (fn) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const ROLE_FIELD = { name: 'role', label: 'Роль', options: ROLES, row: 'job' };
  const POSITION_FIELD = { name: 'position', label: 'Должность', placeholder: 'Например, шеф-повар', row: 'job' };

  const forms = {
    add: {
      title: 'Добавить пользователя',
      fields: [
        { name: 'name', label: 'Имя', required: true, placeholder: 'Например, Анна Петрова' },
        ROLE_FIELD,
        POSITION_FIELD,
        { name: 'login', label: 'Логин', required: true, placeholder: 'латиница, цифры, . _ -' },
        { name: 'password', label: 'Временный пароль', required: true },
      ],
      initial: { password: randomPassword(), role: 'employee' },
      submitLabel: 'Добавить',
      onSave: async (v) => {
        const { user } = await api('/api/admin/users', { method: 'POST', body: v });
        setNotice({ kind: 'password', name: user.name, login: user.login, password: v.password });
        setEdit(null);
        load();
      },
    },
    invite: {
      title: 'Пригласить по ссылке',
      fields: [
        { name: 'name', label: 'Для кого', required: true, placeholder: 'Имя человека' },
        ROLE_FIELD,
        POSITION_FIELD,
        { name: 'days', label: 'Ссылка действует', options: DAYS },
      ],
      initial: { days: '3', role: 'employee' },
      submitLabel: 'Создать ссылку',
      onSave: async (v) => {
        const res = await api('/api/admin/invites', { method: 'POST', body: { ...v, days: Number(v.days) } });
        setNotice({ kind: 'invite', name: res.invite.name, url: `${window.location.origin}${res.path}`, expiresAt: res.invite.expiresAt });
        setEdit(null);
        load();
      },
    },
    profile: {
      title: edit?.user?.name ?? '',
      // У владельца системы и у себя роль здесь не меняется — только имя и должность.
      fields: [
        { name: 'name', label: 'Имя', required: true },
        ...(edit?.user?.owner || edit?.user?.id === me.id ? [{ ...POSITION_FIELD, row: undefined }] : [ROLE_FIELD, POSITION_FIELD]),
      ],
      initial: edit?.user,
      onSave: async (v) => {
        await api(`/api/admin/users/${edit.user.id}`, { method: 'PATCH', body: v });
        setEdit(null);
        load();
      },
    },
    reset: {
      title: `Новый пароль для ${edit?.user?.name ?? ''}`,
      fields: [{ name: 'password', label: 'Временный пароль', required: true }],
      initial: { password: randomPassword() },
      submitLabel: 'Сбросить пароль',
      onSave: async (v) => {
        await api(`/api/admin/users/${edit.user.id}`, { method: 'PATCH', body: { password: v.password } });
        setNotice({ kind: 'password', name: edit.user.name, login: edit.user.login, password: v.password });
        setEdit(null);
        load();
      },
    },
  };

  const users = data?.users ?? [];
  const invites = data?.invites ?? [];

  return (
    <>
      <div className="page-head">
        <h1>Пользователи</h1>
        <div className="docs-actions">
          <button className="btn btn-outline btn-icon" onClick={() => setEdit({ kind: 'invite' })}>
            <IconPlus size={16} />
            Пригласить по ссылке
          </button>
          <button className="btn btn-primary btn-icon" onClick={() => setEdit({ kind: 'add' })}>
            <IconPlus size={16} />
            Добавить пользователя
          </button>
        </div>
      </div>

      <p className="fin-hint">
        Регистрации нет: доступ появляется, только если вы добавите человека сами (он сменит временный пароль при первом входе)
        или отправите ему ссылку-приглашение — по ней он задаст логин и пароль.
      </p>

      {error && <p className="docs-error">{error}</p>}

      {notice && (
        <section className="notice">
          {notice.kind === 'invite' ? (
            <>
              <h3>Ссылка для {notice.name}</h3>
              <p>Отправьте её человеку. Ссылка одноразовая, действует до {fmtDateTime(notice.expiresAt)} и показывается только сейчас.</p>
              <CopyField value={notice.url} />
            </>
          ) : (
            <>
              <h3>Доступ для {notice.name}</h3>
              <p>Передайте логин и временный пароль. При первом входе система попросит заменить пароль на свой. Пароль показывается только сейчас.</p>
              <div className="notice-creds">
                <span>Логин</span>
                <CopyField value={notice.login} />
                <span>Пароль</span>
                <CopyField value={notice.password} />
              </div>
            </>
          )}
          <button className="link-btn" onClick={() => setNotice(null)}>Готово, скрыть</button>
        </section>
      )}

      <section className="users">
        {users.map((u) => {
          const [status, statusLabel] = statusOf(u);
          const isMe = u.id === me.id;
          return (
            <div key={u.id} className={`user-row ${u.disabled ? 'is-disabled' : ''}`}>
              <span className="rail-avatar user-avatar">{initials(u.name)}</span>
              <div className="user-main">
                <b>
                  {u.name}
                  {isMe && <span className="user-me">это вы</span>}
                  {u.owner && <span className="user-me">владелец</span>}
                </b>
                <span>{[u.position, roleLabel(u.role)].filter(Boolean).join(' · ')}</span>
                <span className="user-login">{u.login}</span>
              </div>
              <span className={`user-status is-${status}`}>{statusLabel}</span>
              <span className="user-last">Вход: {fmtDateTime(u.lastLoginAt)}</span>
              <div className="user-actions">
                {confirm !== u.id && (
                  <button className="link-btn" onClick={() => setEdit({ kind: 'profile', user: u })}>Изменить</button>
                )}
                {!u.owner && !isMe &&
                  (confirm === u.id ? (
                    <>
                      <span className="user-confirm">Удалить {u.name}?</span>
                      <button className="link-btn" onClick={() => setConfirm(null)}>Нет</button>
                      <button className="link-btn fin-danger" onClick={() => act(() => api(`/api/admin/users/${u.id}`, { method: 'DELETE' })).then(() => setConfirm(null))}>
                        Удалить
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="link-btn" onClick={() => setEdit({ kind: 'reset', user: u })}>Сбросить пароль</button>
                      <button
                        className="link-btn"
                        onClick={() => act(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { disabled: !u.disabled } }))}
                      >
                        {u.disabled ? 'Включить' : 'Отключить'}
                      </button>
                      <button className="link-btn fin-danger" onClick={() => setConfirm(u.id)}>Удалить</button>
                    </>
                  ))}
              </div>
            </div>
          );
        })}
      </section>

      {invites.length > 0 && (
        <>
          <h3 className="pnl-subtitle">Ждут ответа по приглашению</h3>
          <section className="users">
            {invites.map((i) => (
              <div key={i.id} className="user-row">
                <span className="rail-avatar user-avatar is-invite">{initials(i.name)}</span>
                <div className="user-main">
                  <b>{i.name}</b>
                  <span>{[i.position, roleLabel(i.role)].filter(Boolean).join(' · ')} · ссылка выдана {fmtDate(i.createdAt)}</span>
                </div>
                <span className="user-status is-pending">До {fmtDateTime(i.expiresAt)}</span>
                <div className="user-actions">
                  <button className="link-btn fin-danger" onClick={() => act(() => api(`/api/admin/invites/${i.id}`, { method: 'DELETE' }))}>
                    Отозвать
                  </button>
                </div>
              </div>
            ))}
          </section>
        </>
      )}

      {edit && (
        <EditModal
          key={`${edit.kind}:${edit.user?.id ?? ''}`}
          title={forms[edit.kind].title}
          fields={forms[edit.kind].fields}
          initial={forms[edit.kind].initial}
          submitLabel={forms[edit.kind].submitLabel}
          onSave={forms[edit.kind].onSave}
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}
