import { useMemo, useState } from 'react';
import { useShared } from '../sync.js';
import { useEscape } from './Popover.jsx';
import { IconClose } from './Icons.jsx';
import { fmtMoney, plural } from '../utils.js';

// Проработка и тесты: новые блюда до попадания в меню. Сотрудник описывает блюдо и состав
// (какие ингредиенты новые, какие уже есть), указывает примерную цену и себестоимость;
// руководитель подтверждает или отклоняет. Решение принимает только руководитель — это
// проверяет сервер (server/rules.js), автору приходит оповещение.
//
// Блюдо: { id, title, description, ingredients: [{ id, name, amount, isNew, cost }], price, cost,
//          status: 'review' | 'approved' | 'rejected', decision: { byId, byName, at, note } | null,
//          createdAt/ById/ByName, updatedAt }.

export const DISH_LAB_KEY = 'ledger:dish-lab:v1';

const STAGES = [
  ['review', 'На согласовании'],
  ['approved', 'Согласовано'],
  ['rejected', 'Отклонено'],
];
const STAGE_LABEL = Object.fromEntries(STAGES);

const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const canDecide = (user) => user.role === 'admin' || user.role === 'manager';
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '');

const ingredientsCost = (list) => {
  const costs = list.map((i) => num(i.cost)).filter((c) => c !== null);
  return costs.length ? costs.reduce((a, b) => a + b, 0) : null;
};
const foodCost = (d) => (num(d.price) && num(d.cost) !== null ? Math.round((num(d.cost) / num(d.price)) * 100) : null);

const emptyIngredient = () => ({ id: uid('g'), name: '', amount: '', isNew: false, cost: '' });

function DishForm({ dish, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState(dish?.title ?? '');
  const [description, setDescription] = useState(dish?.description ?? '');
  const [ingredients, setIngredients] = useState(() =>
    dish?.ingredients?.length ? dish.ingredients.map((i) => ({ ...i, cost: i.cost ?? '' })) : [emptyIngredient(), emptyIngredient()],
  );
  const [price, setPrice] = useState(dish?.price ?? '');
  const [cost, setCost] = useState(dish?.cost ?? '');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEscape(onClose);

  const setIng = (id, patch) => setIngredients((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const sum = ingredientsCost(ingredients);
  const fc = foodCost({ price, cost });

  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) return setError('Укажите название блюда');
    const list = ingredients.map((i) => ({ ...i, name: i.name.trim(), amount: i.amount.trim(), cost: num(i.cost) })).filter((i) => i.name);
    if (!list.length) return setError('Добавьте хотя бы один ингредиент');
    if ([price, cost].some((v) => v !== '' && (num(v) === null || num(v) < 0))) return setError('Стоимость и себестоимость — положительные числа');
    onSave({ title: title.trim(), description: description.trim(), ingredients: list, price: num(price), cost: num(cost) });
  };

  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal dl-modal" role="dialog" aria-modal="true" aria-label="Блюдо" onSubmit={submit}>
        <header className="modal-head">
          <h2>{dish ? 'Блюдо' : 'Новое блюдо'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconClose size={18} />
          </button>
        </header>

        <label className="field">
          Название
          <input autoFocus={!dish} value={title} placeholder="Например, Тыквенный латте с халвой" onChange={(e) => (setTitle(e.target.value), setError(''))} />
        </label>
        <label className="field">
          Описание
          <textarea rows={2} value={description} placeholder="Идея, подача, для какого меню" onChange={(e) => setDescription(e.target.value)} />
        </label>

        <div className="field">
          Состав
          <div className="dl-ings">
            <div className="dl-ing dl-ing-head" aria-hidden="true">
              <span>Ингредиент</span>
              <span>Количество</span>
              <span>Наличие</span>
              <span>Стоимость, ₽</span>
              <span />
            </div>
            {ingredients.map((i) => (
              <div key={i.id} className="dl-ing">
                <input className="std-input dl-ing-name" placeholder="Например, халва" value={i.name} onChange={(e) => setIng(i.id, { name: e.target.value })} aria-label="Ингредиент" />
                <input className="std-input dl-ing-amount" placeholder="30 г" value={i.amount} onChange={(e) => setIng(i.id, { amount: e.target.value })} aria-label="Количество" />
                <div className="dl-switch" role="radiogroup" aria-label="Наличие">
                  <button type="button" className={!i.isNew ? 'is-on' : ''} aria-pressed={!i.isNew} onClick={() => setIng(i.id, { isNew: false })}>
                    Есть
                  </button>
                  <button type="button" className={i.isNew ? 'is-on is-new' : ''} aria-pressed={i.isNew} onClick={() => setIng(i.id, { isNew: true })}>
                    Новый
                  </button>
                </div>
                <input className="std-input dl-ing-cost" inputMode="decimal" placeholder="Стоимость, ₽" value={i.cost} onChange={(e) => setIng(i.id, { cost: e.target.value.replace(',', '.') })} aria-label="Стоимость в блюде" />
                <button type="button" className="link-btn dl-ing-del" disabled={ingredients.length <= 1} onClick={() => setIngredients((l) => l.filter((x) => x.id !== i.id))} aria-label="Убрать ингредиент">
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="link-btn dl-add-ing" onClick={() => setIngredients((l) => [...l, emptyIngredient()])}>
              + Ингредиент
            </button>
          </div>
        </div>

        <div className="grid-2">
          <label className="field">
            Примерная стоимость, ₽
            <input inputMode="decimal" placeholder="Цена в меню" value={price ?? ''} onChange={(e) => setPrice(e.target.value.replace(',', '.'))} />
          </label>
          <label className="field">
            Себестоимость, ₽
            <input inputMode="decimal" placeholder={sum !== null ? `по составу ${sum}` : 'Затраты на порцию'} value={cost ?? ''} onChange={(e) => setCost(e.target.value.replace(',', '.'))} />
          </label>
        </div>
        <p className="field-note">
          {sum !== null && (
            <>
              По составу: {fmtMoney(sum)}{' '}
              {num(cost) !== sum && (
                <button type="button" className="link-btn" onClick={() => setCost(String(sum))}>
                  подставить
                </button>
              )}
              {' · '}
            </>
          )}
          {fc !== null ? `Фудкост ${fc}%` : 'Фудкост посчитается по цене и себестоимости'}
        </p>

        {error && <p className="form-error">{error}</p>}

        {confirm ? (
          <footer className="modal-foot modal-confirm">
            <span>Удалить блюдо?</span>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>Нет</button>
            <button type="button" className="btn btn-danger" onClick={onDelete}>Удалить</button>
          </footer>
        ) : (
          <footer className="modal-foot">
            {onDelete && (
              <button type="button" className="btn btn-ghost btn-left" onClick={() => setConfirm(true)}>
                Удалить
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
            <button type="submit" className="btn btn-primary">{dish ? 'Сохранить' : 'Отправить на согласование'}</button>
          </footer>
        )}
      </form>
    </div>
  );
}

function DishRow({ dish, user, open, onToggle, onEdit, onDecide }) {
  const [note, setNote] = useState('');
  const newCount = dish.ingredients.filter((i) => i.isNew).length;
  const fc = foodCost(dish);
  const decider = canDecide(user);
  return (
    <li className={open ? 'is-open' : ''}>
      <button className="dl-row" onClick={onToggle} aria-expanded={open}>
        <span className="dl-row-main">
          <span className="dl-row-title">{dish.title}</span>
          <span className="dl-row-sub">
            {dish.ingredients.length} {plural(dish.ingredients.length, ['ингредиент', 'ингредиента', 'ингредиентов'])}
            {newCount > 0 && <b className="dl-new"> · {newCount} {plural(newCount, ['новый', 'новых', 'новых'])}</b>}
            {dish.createdByName && ` · ${dish.createdByName}`}
            {` · ${fmtDate(dish.createdAt)}`}
          </span>
        </span>
        <span className="dl-row-nums">
          <span>
            <small>Цена</small>
            {dish.price !== null ? fmtMoney(dish.price) : '—'}
          </span>
          <span>
            <small>Себест.</small>
            {dish.cost !== null ? fmtMoney(dish.cost) : '—'}
          </span>
          <span>
            <small>Фудкост</small>
            {fc !== null ? `${fc}%` : '—'}
          </span>
        </span>
      </button>

      {open && (
        <div className="dl-detail">
          {dish.description && <p className="dl-desc">{dish.description}</p>}
          <table className="dl-table">
            <thead>
              <tr>
                <th>Ингредиент</th>
                <th>Количество</th>
                <th>Наличие</th>
                <th className="dl-num">Стоимость</th>
              </tr>
            </thead>
            <tbody>
              {dish.ingredients.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td>{i.amount || '—'}</td>
                  <td>{i.isNew ? <span className="dl-tag is-new">новый</span> : <span className="dl-tag">есть</span>}</td>
                  <td className="dl-num">{i.cost !== null && i.cost !== undefined ? fmtMoney(i.cost) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {dish.decision && (
            <p className={`dl-decision is-${dish.status}`}>
              {dish.status === 'approved' ? 'Согласовано' : 'Отклонено'} · {dish.decision.byName}, {fmtDate(dish.decision.at)}
              {dish.decision.note && <span>«{dish.decision.note}»</span>}
            </p>
          )}

          <div className="dl-actions">
            {(decider || dish.createdById === user.id) && (dish.status === 'review' || decider) && (
              <button className="link-btn" onClick={onEdit}>
                Изменить
              </button>
            )}
            {decider &&
              (dish.status === 'review' ? (
                <>
                  <input className="std-input dl-note" placeholder="Комментарий к решению (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <button className="btn btn-outline dl-reject" onClick={() => onDecide('rejected', note)}>
                    Отклонить
                  </button>
                  <button className="btn btn-primary" onClick={() => onDecide('approved', note)}>
                    Подтвердить
                  </button>
                </>
              ) : (
                <button className="btn btn-outline" onClick={() => onDecide('review', '')}>
                  Вернуть на согласование
                </button>
              ))}
          </div>
        </div>
      )}
    </li>
  );
}

export default function DishLabPage({ user }) {
  const [raw, setDishes] = useShared(DISH_LAB_KEY, []);
  const dishes = useMemo(() => (Array.isArray(raw) ? raw : []), [raw]);
  const [stage, setStage] = useState('review');
  const [openId, setOpenId] = useState(null);
  const [edit, setEdit] = useState(null); // null | 'new' | dish

  const counts = Object.fromEntries(STAGES.map(([s]) => [s, dishes.filter((d) => d.status === s).length]));
  const shown = dishes
    .filter((d) => d.status === stage)
    .sort((a, b) => ((stage === 'review' ? b.createdAt : b.decision?.at) || '').localeCompare((stage === 'review' ? a.createdAt : a.decision?.at) || ''));

  const save = (data) => {
    const now = new Date().toISOString();
    if (edit === 'new') {
      const d = { id: uid('d'), ...data, status: 'review', decision: null, createdAt: now, createdById: user.id, createdByName: user.name, updatedAt: now };
      setDishes((list) => [d, ...(Array.isArray(list) ? list : [])]);
      setStage('review');
      setOpenId(d.id);
    } else {
      setDishes((list) => list.map((d) => (d.id === edit.id ? { ...d, ...data, updatedAt: now } : d)));
    }
    setEdit(null);
  };

  const decide = (id, status, note) => {
    const now = new Date().toISOString();
    setDishes((list) =>
      list.map((d) =>
        d.id === id
          ? { ...d, status, decision: status === 'review' ? null : { byId: user.id, byName: user.name, at: now, note: note.trim() }, updatedAt: now }
          : d,
      ),
    );
    setOpenId(null);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <span className="rv-crumb">Меню</span>
          <h1>Проработка и тесты</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setEdit('new')}>
          Новое блюдо
        </button>
      </div>

      <div className="tabs menu-tabs" role="tablist" aria-label="Стадии">
        {STAGES.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={stage === id} className={stage === id ? 'is-active' : ''} onClick={() => setStage(id)}>
            {label}
            <span>{counts[id]}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="menu-empty">
          <p>{stage === 'review' ? 'На согласовании ничего нет' : stage === 'approved' ? 'Согласованных блюд пока нет' : 'Отклонённых блюд нет'}</p>
          <span>{stage === 'review' ? 'Опишите новое блюдо и состав — руководитель подтвердит или отклонит его' : 'Сюда попадают блюда после решения руководителя'}</span>
        </div>
      ) : (
        <ul className="dl-list">
          {shown.map((d) => (
            <DishRow
              key={d.id}
              dish={d}
              user={user}
              open={openId === d.id}
              onToggle={() => setOpenId(openId === d.id ? null : d.id)}
              onEdit={() => setEdit(d)}
              onDecide={(status, note) => decide(d.id, status, note)}
            />
          ))}
        </ul>
      )}

      {edit && (
        <DishForm
          dish={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSave={save}
          onDelete={
            edit !== 'new' && (canDecide(user) || edit.createdById === user.id)
              ? () => {
                  setDishes((list) => list.filter((d) => d.id !== edit.id));
                  setEdit(null);
                }
              : undefined
          }
        />
      )}
    </>
  );
}

export { STAGE_LABEL };
