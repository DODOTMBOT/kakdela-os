import { useState } from 'react';
import EditModal from './EditModal.jsx';
import { IconChevronLeft, IconEdit, IconPlus } from './Icons.jsx';
import { fmtMoney, plural } from '../utils.js';
import { MENUS_KEY, fmtPeriod, menuStatus, normalizeMenus, statusText, todayIso } from '../menus.js';
import { useShared } from '../sync.js';

const uid = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ARCHIVE = 'archive';

const NAME_FIELD = { name: 'name', label: 'Название', required: true };
const DATE_FIELDS = [
  { name: 'start', label: 'Начало', type: 'date', row: 'dates' },
  { name: 'end', label: 'Окончание', type: 'date', row: 'dates' },
];
const isExtra = (v) => v.type === 'extra';

const FORMS = {
  category: [{ ...NAME_FIELD, placeholder: 'Например, Салаты' }],
  dish: [
    { ...NAME_FIELD, placeholder: 'Например, Цезарь с курицей' },
    { name: 'price', label: 'Цена, ₽', placeholder: '0', inputMode: 'decimal' },
    { name: 'weight', label: 'Выход', placeholder: 'Например, 250 г' },
    { name: 'description', label: 'Описание', placeholder: 'Состав, подача', textarea: true },
  ],
  archive: DATE_FIELDS,
};
const TITLES = {
  menu: ['Новое меню', 'Меню'],
  category: ['Новая категория', 'Категория'],
  dish: ['Новое блюдо', 'Блюдо'],
  archive: ['В архив', 'В архив'],
};
const DELETE_HINTS = {
  category: 'Удалить категорию со всеми блюдами?',
  dish: 'Удалить блюдо?',
};

const validateDates = (v) => {
  if (!v.start || !v.end) return 'Укажите даты начала и окончания';
  if (v.end < v.start) return 'Окончание не может быть раньше начала';
  return null;
};

const parsePrice = (s) => {
  const n = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return s !== '' && n >= 0 ? n : null;
};

const byStart = (a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name, 'ru');

function StatusPill({ menu }) {
  const status = menu.archived ? 'archived' : menuStatus(menu);
  return <span className={`menu-pill is-${status}`}>{menu.archived ? 'В архиве' : statusText(menu)}</span>;
}

export default function MenuPage({ focusId }) {
  const [rawMenus, setMenus] = useShared(MENUS_KEY, []);
  const menus = normalizeMenus(rawMenus);
  const [activeId, setActiveId] = useState(focusId ?? null);
  // { kind: 'menu' | 'category' | 'dish' | 'archive', categoryId?, item?, initial? }
  const [edit, setEdit] = useState(null);


  const mains = menus.filter((m) => m.type === 'main');
  const byId = Object.fromEntries(menus.map((m) => [m.id, m]));
  const extrasOf = (id) => menus.filter((m) => m.type === 'extra' && m.parentId === id && !m.archived).sort(byStart);
  const archived = menus.filter((m) => m.type === 'extra' && m.archived).sort((a, b) => byStart(b, a));

  const isArchive = activeId === ARCHIVE;
  const active = isArchive ? null : byId[activeId] ?? mains[0];
  const tabId = isArchive ? ARCHIVE : active?.type === 'extra' ? (active.archived ? ARCHIVE : active.parentId) : active?.id;

  const updateMenu = (id, fn) => setMenus((list) => list.map((m) => (m.id === id ? fn(m) : m)));
  const updateCategory = (categoryId, fn) =>
    updateMenu(active.id, (m) => ({ ...m, categories: m.categories.map((c) => (c.id === categoryId ? fn(c) : c)) }));

  const menuFields = (item) => {
    const parents = mains.filter((m) => m.id !== item?.id);
    const fields = [{ ...NAME_FIELD, placeholder: 'Например, Осеннее меню' }];
    if (parents.length) {
      fields.push(
        {
          name: 'type',
          label: 'Тип',
          options: [
            ['main', 'Основное меню'],
            ['extra', 'Дополнительное — прикрепить к основному'],
          ],
        },
        { name: 'parentId', label: 'Основное меню', options: parents.map((m) => [m.id, m.name]), show: isExtra },
        ...DATE_FIELDS.map((f) => ({ ...f, show: isExtra })),
      );
    }
    return fields;
  };

  const validateMenu = (v) => {
    if (!isExtra(v)) return null;
    if (edit.item && extrasOf(edit.item.id).length) {
      return 'К этому меню прикреплены дополнительные — сначала открепите или удалите их';
    }
    return validateDates(v);
  };

  const save = (values) => {
    const { kind, categoryId, item } = edit;
    if (kind === 'menu') {
      const fields = isExtra(values)
        ? { name: values.name, type: 'extra', parentId: values.parentId, start: values.start, end: values.end }
        : { name: values.name, type: 'main', parentId: undefined, start: undefined, end: undefined, archived: false };
      if (item) updateMenu(item.id, (m) => ({ ...m, ...fields }));
      else {
        const id = uid();
        setMenus((list) => [...list, { id, archived: false, categories: [], ...fields }]);
        setActiveId(id);
      }
    } else if (kind === 'archive') {
      updateMenu(item.id, (m) => ({ ...m, start: values.start, end: values.end, archived: true }));
    } else if (kind === 'category') {
      updateMenu(active.id, (m) => ({
        ...m,
        categories: item
          ? m.categories.map((c) => (c.id === item.id ? { ...c, name: values.name } : c))
          : [...m.categories, { id: uid(), name: values.name, dishes: [] }],
      }));
    } else {
      const dish = { ...values, price: parsePrice(values.price) };
      updateCategory(categoryId, (c) => ({
        ...c,
        dishes: item ? c.dishes.map((d) => (d.id === item.id ? { ...d, ...dish } : d)) : [...c.dishes, { id: uid(), ...dish }],
      }));
    }
    setEdit(null);
  };

  const remove = () => {
    const { kind, categoryId, item } = edit;
    if (kind === 'menu') {
      setMenus((list) => list.filter((m) => m.id !== item.id && m.parentId !== item.id));
      setActiveId(item.type === 'extra' ? (item.archived ? ARCHIVE : item.parentId) : null);
    } else if (kind === 'category') {
      updateMenu(active.id, (m) => ({ ...m, categories: m.categories.filter((c) => c.id !== item.id) }));
    } else {
      updateCategory(categoryId, (c) => ({ ...c, dishes: c.dishes.filter((d) => d.id !== item.id) }));
    }
    setEdit(null);
  };

  const unarchive = (menu) => updateMenu(menu.id, (m) => ({ ...m, archived: false }));
  const toArchive = (menu) => setEdit({ kind: 'archive', item: menu });

  const newMenu = (initial) => setEdit({ kind: 'menu', initial });

  const modalProps = () => {
    const { kind, item, initial } = edit;
    if (kind === 'menu') {
      const extras = item ? extrasOf(item.id).length : 0;
      return {
        fields: menuFields(item),
        initial: item ?? initial ?? {},
        validate: validateMenu,
        deleteHint: extras
          ? `Удалить меню вместе с ${extras} ${plural(extras, ['дополнительным', 'дополнительными', 'дополнительными'])}?`
          : 'Удалить меню со всеми категориями и блюдами?',
        onDelete: item ? remove : undefined,
      };
    }
    if (kind === 'archive') {
      return { fields: FORMS.archive, initial: item, validate: validateDates, submitLabel: 'Отправить в архив' };
    }
    return {
      fields: FORMS[kind],
      initial: item ? { ...item, price: item.price ?? '' } : {},
      deleteHint: DELETE_HINTS[kind],
      onDelete: item ? remove : undefined,
    };
  };

  const categories = (menu) =>
    menu.categories.length === 0 ? (
      <div className="menu-empty">
        <p>В этом меню пока нет категорий</p>
        <span>Например: Завтраки, Салаты, Горячее, Напитки</span>
      </div>
    ) : (
      <div className="menu-cats">
        {menu.categories.map((c) => (
          <section key={c.id} className="menu-cat">
            <header className="menu-cat-head">
              <div>
                <h3>{c.name}</h3>
                <span>{c.dishes.length} {plural(c.dishes.length, ['блюдо', 'блюда', 'блюд'])}</span>
              </div>
              <button className="icon-btn" aria-label={`Изменить категорию ${c.name}`} onClick={() => setEdit({ kind: 'category', item: c })}>
                <IconEdit size={16} />
              </button>
            </header>

            {c.dishes.length > 0 && (
              <ul className="dishes">
                {c.dishes.map((d) => (
                  <li key={d.id}>
                    <button className="dish" onClick={() => setEdit({ kind: 'dish', categoryId: c.id, item: d })}>
                      <span className="dish-main">
                        <span className="dish-name">{d.name}</span>
                        {(d.weight || d.description) && (
                          <span className="dish-sub">{[d.weight, d.description].filter(Boolean).join(' · ')}</span>
                        )}
                      </span>
                      <span className="dish-price">{d.price === null ? '—' : fmtMoney(d.price)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <button className="dish-add" onClick={() => setEdit({ kind: 'dish', categoryId: c.id })}>
              <IconPlus size={16} />
              Добавить блюдо
            </button>
          </section>
        ))}
      </div>
    );

  const addCategory = (
    <button className="btn btn-outline btn-icon" onClick={() => setEdit({ kind: 'category' })}>
      <IconPlus size={16} />
      Добавить категорию
    </button>
  );

  const mainView = (menu) => {
    const extras = extrasOf(menu.id);
    return (
      <>
        <div className="menu-toolbar">
          <h2>{menu.name}</h2>
          <span className="menu-pill is-main">Основное</span>
          <button className="icon-btn" aria-label="Изменить меню" onClick={() => setEdit({ kind: 'menu', item: menu })}>
            <IconEdit size={16} />
          </button>
          {addCategory}
        </div>

        <section className="extras">
          <header className="extras-head">
            <h3>Дополнительные меню</h3>
            <button className="link-btn extras-add" onClick={() => newMenu({ type: 'extra', parentId: menu.id, start: todayIso() })}>
              <IconPlus size={14} />
              Прикрепить меню
            </button>
          </header>
          {extras.length === 0 ? (
            <p className="extras-hint">Сезонные, праздничные, бизнес-ланч — со своими датами. Они появятся и в маркетинговом календаре</p>
          ) : (
            <div className="extras-list">
              {extras.map((x) => (
                <div key={x.id} className={`extra is-${menuStatus(x)}`}>
                  <button className="extra-main" onClick={() => setActiveId(x.id)}>
                    <span className="extra-name">{x.name}</span>
                    <span className="extra-dates">{fmtPeriod(x.start, x.end)}</span>
                    <StatusPill menu={x} />
                  </button>
                  {menuStatus(x) === 'finished' && (
                    <button className="btn btn-outline extra-archive" onClick={() => toArchive(x)}>В архив</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {categories(menu)}
      </>
    );
  };

  const extraView = (menu) => {
    const parent = byId[menu.parentId];
    const finished = menuStatus(menu) === 'finished';
    return (
      <>
        <button className="menu-back" onClick={() => setActiveId(menu.archived ? ARCHIVE : menu.parentId)}>
          <IconChevronLeft size={16} />
          {menu.archived ? 'Архив' : parent?.name ?? 'Назад'}
        </button>
        <div className="menu-toolbar">
          <h2>{menu.name}</h2>
          <StatusPill menu={menu} />
          <button className="icon-btn" aria-label="Изменить меню" onClick={() => setEdit({ kind: 'menu', item: menu })}>
            <IconEdit size={16} />
          </button>
          <div className="menu-toolbar-actions">
            {menu.archived ? (
              <button className="btn btn-outline" onClick={() => unarchive(menu)}>Вернуть из архива</button>
            ) : (
              <button className={`btn ${finished ? 'btn-primary' : 'btn-outline'}`} onClick={() => toArchive(menu)}>В архив</button>
            )}
            {addCategory}
          </div>
        </div>
        <p className="menu-period">
          {fmtPeriod(menu.start, menu.end)}
          {parent && <> · дополнительное к «{parent.name}»</>}
        </p>
        {categories(menu)}
      </>
    );
  };

  const archiveView = () =>
    archived.length === 0 ? (
      <div className="menu-empty">
        <p>Архив пуст</p>
        <span>Сюда попадают закончившиеся дополнительные меню вместе с датами, когда они шли</span>
      </div>
    ) : (
      <ul className="archive-list">
        {archived.map((m) => (
          <li key={m.id} className="archive-row">
            <button className="archive-main" onClick={() => setActiveId(m.id)}>
              <span className="extra-name">{m.name}</span>
              <span className="extra-dates">
                {fmtPeriod(m.start, m.end)}
                {byId[m.parentId] && ` · к «${byId[m.parentId].name}»`}
              </span>
            </button>
            <span className="archive-count">
              {m.categories.length} {plural(m.categories.length, ['категория', 'категории', 'категорий'])}
            </span>
            <button className="btn btn-ghost" onClick={() => unarchive(m)}>Вернуть</button>
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <div className="page-head">
        <h1>Основное и сезонные меню</h1>
        <button className="btn btn-primary btn-icon" onClick={() => newMenu({ type: 'main', parentId: mains[0]?.id, start: todayIso() })}>
          <IconPlus size={16} />
          Добавить меню
        </button>
      </div>

      {mains.length === 0 && archived.length === 0 ? (
        <div className="menu-empty">
          <p>Пока нет ни одного меню</p>
          <span>Создайте основное меню, затем добавьте в него категории и блюда</span>
        </div>
      ) : (
        <>
          <div className="tabs menu-tabs" role="tablist" aria-label="Основные меню">
            {mains.map((m) => (
              <button key={m.id} role="tab" aria-selected={m.id === tabId} className={m.id === tabId ? 'is-active' : ''} onClick={() => setActiveId(m.id)}>
                {m.name}
                {extrasOf(m.id).length > 0 && <span>+{extrasOf(m.id).length}</span>}
              </button>
            ))}
            <button role="tab" aria-selected={tabId === ARCHIVE} className={`menu-tab-archive ${tabId === ARCHIVE ? 'is-active' : ''}`} onClick={() => setActiveId(ARCHIVE)}>
              Архив
              <span>{archived.length}</span>
            </button>
          </div>

          {isArchive || !active ? archiveView() : active.type === 'extra' ? extraView(active) : mainView(active)}
        </>
      )}

      {edit && (
        <EditModal
          key={edit.kind}
          title={TITLES[edit.kind][edit.item ? 1 : 0]}
          onSave={save}
          onClose={() => setEdit(null)}
          {...modalProps()}
        />
      )}
    </>
  );
}
