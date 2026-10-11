import { useEffect, useState } from 'react';
import { IconClose, IconPlus } from './Icons.jsx';
import PnlAnalysis from './PnlAnalysis.jsx';
import { useShared } from '../sync.js';
import { fmtMoney } from '../utils.js';

const STORAGE_KEY = 'ledger:finmodel:v1';
const EMPTY_MODEL = { revenue: null, blocks: [] };
const uid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Типовая структура — заполняется только по кнопке, цифры можно сразу поправить.
const TEMPLATE = [
  ['Себестоимость', [['Фудкост', 28], ['Себестоимость напитков', 6]]],
  ['Операционные расходы', [['Лейбор кост (ФОТ)', 25], ['Аренда', 10], ['Коммунальные услуги', 3], ['Маркетинг', 3], ['Хозтовары и расходники', 2]]],
  ['Прочие расходы', [['Эквайринг и банк', 2], ['Налоги', 6]]],
];

const fromTemplate = () =>
  TEMPLATE.map(([name, items]) => ({
    id: uid(),
    name,
    items: items.map(([itemName, target]) => ({ id: uid(), name: itemName, target, actual: null })),
  }));

const pct = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const fmtPct = (n) => `${pct.format(n)} %`;
const fmtPp = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${pct.format(Math.abs(n))} п.п.`;

// Ввод чисел: допускаем пробелы и запятую; пустое поле — null.
const parseNum = (s) => {
  const t = String(s).replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const grouped = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const toInput = (n, group) => (n === null || n === undefined ? '' : group ? grouped.format(n) : String(n).replace('.', ','));

const sum = (items, key) => items.reduce((acc, i) => acc + (i[key] ?? 0), 0);
const filled = (i) => i.actual !== null && i.actual !== undefined;

// Факт сравнивается с целью только по статьям, где он внесён.
function factOf(items) {
  const done = items.filter(filled);
  return { done: done.length, count: items.length, actual: sum(done, 'actual'), target: sum(done, 'target') };
}

// Поле с числом: держит черновик текста, в модель пишет только корректное значение.
function NumberInput({ value, onChange, max, placeholder, suffix, className = '', label, group = false }) {
  const [draft, setDraft] = useState(toInput(value, group));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(toInput(value, group));
  }, [value, focused, group]);

  const parsed = parseNum(draft);
  const invalid = parsed === undefined || (max !== undefined && parsed > max);

  return (
    <span className={`num-input ${invalid ? 'is-invalid' : ''} ${className}`}>
      <input
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseNum(e.target.value);
          if (n !== undefined && (max === undefined || n <= max)) onChange(n);
        }}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </span>
  );
}

function Deviation({ target, actual }) {
  if (actual === null || actual === undefined || target === null || target === undefined) {
    return <span className="fin-muted">—</span>;
  }
  const d = actual - target;
  return <span className={`fin-dev ${d > 0.05 ? 'is-over' : d < -0.05 ? 'is-under' : ''}`}>{fmtPp(d)}</span>;
}

export default function FinModelPage() {
  const [rawModel, setModel] = useShared(STORAGE_KEY, EMPTY_MODEL);
  const model = Array.isArray(rawModel?.blocks) ? rawModel : EMPTY_MODEL;
  const [tab, setTab] = useState(() => (model.blocks.length ? 'model' : 'setup'));
  const [confirmBlock, setConfirmBlock] = useState(null);


  const { revenue, blocks } = model;
  const allItems = blocks.flatMap((b) => b.items);
  const totalTarget = sum(allItems, 'target');
  const fact = factOf(allItems);
  const complete = fact.done > 0 && fact.done === fact.count;
  const money = (p) => (revenue ? fmtMoney((revenue * p) / 100) : '—');

  const setBlocks = (fn) => setModel((m) => ({ ...m, blocks: fn(m.blocks) }));
  const updateBlock = (id, patch) => setBlocks((list) => list.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const updateItem = (blockId, itemId, patch) =>
    setBlocks((list) =>
      list.map((b) => (b.id === blockId ? { ...b, items: b.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) } : b)),
    );
  const addItem = (blockId) =>
    setBlocks((list) =>
      list.map((b) => (b.id === blockId ? { ...b, items: [...b.items, { id: uid(), name: '', target: null, actual: null }] } : b)),
    );
  const removeItem = (blockId, itemId) =>
    setBlocks((list) => list.map((b) => (b.id === blockId ? { ...b, items: b.items.filter((i) => i.id !== itemId) } : b)));
  const addBlock = () => setBlocks((list) => [...list, { id: uid(), name: '', items: [{ id: uid(), name: '', target: null, actual: null }] }]);
  // Факт из анализа P&L: доли по статьям и выручка отчётного периода.
  const applyFact = (actuals, reportRevenue) =>
    setModel((m) => ({
      ...m,
      revenue: reportRevenue ?? m.revenue,
      blocks: m.blocks.map((b) => ({
        ...b,
        items: b.items.map((i) => (i.id in actuals ? { ...i, actual: actuals[i.id] } : i)),
      })),
    }));

  const removeBlock = (id) => {
    setBlocks((list) => list.filter((b) => b.id !== id));
    setConfirmBlock(null);
  };

  const summary = (
    <div className="stats fin-stats">
      <section className="stat fin-revenue">
        <div className="stat-label">Выручка за месяц</div>
        <NumberInput
          className="fin-revenue-input"
          value={revenue}
          group
          placeholder="0"
          suffix="₽"
          label="Выручка за месяц"
          onChange={(n) => setModel((m) => ({ ...m, revenue: n }))}
        />
        <div className="stat-sub"><span>От неё считаются все проценты</span></div>
      </section>
      <section className="stat">
        <div className="stat-label">Расходы · цель</div>
        <div className={`stat-value ${totalTarget > 100 ? 'is-neg' : ''}`}>{fmtPct(totalTarget)}</div>
        <div className="stat-sub"><span><b>{money(totalTarget)}</b></span></div>
      </section>
      <section className="stat">
        <div className="stat-label">Прибыль · цель</div>
        <div className={`stat-value ${100 - totalTarget < 0 ? 'is-neg' : ''}`}>{fmtPct(100 - totalTarget)}</div>
        <div className="stat-sub"><span><b>{money(100 - totalTarget)}</b></span></div>
      </section>
      <section className="stat">
        <div className="stat-label">Расходы · факт</div>
        <div className={`stat-value ${fact.done && fact.actual > fact.target ? 'is-neg' : ''}`}>{fact.done ? fmtPct(fact.actual) : '—'}</div>
        <div className="stat-sub">
          {fact.done ? (
            <>
              <span><b>{money(fact.actual)}</b> · <Deviation target={fact.target} actual={fact.actual} /></span>
              {!complete && <span>Заполнено {fact.done} из {fact.count} статей</span>}
            </>
          ) : (
            <span>Внесите факт по статьям</span>
          )}
        </div>
      </section>
      <section className="stat">
        <div className="stat-label">Прибыль · факт</div>
        <div className={`stat-value ${complete && 100 - fact.actual < 0 ? 'is-neg' : ''}`}>{complete ? fmtPct(100 - fact.actual) : '—'}</div>
        <div className="stat-sub">
          <span>{complete ? <b>{money(100 - fact.actual)}</b> : 'Считается, когда внесён факт по всем статьям'}</span>
        </div>
      </section>
    </div>
  );

  const modelView = () => (
    <>
      {summary}
      {totalTarget > 100 && <p className="docs-error">Целевые расходы больше 100 % выручки — модель убыточна</p>}

      <PnlAnalysis model={model} onApplyFact={applyFact} />

      {blocks.map((b) => {
        const t = sum(b.items, 'target');
        const f = factOf(b.items);
        return (
          <section key={b.id} className="fin-block">
            <header className="fin-block-head">
              <h3>{b.name || 'Без названия'}</h3>
              <span className="fin-block-total">
                <b>{fmtPct(t)}</b> · {money(t)}
              </span>
            </header>
            <div className="table-scroll">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Статья</th>
                    <th className="num">Цель</th>
                    <th className="num">Факт</th>
                    <th className="num">Отклонение</th>
                    <th className="num">Цель, ₽</th>
                    <th className="num">Факт, ₽</th>
                  </tr>
                </thead>
                <tbody>
                  {b.items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.name || 'Без названия'}</td>
                      <td className="num">{i.target === null ? '—' : fmtPct(i.target)}</td>
                      <td className="num">
                        <NumberInput
                          className="fin-actual"
                          value={i.actual}
                          max={100}
                          placeholder="—"
                          suffix="%"
                          label={`Факт: ${i.name}`}
                          onChange={(n) => updateItem(b.id, i.id, { actual: n })}
                        />
                      </td>
                      <td className="num"><Deviation target={i.target} actual={i.actual} /></td>
                      <td className="num fin-muted">{i.target === null ? '—' : money(i.target)}</td>
                      <td className="num fin-muted">{filled(i) ? money(i.actual) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>
                      Итого
                      {f.done > 0 && f.done < f.count && <span className="fin-partial">факт по {f.done} из {f.count}</span>}
                    </td>
                    <td className="num">{fmtPct(t)}</td>
                    <td className="num">{f.done ? fmtPct(f.actual) : '—'}</td>
                    <td className="num">{f.done ? <Deviation target={f.target} actual={f.actual} /> : '—'}</td>
                    <td className="num">{money(t)}</td>
                    <td className="num">{f.done ? money(f.actual) : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );

  const setupView = () => (
    <>
      <p className="fin-hint">
        Создайте блоки расходов и статьи внутри них. Целевое значение — доля от выручки в процентах; итог блока считается автоматически.
      </p>
      {blocks.map((b) => {
        const t = sum(b.items, 'target');
        return (
          <section key={b.id} className="fin-block fin-setup">
            <header className="fin-block-head">
              <input
                className="fin-name fin-block-name"
                value={b.name}
                placeholder="Название блока, например Операционные расходы"
                aria-label="Название блока"
                onChange={(e) => updateBlock(b.id, { name: e.target.value })}
              />
              <span className="fin-block-total">Итого <b>{fmtPct(t)}</b></span>
              {confirmBlock === b.id ? (
                <span className="fin-confirm">
                  Удалить блок?
                  <button className="link-btn" onClick={() => setConfirmBlock(null)}>Нет</button>
                  <button className="link-btn fin-danger" onClick={() => removeBlock(b.id)}>Удалить</button>
                </span>
              ) : (
                <button className="link-btn fin-danger" onClick={() => setConfirmBlock(b.id)}>Удалить блок</button>
              )}
            </header>

            <ul className="fin-items">
              {b.items.map((i) => (
                <li key={i.id}>
                  <input
                    className="fin-name"
                    value={i.name}
                    placeholder="Статья, например Фудкост"
                    aria-label="Название статьи"
                    onChange={(e) => updateItem(b.id, i.id, { name: e.target.value })}
                  />
                  <NumberInput
                    className="fin-target"
                    value={i.target}
                    max={100}
                    placeholder="0"
                    suffix="%"
                    label={`Цель: ${i.name}`}
                    onChange={(n) => updateItem(b.id, i.id, { target: n })}
                  />
                  <button className="row-del" aria-label="Удалить статью" onClick={() => removeItem(b.id, i.id)}>
                    <IconClose size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <button className="dish-add" onClick={() => addItem(b.id)}>
              <IconPlus size={16} />
              Добавить статью
            </button>
          </section>
        );
      })}

      <div className="fin-setup-foot">
        <button className="btn btn-outline btn-icon" onClick={addBlock}>
          <IconPlus size={16} />
          Добавить блок
        </button>
        {blocks.length > 0 && (
          <span className="fin-setup-total">
            Все расходы: <b className={totalTarget > 100 ? 'fin-over' : ''}>{fmtPct(totalTarget)}</b> · прибыль {fmtPct(100 - totalTarget)}
          </span>
        )}
      </div>
    </>
  );

  return (
    <>
      <div className="page-head">
        <h1>Анализ отчётности</h1>
      </div>

      <div className="tabs menu-tabs" role="tablist" aria-label="Финансовая модель">
        <button role="tab" aria-selected={tab === 'model'} className={tab === 'model' ? 'is-active' : ''} onClick={() => setTab('model')}>
          Финмодель
        </button>
        <button role="tab" aria-selected={tab === 'setup'} className={tab === 'setup' ? 'is-active' : ''} onClick={() => setTab('setup')}>
          Настройка
        </button>
      </div>

      {blocks.length === 0 ? (
        <div className="menu-empty">
          <p>Финансовая модель пока пустая</p>
          <span>Добавьте блоки и статьи расходов во вкладке «Настройка» или начните с типовой структуры</span>
          <div className="fin-empty-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                setModel((m) => ({ ...m, blocks: fromTemplate() }));
                setTab('setup');
              }}
            >
              Заполнить типовой структурой
            </button>
            <button
              className="btn btn-outline"
              onClick={() => {
                addBlock();
                setTab('setup');
              }}
            >
              Начать с нуля
            </button>
          </div>
        </div>
      ) : tab === 'model' ? (
        modelView()
      ) : (
        setupView()
      )}
    </>
  );
}
