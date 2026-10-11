import { useRef, useState } from 'react';
import { IconClose, IconUpload } from './Icons.jsx';
import { extractText } from '../previews.js';
import { fmtSize } from '../files.js';
import { fmtMoney } from '../utils.js';
import { useShared } from '../sync.js';

const STORAGE_KEY = 'ledger:pnl-analysis:v1';
const MAX_FILE = 20 * 1024 * 1024;
const MAX_TEXT = 150_000;
const MAX_IMAGE_SIDE = 2400;
const ACCEPT = 'image/*,.pdf,.xlsx,.xls,.xlsm,.ods,.csv,.tsv,.txt,.docx';

const PRIORITY = { high: ['Высокий', 0], medium: ['Средний', 1], low: ['Низкий', 2] };
const STATUS = { over: 'Выше цели', under: 'Ниже цели', ok: 'В норме', no_target: 'Нет цели' };

const pct = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const fmtPct = (n) => (n === null || n === undefined ? '—' : `${pct.format(n)} %`);
const fmtPp = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${pct.format(Math.abs(n))} п.п.`);
const fmtRub = (n) => (n === null || n === undefined ? '—' : fmtMoney(n));

const readDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

// Крупные фото уменьшаем: модели хватает 2400 px, а запрос становится в разы легче.
async function imageDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 4 * 1024 * 1024) return readDataUrl(file);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

async function buildPayload(file) {
  const meta = { name: file.name, type: file.type || 'application/octet-stream' };
  const text = await extractText(file);
  if (text !== null) {
    if (!text.trim()) throw new Error('В файле не нашлось данных');
    return { file: meta, text: text.slice(0, MAX_TEXT) };
  }
  if (file.type.startsWith('image/')) return { file: { ...meta, type: 'image/jpeg', dataUrl: await imageDataUrl(file) } };
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return { file: { ...meta, type: 'application/pdf', dataUrl: await readDataUrl(file) } };
  }
  throw new Error('Этот формат не поддерживается — загрузите картинку, PDF, Excel, CSV или Word');
}

export default function PnlAnalysis({ model, onApplyFact }) {
  const [file, setFile] = useState(null);
  const [period, setPeriod] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useShared(STORAGE_KEY, null);
  const [applied, setApplied] = useState('');
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);

  const pick = (f) => {
    setError('');
    if (!f) return;
    if (f.size > MAX_FILE) return setError(`Файл больше ${fmtSize(MAX_FILE)} — сожмите его или загрузите скриншот`);
    setFile(f);
  };

  const analyze = async () => {
    setLoading(true);
    setError('');
    setApplied('');
    try {
      const payload = await buildPayload(file);
      const res = await fetch('/api/pnl-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          period: period.trim(),
          model: {
            revenue: model.revenue,
            blocks: model.blocks.map((b) => ({ id: b.id, name: b.name, items: b.items.map(({ id, name, target }) => ({ id, name, target })) })),
          },
        }),
      });
      const data = await res.json().catch(() => ({ error: 'Сервер анализа недоступен — запущен ли проект через npm run dev?' }));
      if (!res.ok || data.error) throw new Error(data.error || `Ошибка ${res.status}`);
      setSaved({ result: data, fileName: file.name, at: new Date().toISOString() });
      setFile(null);
      setPeriod('');
    } catch (err) {
      setError(err.message || 'Не удалось выполнить анализ');
    } finally {
      setLoading(false);
    }
  };

  const ids = new Set(model.blocks.flatMap((b) => b.items.map((i) => i.id)));
  const result = saved?.result;
  const matched = result ? result.items.filter((i) => i.item_id && ids.has(i.item_id) && i.actual_pct !== null) : [];
  const namesById = Object.fromEntries(model.blocks.flatMap((b) => b.items.map((i) => [i.id, i.name])));

  const applyFact = () => {
    // Несколько строк P&L могут относиться к одной статье — складываем их доли.
    const actuals = {};
    for (const i of matched) actuals[i.item_id] = (actuals[i.item_id] ?? 0) + i.actual_pct;
    for (const id of Object.keys(actuals)) actuals[id] = Math.round(actuals[id] * 10) / 10;
    onApplyFact(actuals, result.revenue);
    const n = Object.keys(actuals).length;
    setApplied(`Факт перенесён по ${n} ${n % 10 === 1 && n % 100 !== 11 ? 'статье' : 'статьям'}${result.revenue ? ', выручка обновлена' : ''}`);
  };

  const recs = result ? [...result.recommendations].sort((a, b) => PRIORITY[a.priority][1] - PRIORITY[b.priority][1]) : [];

  return (
    <section className="pnl">
      <header className="pnl-head">
        <div>
          <h3>Анализ P&L</h3>
          <p>Загрузите отчёт — фото, скриншот, PDF или таблицу. ИИ сравнит его с вашими целевыми значениями и даст рекомендации</p>
        </div>
      </header>

      <div
        className={`pnl-drop ${over ? 'is-over' : ''} ${file ? 'has-file' : ''}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          pick(e.dataTransfer.files[0]);
        }}
      >
        {file ? (
          <div className="pnl-file">
            <span className="pnl-file-name">{file.name}</span>
            <span className="pnl-file-size">{fmtSize(file.size)}</span>
            {!loading && (
              <button className="row-del" aria-label="Убрать файл" onClick={() => setFile(null)}>
                <IconClose size={14} />
              </button>
            )}
          </div>
        ) : (
          <button className="pnl-pick" onClick={() => inputRef.current.click()}>
            <IconUpload size={22} />
            <span>Выберите файл P&L или перетащите его сюда</span>
            <small>JPG, PNG, PDF, Excel, CSV, Word — до {fmtSize(MAX_FILE)}</small>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            pick(e.target.files[0]);
            e.target.value = '';
          }}
        />
      </div>

      {file && (
        <div className="pnl-run">
          <label className="field pnl-period">
            Период (необязательно)
            <input value={period} placeholder="Например, сентябрь 2026" onChange={(e) => setPeriod(e.target.value)} disabled={loading} />
          </label>
          <button className="btn btn-primary" onClick={analyze} disabled={loading}>
            {loading ? 'Анализируем…' : 'Проанализировать'}
          </button>
        </div>
      )}
      {loading && <p className="pnl-status">Читаем отчёт и сравниваем с целями — обычно это занимает 30–90 секунд</p>}
      {model.blocks.length === 0 && <p className="pnl-status">Целевые значения не заданы — анализ будет по типичным ориентирам для ресторанов</p>}
      {error && <p className="docs-error">{error}</p>}

      {result && (
        <div className="pnl-result">
          <div className="pnl-meta">
            <span>
              {[result.period, saved.fileName, `анализ от ${new Date(saved.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <div className="pnl-meta-actions">
              {matched.length > 0 && (
                <button className="btn btn-outline" onClick={applyFact}>Перенести факт в модель</button>
              )}
              <button className="btn btn-ghost" onClick={() => setSaved(null)}>Удалить анализ</button>
            </div>
          </div>
          {applied && <p className="pnl-applied">{applied}</p>}

          <div className="pnl-kpis">
            <div><span>Выручка</span><b>{fmtRub(result.revenue)}</b></div>
            <div>
              <span>Прибыль</span>
              <b className={result.profit.amount < 0 ? 'is-neg' : ''}>{fmtRub(result.profit.amount)}</b>
              <small>{fmtPct(result.profit.pct)}</small>
            </div>
            <div>
              <span>Выше цели</span>
              <b>{result.items.filter((i) => i.status === 'over').length}</b>
              <small>из {result.items.length} статей</small>
            </div>
          </div>

          <p className="pnl-summary">{result.summary}</p>

          <div className="table-scroll">
            <table className="fin-table pnl-table">
              <thead>
                <tr>
                  <th>Статья P&L</th>
                  <th className="num">Сумма</th>
                  <th className="num">Факт</th>
                  <th className="num">Цель</th>
                  <th className="num">Отклонение</th>
                  <th>Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((i, k) => (
                  <tr key={k} className={`is-${i.status}`}>
                    <td>
                      {i.name}
                      {i.item_id && namesById[i.item_id] && namesById[i.item_id] !== i.name && (
                        <span className="pnl-map">→ {namesById[i.item_id]}</span>
                      )}
                    </td>
                    <td className="num">{fmtRub(i.amount)}</td>
                    <td className="num">{fmtPct(i.actual_pct)}</td>
                    <td className="num">{fmtPct(i.target_pct)}</td>
                    <td className="num">
                      <span className={`fin-dev ${i.status === 'over' ? 'is-over' : i.status === 'under' ? 'is-under' : ''}`} title={STATUS[i.status]}>
                        {fmtPp(i.deviation_pp)}
                      </span>
                    </td>
                    <td className="pnl-comment">{i.comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.missing.length > 0 && <p className="pnl-status">Нет в отчёте: {result.missing.join(', ')}</p>}

          <h4 className="pnl-subtitle">Рекомендации</h4>
          <div className="pnl-recs">
            {recs.map((r, k) => (
              <article key={k} className={`pnl-rec is-${r.priority}`}>
                <header>
                  <span className={`pnl-priority is-${r.priority}`}>{PRIORITY[r.priority][0]} приоритет</span>
                  {r.area && <span className="pnl-area">{r.area}</span>}
                </header>
                <h5>{r.title}</h5>
                <p>{r.details}</p>
                {r.actions.length > 0 && (
                  <ul>
                    {r.actions.map((a, j) => <li key={j}>{a}</li>)}
                  </ul>
                )}
                {r.effect && <p className="pnl-effect"><b>Эффект:</b> {r.effect}</p>}
              </article>
            ))}
          </div>

          {result.data_quality && <p className="pnl-note">{result.data_quality}</p>}
        </div>
      )}
    </section>
  );
}
