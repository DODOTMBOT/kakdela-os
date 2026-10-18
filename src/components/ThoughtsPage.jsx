import { useMemo, useRef, useState } from 'react';
import { useShared } from '../sync.js';
import { IDEAS_KEY, IDEA_COLUMNS, ideaStatus } from '../ideas.js';
import { iso } from '../data.js';
import { fmtDay } from '../utils.js';

// Пространство мыслей: любой пишет идею, мысль или желание в свободной форме — она сразу
// попадает на «Доску идей» в колонку «Новые». Там её дополняют описанием и двигают по доске.

const TITLE_MAX = 80;
const COLUMN = Object.fromEntries(IDEA_COLUMNS.map((c) => [c.id, c]));

const uid = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const todayIso = () => {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
};

// Заголовок карточки — первая строка (до 80 символов, по границе слова), описание — продолжение
// текста без повтора заголовка. Полный исходный текст хранится отдельно (text).
export function thoughtToIdea(text, user) {
  const full = text.trim();
  const [firstLine, ...restLines] = full.split('\n');
  const line = firstLine.trim();
  let title = line;
  let tail = '';
  if (line.length > TITLE_MAX) {
    const space = line.slice(0, TITLE_MAX).lastIndexOf(' ');
    const at = space > 40 ? space : TITLE_MAX;
    title = `${line.slice(0, at).trim()}…`;
    tail = `…${line.slice(at).trim()}`;
  }
  const note = [tail, restLines.join('\n').trim()].filter(Boolean).join('\n');
  return {
    id: uid(),
    title,
    note,
    status: 'new',
    date: todayIso(),
    source: 'thoughts',
    // Исходный текст автора — описание на доске потом могут дополнить, а это остаётся как было.
    text: full,
    authorId: user.id,
    authorName: user.name,
  };
}

// Форма отправки — на странице и на главной.
export function ThoughtForm({ user, compact = false }) {
  const [, setIdeas] = useShared(IDEAS_KEY, []);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const ref = useRef(null);

  const send = (e) => {
    e?.preventDefault();
    if (!text.trim()) return ref.current.focus();
    const idea = thoughtToIdea(text, user);
    setIdeas((list) => [idea, ...(Array.isArray(list) ? list : [])]);
    setText('');
    setSent(true);
    ref.current.focus();
  };

  return (
    <form className={`th-form ${compact ? 'is-compact' : ''}`} onSubmit={send}>
      <textarea
        ref={ref}
        autoFocus={!compact}
        rows={compact ? 3 : 5}
        className="th-input"
        placeholder="Идея, мысль или желание — в свободной форме"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSent(false);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && send(e)}
        aria-label="Ваша мысль"
      />
      <div className="th-foot">
        <span className={sent ? 'th-sent' : ''}>{sent ? 'Отправлено — мысль на доске идей в «Новых»' : '⌘/Ctrl + Enter — отправить'}</span>
        <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
          Отправить
        </button>
      </div>
    </form>
  );
}

export default function ThoughtsPage({ user }) {
  const [ideas] = useShared(IDEAS_KEY, []);
  const mine = useMemo(() => (Array.isArray(ideas) ? ideas : []).filter((i) => i.authorId === user.id), [ideas, user.id]);

  return (
    <>
      <div className="page-head">
        <h1>Пространство мыслей</h1>
      </div>
      <p className="th-intro">Напишите идею, мысль или желание — как есть, без оформления. Всё отправленное попадает на «Доску идей», где его обсуждают и доводят до дела.</p>

      <ThoughtForm user={user} />

      {mine.length > 0 && (
        <>
          <h2 className="tr-section-title">
            Мои мысли <span>{mine.length}</span>
          </h2>
          <ul className="th-list">
            {mine.map((i) => {
              const col = COLUMN[ideaStatus(i)] ?? COLUMN.new;
              return (
                <li key={i.id}>
                  <span className="th-text">{i.text ?? i.title}</span>
                  <span className="th-meta">
                    <span className="th-stage">
                      <i style={{ background: col.dot }} />
                      {col.label}
                    </span>
                    <span>{fmtDay(i.date)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
