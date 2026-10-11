import { useCallback, useEffect, useState } from 'react';
import { AUTH_EXPIRED, api } from '../api.js';
import { initSync, stopSync } from '../sync.js';
import { roleLabel } from '../access.js';
import logo from '../assets/kakdela-logo.png';

const inviteToken = () => window.location.pathname.match(/^\/invite\/([A-Za-z0-9_-]{20,100})\/?$/)?.[1] ?? null;

function AuthCard({ title, subtitle, error, onSubmit, children, submitLabel, busy }) {
  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand">
          <img src={logo} alt="KAKDELA — клуб : кофе" />
        </div>
        <div className="auth-body">
          <h1>{title}</h1>
          {subtitle && <p className="auth-sub">{subtitle}</p>}
          {children}
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
            {busy ? 'Подождите…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="field">
      {label}
      <input {...props} />
    </label>
  );
}

function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const bind = (name) => ({
    value: values[name],
    onChange: (e) => {
      setValues((v) => ({ ...v, [name]: e.target.value }));
      setError('');
    },
  });
  const run = (fn) => async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await fn(values);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return { values, bind, error, setError, busy, run };
}

function LoginScreen({ onLogin }) {
  const f = useForm({ login: '', password: '' });
  return (
    <AuthCard
      title="Вход"
      subtitle="Доступ выдаёт администратор"
      error={f.error}
      busy={f.busy}
      submitLabel="Войти"
      onSubmit={f.run(async (v) => onLogin((await api('/api/auth/login', { method: 'POST', body: v })).user))}
    >
      <Field label="Логин" autoFocus autoComplete="username" autoCapitalize="none" {...f.bind('login')} />
      <Field label="Пароль" type="password" autoComplete="current-password" {...f.bind('password')} />
    </AuthCard>
  );
}

function InviteScreen({ token, onLogin }) {
  const [invite, setInvite] = useState(undefined);
  const f = useForm({ login: '', password: '', repeat: '' });

  useEffect(() => {
    api(`/api/auth/invite/${token}`).then(setInvite, () => setInvite(null));
  }, [token]);

  if (invite === undefined) return <div className="auth-screen" />;
  if (invite === null) {
    return (
      <AuthCard
        title="Приглашение недействительно"
        subtitle="Ссылка устарела или уже использована. Попросите администратора выдать новую"
        submitLabel="Ко входу"
        onSubmit={(e) => {
          e.preventDefault();
          window.history.replaceState(null, '', '/');
          onLogin(null);
        }}
      />
    );
  }
  return (
    <AuthCard
      title={`Здравствуйте, ${invite.name}`}
      subtitle={`${[invite.position, roleLabel(invite.role)].filter(Boolean).join(' · ')}. Придумайте логин и пароль — по ним вы будете входить`}
      error={f.error}
      busy={f.busy}
      submitLabel="Создать доступ"
      onSubmit={f.run(async (v) => {
        if (v.password !== v.repeat) throw new Error('Пароли не совпадают');
        const { user } = await api(`/api/auth/invite/${token}`, { method: 'POST', body: { login: v.login, password: v.password } });
        window.history.replaceState(null, '', '/');
        onLogin(user);
      })}
    >
      <Field label="Логин" autoFocus autoComplete="username" autoCapitalize="none" placeholder="латиница, цифры, . _ -" {...f.bind('login')} />
      <Field label="Пароль" type="password" autoComplete="new-password" placeholder="не короче 8 символов" {...f.bind('password')} />
      <Field label="Пароль ещё раз" type="password" autoComplete="new-password" {...f.bind('repeat')} />
    </AuthCard>
  );
}

function ForceChangeScreen({ user, onDone, onLogout }) {
  const f = useForm({ current: '', next: '', repeat: '' });
  return (
    <AuthCard
      title="Смените пароль"
      subtitle={`${user.name}, это первый вход — замените временный пароль на свой`}
      error={f.error}
      busy={f.busy}
      submitLabel="Сохранить и продолжить"
      onSubmit={f.run(async (v) => {
        if (v.next !== v.repeat) throw new Error('Пароли не совпадают');
        onDone((await api('/api/auth/password', { method: 'POST', body: { current: v.current, next: v.next } })).user);
      })}
    >
      <Field label="Временный пароль" type="password" autoFocus autoComplete="current-password" {...f.bind('current')} />
      <Field label="Новый пароль" type="password" autoComplete="new-password" placeholder="не короче 8 символов" {...f.bind('next')} />
      <Field label="Новый пароль ещё раз" type="password" autoComplete="new-password" {...f.bind('repeat')} />
      <button type="button" className="link-btn auth-alt" onClick={onLogout}>Выйти</button>
    </AuthCard>
  );
}

// После входа сначала загружаем общие данные, чтобы страницы не мелькали пустыми.
function SyncReady({ children }) {
  const [state, setState] = useState('loading');
  const load = useCallback(() => {
    setState('loading');
    initSync().then(
      () => setState('ready'),
      () => setState('error'),
    );
  }, []);
  useEffect(() => {
    load();
    return stopSync;
  }, [load]);
  if (state === 'ready') return children;
  if (state === 'loading') return <div className="auth-screen"><p className="sync-loading">Загружаем данные…</p></div>;
  return (
    <AuthCard
      title="Нет связи с сервером"
      subtitle="Не удалось загрузить данные. Проверьте интернет и попробуйте ещё раз"
      submitLabel="Повторить"
      onSubmit={(e) => {
        e.preventDefault();
        load();
      }}
    />
  );
}

// Пока пользователь не вошёл, приложение не показывается вовсе — только окно входа или приглашения.
export default function AuthGate({ children }) {
  const [user, setUser] = useState(undefined);
  const [invite, setInvite] = useState(inviteToken);

  useEffect(() => {
    api('/api/auth/me').then(
      (d) => setUser(d.user),
      () => setUser(null),
    );
    const expired = () => setUser(null);
    window.addEventListener(AUTH_EXPIRED, expired);
    return () => window.removeEventListener(AUTH_EXPIRED, expired);
  }, []);

  // Уже вошедшему пользователю ссылка-приглашение не нужна.
  useEffect(() => {
    if (user && invite) {
      window.history.replaceState(null, '', '/');
      setInvite(null);
    }
  }, [user, invite]);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  if (user === undefined) return <div className="auth-screen" />;
  if (!user && invite) {
    return (
      <InviteScreen
        token={invite}
        onLogin={(u) => {
          setInvite(null);
          setUser(u);
        }}
      />
    );
  }
  if (!user) return <LoginScreen onLogin={setUser} />;
  if (user.mustChange) return <ForceChangeScreen user={user} onDone={setUser} onLogout={logout} />;
  return <SyncReady key={user.id}>{children({ user, setUser, logout })}</SyncReady>;
}
