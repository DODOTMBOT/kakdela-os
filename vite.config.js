import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { authPlugin, createAuth } from './server/auth.js';
import { createData } from './server/data.js';
import { validators } from './server/rules.js';
import { createNotifications } from './server/notifications.js';
import { createReviews } from './server/reviews.js';
import { createTraining } from './server/training.js';
import { createAccess, writeGuard } from './server/access.js';
import { createScreens } from './server/screens.js';
import { pnlAnalysisPlugin } from './server/pnlAnalysis.js';

export default defineConfig(({ mode }) => {
  // Пустой префикс: переменные из .env.local (ключи, пароль админа) доступны только серверу,
  // в клиентский код попадают лишь переменные с префиксом VITE_.
  const env = loadEnv(mode, process.cwd(), '');
  const auth = createAuth({ file: path.resolve('server/data/auth.json'), env });
  const notifications = createNotifications({ file: path.resolve('server/data/notifications.json'), auth });
  let screens = null;
  const onSaved = async (key, ...rest) => {
    screens?.onDataSaved(key);
    return notifications.onSaved(key, ...rest);
  };
  const data = createData({ dir: path.resolve('server/data'), auth, validators, onSaved, guard: writeGuard });
  const access = createAccess(data);
  const reviews = createReviews({ env, auth, file: path.resolve('server/data/reviews.json'), access });
  const training = createTraining({ file: path.resolve('server/data/training.json'), auth, data, access });
  screens = createScreens({ file: path.resolve('server/data/screens.json'), auth, data });
  return {
    plugins: [
      react(),
      authPlugin(auth),
      {
        name: 'shared-data',
        configureServer(server) {
          server.middlewares.use(data.handler);
          server.middlewares.use(notifications.handler);
          server.middlewares.use(reviews.handler);
          server.middlewares.use(training.handler);
          server.middlewares.use(screens.handler);
        },
      },
      pnlAnalysisPlugin(env, auth),
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      open: true,
      // Файл с пользователями меняется во время работы — не перезагружаем из-за него страницу.
      watch: { ignored: ['**/server/data/**'] },
    },
  };
});
