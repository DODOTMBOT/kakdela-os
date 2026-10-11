import { useEffect, useRef, useState } from 'react';
import { initials } from '../api.js';
import { roleLabel } from '../access.js';

const describe = (u) => [u.position, roleLabel(u.role)].filter(Boolean).join(' · ');

// Совпадение по началу любого слова в имени: «ан пе» найдёт «Анна Петрова».
function matches(user, query) {
  const words = user.name.toLowerCase().split(/\s+/);
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((q) => words.some((w) => w.startsWith(q)));
}

// Выбор человека из списка с поиском по имени и фамилии.
export default function UserPicker({ value, users, onChange, allowEmpty = false, disabled = false, placeholder = 'Не назначено', className = '' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const selected = users.find((u) => u.id === value);

  // Пока идёт поиск, «Не назначено» не показываем — Enter выбирает первое совпадение.
  const searching = Boolean(query.trim());
  const options = [...(allowEmpty && !searching ? [null] : []), ...users.filter((u) => !searching || matches(u, query))];

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !rootRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const pick = (u) => {
    onChange(u?.id ?? '');
    setOpen(false);
    setQuery('');
  };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (options[active] !== undefined) pick(options[active]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className={`upick ${disabled ? 'is-disabled' : ''} ${className}`} ref={rootRef}>
      <button
        type="button"
        className="upick-value"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setActive(0);
        }}
      >
        {selected ? (
          <>
            <i className="upick-avatar">{initials(selected.name)}</i>
            <span className="upick-name">{selected.name}</span>
          </>
        ) : (
          <span className="upick-placeholder">{value ? 'Пользователь удалён' : placeholder}</span>
        )}
      </button>
      {open && (
        <div className="upick-pop">
          <input
            autoFocus
            className="upick-search"
            placeholder="Поиск по имени и фамилии"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            aria-label="Поиск по имени и фамилии"
          />
          <ul className="upick-list" role="listbox">
            {options.length === 0 && <li className="upick-empty">Никого не нашлось</li>}
            {options.map((u, i) => (
              <li key={u?.id ?? 'none'}>
                <button
                  type="button"
                  role="option"
                  aria-selected={(u?.id ?? '') === (value ?? '')}
                  className={`upick-option ${i === active ? 'is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(u)}
                >
                  {u ? (
                    <>
                      <i className="upick-avatar">{initials(u.name)}</i>
                      <span className="upick-text">
                        <span>{u.name}</span>
                        <small>{describe(u)}</small>
                      </span>
                    </>
                  ) : (
                    <span className="upick-text">
                      <span>Не назначено</span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
