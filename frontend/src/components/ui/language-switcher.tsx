import { Languages } from 'lucide-react';
import { LANGS, tr, useLang, useLangStore } from '@/i18n';
import { cn } from '@/lib/utils';

/** AZ | EN segmented switch. Each option is labelled in its own language. */
export function LanguageSwitcher({
  className,
  size = 'md',
}: {
  className?: string;
  size?: 'sm' | 'md';
}) {
  const lang = useLang();
  const setLang = useLangStore((s) => s.setLang);
  return (
    <div
      role="radiogroup"
      aria-label={tr.language.label}
      className={cn(
        'inline-flex items-center gap-1 rounded-xl border bg-card/90 p-1 backdrop-blur',
        className,
      )}
    >
      <Languages className="mx-1 h-4 w-4 text-muted-foreground" aria-hidden />
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={lang === l}
          lang={l}
          title={tr.language[l]}
          aria-label={tr.language[l]}
          onClick={() => setLang(l)}
          className={cn(
            'rounded-lg font-bold uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            size === 'sm' ? 'h-7 px-2 text-xs' : 'h-9 min-w-[44px] px-3 text-sm',
            lang === l
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
