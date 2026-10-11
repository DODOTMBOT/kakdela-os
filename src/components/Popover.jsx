import { useEffect } from 'react';

// Закрытие окна по Escape.
export function useEscape(handler) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && handler();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handler]);
}
