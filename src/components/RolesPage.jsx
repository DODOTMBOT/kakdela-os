import { NAV } from './Sidebar.jsx';
import { useShared } from '../sync.js';
import { ACCESS_KEY, ADMIN_ONLY, ALWAYS_OPEN, CONFIGURABLE_ROLES, MANAGERS_ONLY, roleLabel } from '../access.js';

// Разделы в том же порядке и с теми же группами, что в меню. Скрытые из меню страницы
// (например, «Анализ отчётности») тоже настраиваются — они открываются по прямой ссылке.
const EXTRA = [{ id: 'notifications', label: 'Оповещения' }];

function rowsOf(group) {
  const rows = [];
  for (const item of group.items) {
    if (item.children) {
      rows.push({ kind: 'folder', id: item.id, label: item.label, children: item.children.map((c) => c.id) });
      for (const c of item.children) rows.push({ kind: 'page', id: c.id, label: c.label, child: true });
    } else rows.push({ kind: 'page', id: item.id, label: item.label, note: item.hidden ? 'скрыт из меню' : null });
  }
  return rows;
}

const ALL_PAGES = [...NAV.flatMap((g) => g.items.flatMap((i) => (i.children ? i.children.map((c) => c.id) : [i.id]))), ...EXTRA.map((e) => e.id)];
const CONFIGURABLE_PAGES = ALL_PAGES.filter((id) => !ALWAYS_OPEN.includes(id) && !ADMIN_ONLY.includes(id));
const pagesFor = (role) => CONFIGURABLE_PAGES.filter((id) => !(role === 'employee' && MANAGERS_ONLY.includes(id)));

export default function RolesPage() {
  const [config, setConfig] = useShared(ACCESS_KEY, {});
  const denied = (role) => (Array.isArray(config?.[role]) ? config[role] : []);
  const isOpen = (role, page) => !denied(role).includes(page);

  const setPages = (role, pages, open) =>
    setConfig((c) => {
      const cur = new Set(Array.isArray(c?.[role]) ? c[role] : []);
      for (const p of pages) (open ? cur.delete(p) : cur.add(p));
      return { ...(c ?? {}), [role]: [...cur].sort() };
    });

  const cell = (role, row) => {
    const fixed = ALWAYS_OPEN.includes(row.id) ? true : ADMIN_ONLY.includes(row.id) ? false : MANAGERS_ONLY.includes(row.id) && role === 'employee' ? false : null;
    if (fixed !== null) {
      return (
        <td key={role} className="roles-cell">
          <input type="checkbox" checked={fixed} disabled aria-label={`${row.label}: ${roleLabel(role)}`} />
        </td>
      );
    }
    if (row.kind === 'folder') {
      const openCount = row.children.filter((p) => isOpen(role, p)).length;
      return (
        <td key={role} className="roles-cell">
          <input
            type="checkbox"
            checked={openCount === row.children.length}
            ref={(el) => el && (el.indeterminate = openCount > 0 && openCount < row.children.length)}
            onChange={(e) => setPages(role, row.children, e.target.checked)}
            aria-label={`${row.label} целиком: ${roleLabel(role)}`}
          />
        </td>
      );
    }
    return (
      <td key={role} className="roles-cell">
        <input type="checkbox" checked={isOpen(role, row.id)} onChange={(e) => setPages(role, [row.id], e.target.checked)} aria-label={`${row.label}: ${roleLabel(role)}`} />
      </td>
    );
  };

  const groups = [...NAV.map((g) => ({ title: g.title, rows: rowsOf(g) })), { title: 'Прочее', rows: EXTRA.map((e) => ({ kind: 'page', ...e })) }];

  return (
    <>
      <div className="page-head">
        <div>
          <span className="rv-crumb">Администрирование</span>
          <h1>Роли и доступ</h1>
        </div>
      </div>
      <p className="roles-intro">
        Отметьте, какие разделы доступны каждой роли. Изменения применяются сразу: закрытый раздел пропадает из меню и с главной страницы,
        а по прямой ссылке открывается страница «Нет доступа». Супер-админу доступно всё.
      </p>

      <section className="rv-summary roles-summary">
        {CONFIGURABLE_ROLES.map((role) => {
          const pages = pagesFor(role);
          const open = pages.filter((p) => isOpen(role, p)).length;
          return (
            <div key={role} className="rv-sum">
              <span>{roleLabel(role)}</span>
              <b>
                {open} <small>из {pages.length}</small>
              </b>
              <small>
                <button className="link-btn" onClick={() => setPages(role, pages, true)} disabled={open === pages.length}>
                  Открыть всё
                </button>
              </small>
            </div>
          );
        })}
        <div className="rv-sum">
          <span>{roleLabel('admin')}</span>
          <b>Все</b>
          <small>разделы, без ограничений</small>
        </div>
      </section>

      <div className="tr-table-wrap">
        <table className="tr-table roles-table">
          <thead>
            <tr>
              <th>Раздел</th>
              {CONFIGURABLE_ROLES.map((r) => (
                <th key={r} className="roles-cell">{roleLabel(r)}</th>
              ))}
              <th className="roles-cell">{roleLabel('admin')}</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.title}>
              <tr className="roles-group">
                <th colSpan={CONFIGURABLE_ROLES.length + 2}>{g.title}</th>
              </tr>
              {g.rows.map((row) => (
                <tr key={row.id} className={`${row.child ? 'is-child' : ''} ${row.kind === 'folder' ? 'is-folder' : ''}`}>
                  <td>
                    {row.label}
                    {row.note && <small>{row.note}</small>}
                    {ALWAYS_OPEN.includes(row.id) && <small>доступна всем</small>}
                    {ADMIN_ONLY.includes(row.id) && <small>только супер-админ</small>}
                    {MANAGERS_ONLY.includes(row.id) && <small>только руководители</small>}
                  </td>
                  {CONFIGURABLE_ROLES.map((role) => cell(role, row))}
                  <td className="roles-cell">
                    <input type="checkbox" checked disabled aria-label={`${row.label}: ${roleLabel('admin')}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </>
  );
}
