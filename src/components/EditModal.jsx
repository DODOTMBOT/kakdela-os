import { useState } from 'react';
import { useEscape } from './Popover.jsx';
import { IconClose } from './Icons.jsx';

// Универсальная форма для меню, категорий и блюд.
// fields: [{ name, label, placeholder, required, textarea, inputMode, type, options: [[value, label]],
//            show(values) — показывать ли поле, row — поля с одинаковым row встают в одну строку,
//            suggestions — варианты-подсказки для текстового поля,
//            render(value, set) — своё поле вместо стандартного }]
// validate(values) возвращает текст ошибки или ничего. Скрытые поля в onSave не попадают.
// onSave может быть асинхронным: если он бросит ошибку, её текст покажется в форме.
function groupRows(fields) {
  const groups = [];
  for (const f of fields) {
    const last = groups.at(-1);
    if (f.row && last?.[0].row === f.row) last.push(f);
    else groups.push([f]);
  }
  return groups;
}

export default function EditModal({
  title,
  fields,
  initial = {},
  validate,
  onSave,
  onDelete,
  deleteHint,
  submitLabel = 'Сохранить',
  onClose,
}) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((f) => [f.name, initial[f.name] ?? f.options?.[0]?.[0] ?? ''])),
  );
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  useEscape(onClose);

  const set = (name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    setError('');
  };

  const shown = fields.filter((f) => !f.show || f.show(values));

  const submit = (e) => {
    e.preventDefault();
    const missing = shown.find((f) => f.required && !String(values[f.name]).trim());
    if (missing) return setError(`Заполните поле «${missing.label}»`);
    const out = Object.fromEntries(shown.map((f) => [f.name, String(values[f.name]).trim()]));
    const invalid = validate?.(out);
    if (invalid) return setError(invalid);
    const pending = onSave(out);
    if (pending?.then) {
      setBusy(true);
      pending.catch((err) => setError(err.message || 'Не удалось сохранить')).finally(() => setBusy(false));
    }
  };

  const renderField = (f) => (
    f.render ? (
      <div key={f.name} className="field">
        {f.label}
        {f.render(values[f.name], (v) => set(f.name, v))}
      </div>
    ) : (
    <label key={f.name} className="field">
      {f.label}
      {f.options ? (
        <select value={values[f.name]} onChange={(e) => set(f.name, e.target.value)}>
          {f.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      ) : f.textarea ? (
        <textarea
          rows={3}
          placeholder={f.placeholder}
          value={values[f.name]}
          onChange={(e) => set(f.name, e.target.value)}
        />
      ) : (
        <input
          autoFocus={f === shown[0]}
          list={f.suggestions?.length ? `${f.name}-suggestions` : undefined}
          type={f.type}
          inputMode={f.inputMode}
          placeholder={f.placeholder}
          value={values[f.name]}
          onChange={(e) => set(f.name, e.target.value)}
        />
      )}
      {f.suggestions?.length > 0 && (
        <datalist id={`${f.name}-suggestions`}>
          {f.suggestions.map((v) => <option key={v} value={v} />)}
        </datalist>
      )}
    </label>
    )
  );

  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" role="dialog" aria-modal="true" aria-label={title} onSubmit={submit}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconClose size={18} />
          </button>
        </header>

        {groupRows(shown).map((group) =>
          group.length > 1 ? (
            <div key={group[0].name} className={group.length > 2 ? 'grid-3' : 'grid-2'}>
              {group.map((f) => renderField(f))}
            </div>
          ) : (
            renderField(group[0])
          ),
        )}

        {error && <p className="form-error">{error}</p>}

        {confirmDelete ? (
          <footer className="modal-foot modal-confirm">
            <span>{deleteHint ?? 'Удалить без возможности восстановления?'}</span>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Нет</button>
            <button type="button" className="btn btn-danger" onClick={onDelete}>Удалить</button>
          </footer>
        ) : (
          <footer className="modal-foot">
            {onDelete && (
              <button type="button" className="btn btn-ghost btn-left" onClick={() => setConfirmDelete(true)}>
                Удалить
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Сохраняем…' : submitLabel}</button>
          </footer>
        )}
      </form>
    </div>
  );
}
