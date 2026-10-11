// Анализ P&L через OpenAI. Работает внутри dev/preview-сервера Vite: ключ берётся из .env.local
// и никогда не отправляется в браузер. Браузер шлёт сюда файл и свою финмодель, получает готовый разбор.

const MAX_BODY = 40 * 1024 * 1024;
const TIMEOUT_MS = 240_000;

const nullable = (type) => ({ type: [type, 'null'] });

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['period', 'revenue', 'profit', 'summary', 'items', 'missing', 'recommendations', 'data_quality'],
  properties: {
    period: { type: 'string', description: 'Период отчёта, как он указан в P&L, или пустая строка' },
    revenue: { ...nullable('number'), description: 'Выручка за период в рублях' },
    profit: {
      type: 'object',
      additionalProperties: false,
      required: ['amount', 'pct'],
      properties: { amount: nullable('number'), pct: nullable('number') },
    },
    summary: { type: 'string', description: 'Общий вывод: 3–6 предложений' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item_id', 'name', 'amount', 'actual_pct', 'target_pct', 'deviation_pp', 'status', 'comment'],
        properties: {
          item_id: { ...nullable('string'), description: 'id статьи из финмодели пользователя или null, если соответствия нет' },
          name: { type: 'string', description: 'Название строки, как в P&L' },
          amount: nullable('number'),
          actual_pct: { ...nullable('number'), description: 'Доля от выручки, %' },
          target_pct: nullable('number'),
          deviation_pp: { ...nullable('number'), description: 'actual_pct − target_pct, п.п.' },
          status: { type: 'string', enum: ['over', 'ok', 'under', 'no_target'] },
          comment: { type: 'string' },
        },
      },
    },
    missing: {
      type: 'array',
      items: { type: 'string' },
      description: 'Статьи финмодели, которых нет в P&L',
    },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'priority', 'area', 'details', 'actions', 'effect'],
        properties: {
          title: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          area: { type: 'string', description: 'К какой статье или блоку относится' },
          details: { type: 'string', description: 'Подробное объяснение: что происходит и почему это важно' },
          actions: { type: 'array', items: { type: 'string' }, description: 'Конкретные шаги' },
          effect: { type: 'string', description: 'Ожидаемый эффект в п.п. и рублях в месяц' },
        },
      },
    },
    data_quality: { type: 'string', description: 'Что не удалось распознать, какие допущения сделаны' },
  },
};

const SYSTEM = `Ты — финансовый аналитик ресторанного бизнеса (рестораны, кафе, кофейни). Пользователь присылает отчёт P&L
(картинку, PDF или таблицу) и свою финансовую модель: блоки расходов, статьи и целевые доли от выручки в процентах.

Задача:
1. Аккуратно извлеки из P&L выручку и все статьи расходов. Не придумывай цифры: если значение не читается — ставь null
   и опиши это в data_quality. Суммы — в рублях за период отчёта.
2. Посчитай долю каждой статьи от выручки (%). Если в P&L уже есть проценты — сверь их с расчётом.
3. Сопоставь строки P&L со статьями финмодели пользователя и укажи item_id. Если одна строка P&L покрывает несколько
   статей модели или наоборот — объясни это в comment. Строки без соответствия — item_id: null, status: no_target.
4. status: over — доля выше цели больше чем на 0,5 п.п.; under — ниже цели больше чем на 0,5 п.п.; ok — в пределах.
5. Дай подробные, практичные рекомендации для ресторана: сначала по самым крупным перерасходам в рублях.
   Для каждой — что происходит, вероятные причины, конкретные шаги (закупки, техкарты, списания, график смен,
   ценообразование, аренда, маркетинг и т.д.) и ожидаемый эффект в п.п. и рублях в месяц. Отметь и сильные стороны.
6. Пиши по-русски, профессионально и по делу.`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Файл слишком большой'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function describeModel(model) {
  const lines = [`Выручка в модели пользователя: ${model.revenue ? `${model.revenue} ₽ в месяц` : 'не указана'}.`];
  for (const b of model.blocks ?? []) {
    lines.push(`Блок «${b.name || 'Без названия'}»:`);
    for (const i of b.items ?? []) {
      lines.push(`  - id=${i.id}; «${i.name || 'Без названия'}»; цель ${i.target ?? 'не задана'} %`);
    }
  }
  if (!model.blocks?.length) lines.push('Целевые значения не заданы — оцени P&L по типичным для ресторанов ориентирам и скажи об этом.');
  return lines.join('\n');
}

function userContent({ file, text, period, model }) {
  const intro = [
    'Финансовая модель пользователя (целевые доли от выручки):',
    describeModel(model),
    period ? `Период, который указал пользователь: ${period}.` : '',
    'Ниже — отчёт P&L.',
  ]
    .filter(Boolean)
    .join('\n');
  const parts = [{ type: 'text', text: intro }];
  if (text) parts.push({ type: 'text', text: `Содержимое файла «${file?.name ?? 'P&L'}»:\n${text}` });
  else if (file?.type?.startsWith('image/')) parts.push({ type: 'image_url', image_url: { url: file.dataUrl, detail: 'high' } });
  else if (file) parts.push({ type: 'file', file: { filename: file.name, file_data: file.dataUrl } });
  return parts;
}

async function analyze(payload, env) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: env.OPENAI_MODEL || 'gpt-5.5',
      reasoning_effort: 'medium',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userContent(payload) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'pnl_analysis', strict: true, schema: SCHEMA } },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || `OpenAI ответил ошибкой ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status === 401 ? 401 : 502 });
  }
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) throw Object.assign(new Error(choice.message.refusal), { status: 422 });
  if (choice?.finish_reason === 'length') throw Object.assign(new Error('Ответ модели оборвался — попробуйте ещё раз'), { status: 502 });
  return { ...JSON.parse(choice.message.content), model: data.model };
}

export function createPnlHandler(env, auth) {
  return async (req, res, next) => {
    if (req.url !== '/api/pnl-analysis') return next();
    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST') return send(405, { error: 'Только POST' });
    if (!(await auth.userFrom(req))) return send(401, { error: 'Нужно войти' });
    if (!env.OPENAI_API_KEY) return send(500, { error: 'Не задан OPENAI_API_KEY в .env.local' });
    try {
      const payload = JSON.parse(await readBody(req));
      if (!payload.file && !payload.text) return send(400, { error: 'Нет файла для анализа' });
      send(200, await analyze(payload, env));
    } catch (err) {
      const timeout = err.name === 'TimeoutError';
      send(err.status || (timeout ? 504 : 500), { error: timeout ? 'Анализ занял слишком много времени — попробуйте ещё раз' : err.message });
    }
  };
}

export function pnlAnalysisPlugin(env, auth) {
  const handler = createPnlHandler(env, auth);
  return {
    name: 'pnl-analysis',
    // Без return: функцию, которую вернул хук, Vite вызывает после своих middleware.
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
