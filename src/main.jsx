import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AuthGate from './components/AuthGate.jsx';
import './styles.css';

// Экран меню-борда (/tv) работает без входа — он подключается кодом из «Управления ТВ».
const TvPlayer = lazy(() => import('./tv/TvPlayer.jsx'));
const isTv = /^\/tv\/?$/.test(window.location.pathname);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isTv ? (
      <Suspense fallback={null}>
        <TvPlayer />
      </Suspense>
    ) : (
      <AuthGate>{(auth) => <App {...auth} />}</AuthGate>
    )}
  </StrictMode>,
);
