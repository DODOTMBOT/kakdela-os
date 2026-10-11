import { useMemo, useRef, useState } from 'react';
import EditModal from './EditModal.jsx';
import { useEscape } from './Popover.jsx';
import { IconChevronLeft, IconClose, IconEdit, IconPlus } from './Icons.jsx';
import { fmtDay, fmtMoney, plural } from '../utils.js';
import { COLLABS_KEY, EMPTY_COLLABS, KINDS, PHASES, STATUSES, isScheduled, loadCollabs, normalizeCollabs, phaseOf } from '../collabs.js';
import { useShared } from '../sync.js';

const uid = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const KIND_LABEL = Object.fromEntries(KINDS);
const PHASE_LABEL = Object.fromEntries(PHASES);
const NO_PARTNER = '__none__';

const parseBudget = (s) => {
  const t = String(s).replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

function PartnerTag({ partner, onOpen, onRemove }) {
  return (
    <span className={`ptag is-${partner.kind}`}>
      {onOpen ? (
        <button
          type="button"
          className="ptag-name"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(partner.id);
          }}
        >
          {partner.name}
        </button>
      ) : (
        <span className="ptag-name">{partner.name}</span>
      )}
      {onRemove && (
        <button type="button" className="ptag-x" aria-label={`Убрать ${partner.name}`} onClick={onRemove}>
          <IconClose size={12} />
        </button>
      )}
    </span>
  );
}

// Форма коллаборации: партнёров выбираем из списка или создаём по введённому имени.
function CollabModal({ collab, partners, onSave, onDelete, onCreatePartner, onClose }) {
  const [title, setTitle] = useState(collab?.title ?? '');
  const [mechanics, setMechanics] = useState(collab?.mechanics ?? '');
  const [status, setStatus] = useState(collab?.status ?? 'idea');
  const [budget, setBudget] = useState(collab?.budget ?? '');
  const [start, setStart] = useState(collab?.start ?? '');
  const [end, setEnd] = useState(collab?.end ?? '');
  const [partnerIds, setPartnerIds] = useState(collab?.partnerIds ?? []);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const queryRef = useRef(null);
  useEscape(onClose);

  const byId = Object.fromEntries(partners.map((p) => [p.id, p]));
  const q = query.trim().toLowerCase();
  const matches = q
    ? partners.filter((p) => !partnerIds.includes(p.id) && `${p.name} ${p.topic}`.toLowerCase().includes(q)).slice(0, 6)
    : [];
  const exact = partners.some((p) => p.name.toLowerCase() === q);

  const attach = (id) => {
    setPartnerIds((ids) => [...ids, id]);
    setQuery('');
    queryRef.current?.focus();
  };
  const create = (kind) => attach(onCreatePartner({ name: query.trim(), kind }));

  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) return setError('Заполните поле «Название»');
    const b = parseBudget(budget);
    if (b === undefined) return setError('Бюджет — это число в рублях');
    if (status === 'agreed' && !start) return setError('Укажите дату начала — согласованная коллаборация попадает в календарь');
    if (start && end && end < start) return setError('Окончание не может быть раньше начала');
    onSave({ title: title.trim(), mechanics: mechanics.trim(), status, budget: b, partnerIds, start, end: end && end !== start ? end : '' });
  };

  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal collab-modal" role="dialog" aria-modal="true" aria-label="Коллаборация" onSubmit={submit}>
        <header className="modal-head">
          <h2>{collab?.id ? 'Коллаборация' : 'Новая коллаборация'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <IconClose size={18} />
          </button>
        </header>

        <label className="field">
          Название
          <input autoFocus value={title} placeholder="Например, Совместный завтрак с пекарней" onChange={(e) => { setTitle(e.target.value); setError(''); }} />
        </label>
        <label className="field">
          Механика и описание
          <textarea rows={5} value={mechanics} placeholder="Что делаем, как это работает для гостя, что получает партнёр, сроки" onChange={(e) => setMechanics(e.target.value)} />
        </label>

        <div className="field">
          Блогеры и компании <span className="field-hint">— можно не указывать и прикрепить позже</span>
          <div className="ptag-input" onClick={() => queryRef.current?.focus()}>
            {partnerIds.map((id) => byId[id] && (
              <PartnerTag key={id} partner={byId[id]} onRemove={() => setPartnerIds((ids) => ids.filter((x) => x !== id))} />
            ))}
            <input
              ref={queryRef}
              value={query}
              placeholder={partnerIds.length ? 'Добавить ещё' : 'Начните вводить имя или тематику'}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (matches[0]) attach(matches[0].id);
                }
                if (e.key === 'Backspace' && !query && partnerIds.length) setPartnerIds((ids) => ids.slice(0, -1));
              }}
              aria-label="Поиск блогера или компании"
            />
          </div>
          {q && (
            <div className="ptag-suggest">
              {matches.map((p) => (
                <button type="button" key={p.id} onClick={() => attach(p.id)}>
                  <span>{p.name}</span>
                  <small>{[KIND_LABEL[p.kind], p.topic].filter(Boolean).join(' · ')}</small>
                </button>
              ))}
              {!exact && (
                <div className="ptag-create">
                  <button type="button" onClick={() => create('blogger')}>+ Блогер «{query.trim()}»</button>
                  <button type="button" onClick={() => create('company')}>+ Компания «{query.trim()}»</button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid-2">
          <label className="field">
            Статус
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="field">
            Бюджет, ₽
            <input inputMode="decimal" value={budget} placeholder="Не определён" onChange={(e) => { setBudget(e.target.value); setError(''); }} />
          </label>
        </div>

        <div className="grid-2">
          <label className="field">
            Начало
            <input type="date" value={start} onChange={(e) => { setStart(e.target.value); setError(''); }} />
          </label>
          <label className="field">
            Окончание <span className="field-hint">— если несколько дней</span>
            <input type="date" value={end} min={start || undefined} onChange={(e) => { setEnd(e.target.value); setError(''); }} />
          </label>
        </div>
        <p className="field-note">
          {status === 'agreed'
            ? start
              ? 'Будет в календаре на эти даты. С даты начала статус станет «Идёт», после окончания — «Завершена»'
              : 'Для согласованной коллаборации нужна дата начала — она попадёт в календарь'
            : 'В календарь попадёт, когда согласуете'}
        </p>

        {error && <p className="form-error">{error}</p>}

        {confirmDelete ? (
          <footer className="modal-foot modal-confirm">
            <span>Удалить коллаборацию?</span>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>Нет</button>
            <button type="button" className="btn btn-danger" onClick={onDelete}>Удалить</button>
          </footer>
        ) : (
          <footer className="modal-foot">
            {onDelete && (
              <button type="button" className="btn btn-ghost btn-left" onClick={() => setConfirmDelete(true)}>Удалить</button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
            <button type="submit" className="btn btn-primary">Сохранить</button>
          </footer>
        )}
      </form>
    </div>
  );
}

export default function CollabsPage({ focusId }) {
  const [rawData, setData] = useShared(COLLABS_KEY, EMPTY_COLLABS);
  const data = normalizeCollabs(rawData);
  const [tab, setTab] = useState('collabs');
  const [partnerId, setPartnerId] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const [topicFilter, setTopicFilter] = useState(null);
  const [kindFilter, setKindFilter] = useState(null);
  // { kind: 'collab', item?, preset? } | { kind: 'partner', item? }
  const [edit, setEdit] = useState(() => {
    const item = focusId && loadCollabs().collabs.find((c) => c.id === focusId);
    return item ? { kind: 'collab', item } : null;
  });


  const { partners, collabs } = data;
  const byId = useMemo(() => Object.fromEntries(partners.map((p) => [p.id, p])), [partners]);
  const topics = useMemo(
    () => [...new Set(partners.map((p) => p.topic).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')),
    [partners],
  );
  const collabsOf = (id) => collabs.filter((c) => c.partnerIds.includes(id));
  const partner = partnerId && byId[partnerId];

  const openPartner = (id) => {
    setPartnerId(id);
    setTab('partners');
  };

  const createPartner = ({ name, kind }) => {
    const p = { id: uid(), name, kind, topic: '', contacts: '', note: '' };
    setData((d) => ({ ...d, partners: [...d.partners, p] }));
    return p.id;
  };

  const saveCollab = (values) => {
    setData((d) => ({
      ...d,
      collabs: edit.item
        ? d.collabs.map((c) => (c.id === edit.item.id ? { ...c, ...values } : c))
        : [{ id: uid(), created: new Date().toISOString(), ...values }, ...d.collabs],
    }));
    setEdit(null);
  };

  const savePartner = (values) => {
    setData((d) => ({
      ...d,
      partners: edit.item
        ? d.partners.map((p) => (p.id === edit.item.id ? { ...p, ...values } : p))
        : [...d.partners, { id: uid(), ...values }],
    }));
    setEdit(null);
  };

  const removeCollab = () => {
    setData((d) => ({ ...d, collabs: d.collabs.filter((c) => c.id !== edit.item.id) }));
    setEdit(null);
  };

  // Коллаборации остаются — просто без этого партнёра.
  const removePartner = () => {
    const id = edit.item.id;
    setData((d) => ({
      partners: d.partners.filter((p) => p.id !== id),
      collabs: d.collabs.map((c) => ({ ...c, partnerIds: c.partnerIds.filter((x) => x !== id) })),
    }));
    setPartnerId(null);
    setEdit(null);
  };

  const card = (c) => (
    <article key={c.id} className="collab" role="button" tabIndex={0} onClick={() => setEdit({ kind: 'collab', item: c })} onKeyDown={(e) => e.key === 'Enter' && setEdit({ kind: 'collab', item: c })}>
      <header>
        <span className={`collab-status is-${phaseOf(c)}`}>{PHASE_LABEL[phaseOf(c)]}</span>
        {c.budget !== null && c.budget !== undefined && <span className="collab-budget">{fmtMoney(c.budget)}</span>}
      </header>
      {c.start && (
        <span className={`collab-dates ${isScheduled(c) ? 'in-cal' : ''}`}>
          {c.end ? `${fmtDay(c.start)} — ${fmtDay(c.end)}` : fmtDay(c.start)}
          {isScheduled(c) && ' · в календаре'}
        </span>
      )}
      <h3>{c.title}</h3>
      {c.mechanics && <p>{c.mechanics}</p>}
      <div className="collab-partners">
        {c.partnerIds.length ? (
          c.partnerIds.map((id) => byId[id] && <PartnerTag key={id} partner={byId[id]} onOpen={openPartner} />)
        ) : (
          <span className="collab-nopartner">Партнёр не выбран</span>
        )}
      </div>
    </article>
  );

  const collabsView = () => {
    const unassigned = collabs.filter((c) => !c.partnerIds.length).length;
    const list = collabs.filter((c) =>
      statusFilter === NO_PARTNER ? !c.partnerIds.length : !statusFilter || phaseOf(c) === statusFilter,
    );
    return (
      <>
        {collabs.length > 0 && (
          <div className="task-filters">
            {[[null, 'Все'], ...PHASES].map(([v, l]) => (
              <button key={v ?? 'all'} className={`cal-type ${statusFilter === v ? 'is-current' : ''}`} onClick={() => setStatusFilter(v)}>
                {l}
                <span className="chip-count">{v ? collabs.filter((c) => phaseOf(c) === v).length : collabs.length}</span>
              </button>
            ))}
            {unassigned > 0 && (
              <button className={`cal-type chip-warn ${statusFilter === NO_PARTNER ? 'is-current' : ''}`} onClick={() => setStatusFilter(NO_PARTNER)}>
                Без партнёра
                <span className="chip-count">{unassigned}</span>
              </button>
            )}
          </div>
        )}
        {collabs.length === 0 ? (
          <div className="menu-empty">
            <p>Пока нет ни одной коллаборации</p>
            <span>Опишите механику, а блогера или компанию можно прикрепить сразу или позже</span>
          </div>
        ) : list.length === 0 ? (
          <div className="menu-empty"><p>Под этот фильтр ничего не подходит</p></div>
        ) : (
          <div className="collabs">{list.map(card)}</div>
        )}
      </>
    );
  };

  const partnersView = () => {
    const list = partners
      .filter((p) => (!topicFilter || p.topic === topicFilter) && (!kindFilter || p.kind === kindFilter))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return (
      <>
        {partners.length > 0 && (
          <div className="task-filters">
            {[[null, 'Все'], ...KINDS].map(([v, l]) => (
              <button key={v ?? 'all'} className={`cal-type ${kindFilter === v ? 'is-current' : ''}`} onClick={() => setKindFilter(v)}>
                {l}
              </button>
            ))}
            {topics.length > 0 && <span className="chip-sep" />}
            {topics.map((t) => (
              <button key={t} className={`cal-type ${topicFilter === t ? 'is-current' : ''}`} onClick={() => setTopicFilter(topicFilter === t ? null : t)}>
                #{t}
              </button>
            ))}
          </div>
        )}
        {partners.length === 0 ? (
          <div className="menu-empty">
            <p>Пока нет блогеров и компаний</p>
            <span>Добавьте их здесь или прямо в форме коллаборации</span>
          </div>
        ) : list.length === 0 ? (
          <div className="menu-empty"><p>Под этот фильтр никто не подходит</p></div>
        ) : (
          <div className="partners">
            {list.map((p) => {
              const n = collabsOf(p.id).length;
              return (
                <button key={p.id} className={`partner is-${p.kind}`} onClick={() => setPartnerId(p.id)}>
                  <span className="partner-kind">{KIND_LABEL[p.kind]}</span>
                  <span className="partner-name">{p.name}</span>
                  {p.topic && <span className="partner-topic">#{p.topic}</span>}
                  <span className="partner-count">{n ? `${n} ${plural(n, ['коллаборация', 'коллаборации', 'коллабораций'])}` : 'Нет коллабораций'}</span>
                </button>
              );
            })}
          </div>
        )}
      </>
    );
  };

  const partnerView = (p) => {
    const list = collabsOf(p.id);
    return (
      <>
        <button className="menu-back" onClick={() => setPartnerId(null)}>
          <IconChevronLeft size={16} />
          Блогеры и компании
        </button>
        <div className="menu-toolbar">
          <h2>{p.name}</h2>
          <span className={`menu-pill partner-pill is-${p.kind}`}>{KIND_LABEL[p.kind]}</span>
          {p.topic && (
            <button className="menu-pill partner-topic-pill" onClick={() => { setTopicFilter(p.topic); setPartnerId(null); }}>
              #{p.topic}
            </button>
          )}
          <button className="icon-btn" aria-label="Изменить" onClick={() => setEdit({ kind: 'partner', item: p })}>
            <IconEdit size={16} />
          </button>
          <div className="menu-toolbar-actions">
            <button className="btn btn-outline btn-icon" onClick={() => setEdit({ kind: 'collab', preset: [p.id] })}>
              <IconPlus size={16} />
              Коллаборация с {p.kind === 'blogger' ? 'блогером' : 'компанией'}
            </button>
          </div>
        </div>
        {(p.contacts || p.note) && (
          <div className="partner-info">
            {p.contacts && <p><b>Контакты:</b> {p.contacts}</p>}
            {p.note && <p>{p.note}</p>}
          </div>
        )}
        <h3 className="pnl-subtitle">
          {list.length ? `${list.length} ${plural(list.length, ['коллаборация', 'коллаборации', 'коллабораций'])}` : 'Коллабораций пока нет'}
        </h3>
        {list.length > 0 && <div className="collabs">{list.map(card)}</div>}
      </>
    );
  };

  const partnerFields = [
    { name: 'name', label: 'Имя или название', required: true, placeholder: 'Например, @coffee_lover или Пекарня «Хлеб»' },
    { name: 'kind', label: 'Тип', options: KINDS, row: 'kind' },
    { name: 'topic', label: 'Тематика', placeholder: 'Еда, кофе, лайфстайл…', suggestions: topics, row: 'kind' },
    { name: 'contacts', label: 'Контакты', placeholder: 'Ссылка, телефон, менеджер' },
    { name: 'note', label: 'Заметка', textarea: true, placeholder: 'Аудитория, охваты, стоимость, условия' },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Коллаборации</h1>
        <div className="docs-actions">
          {tab === 'partners' && !partner && (
            <button className="btn btn-outline btn-icon" onClick={() => setEdit({ kind: 'partner' })}>
              <IconPlus size={16} />
              Блогер или компания
            </button>
          )}
          <button className="btn btn-primary btn-icon" onClick={() => setEdit({ kind: 'collab' })}>
            <IconPlus size={16} />
            Новая коллаборация
          </button>
        </div>
      </div>

      <div className="tabs menu-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'collabs'} className={tab === 'collabs' ? 'is-active' : ''} onClick={() => { setTab('collabs'); setPartnerId(null); }}>
          Коллаборации
          <span>{collabs.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'partners'} className={tab === 'partners' ? 'is-active' : ''} onClick={() => { setTab('partners'); setPartnerId(null); }}>
          Блогеры и компании
          <span>{partners.length}</span>
        </button>
      </div>

      {tab === 'collabs' ? collabsView() : partner ? partnerView(partner) : partnersView()}

      {edit?.kind === 'collab' && (
        <CollabModal
          collab={edit.item ?? (edit.preset ? { partnerIds: edit.preset } : null)}
          partners={partners}
          onSave={saveCollab}
          onDelete={edit.item ? removeCollab : undefined}
          onCreatePartner={createPartner}
          onClose={() => setEdit(null)}
        />
      )}
      {edit?.kind === 'partner' && (
        <EditModal
          title={edit.item ? edit.item.name : 'Блогер или компания'}
          fields={partnerFields}
          initial={edit.item ?? { kind: 'blogger' }}
          onSave={savePartner}
          onDelete={edit.item ? removePartner : undefined}
          deleteHint={
            edit.item && collabsOf(edit.item.id).length
              ? 'Удалить? Коллаборации останутся, но без этого партнёра'
              : 'Удалить?'
          }
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}
