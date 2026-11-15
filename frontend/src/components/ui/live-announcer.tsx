import { useEffect, useState } from 'react';
import { useAnnounceStore } from '@/lib/announce';

function Region({ mode }: { mode: 'polite' | 'assertive' }) {
  const msg = useAnnounceStore((s) => s[mode]);
  // Clear then set, so repeating the same text is announced again.
  const [shown, setShown] = useState('');
  useEffect(() => {
    setShown('');
    const t = window.setTimeout(() => setShown(msg.text), 60);
    return () => window.clearTimeout(t);
  }, [msg]);
  return (
    <div
      className="sr-only"
      role={mode === 'assertive' ? 'alert' : 'status'}
      aria-live={mode}
      aria-atomic="true"
    >
      {shown}
    </div>
  );
}

/** Mount once at the app root. */
export function LiveAnnouncer() {
  return (
    <>
      <Region mode="polite" />
      <Region mode="assertive" />
    </>
  );
}
