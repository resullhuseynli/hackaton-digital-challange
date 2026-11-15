import { MapPinOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { tr } from '@/i18n';

export function NotFoundPage() {
  return (
    <main className="grid h-full place-items-center p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-muted">
          <MapPinOff className="h-8 w-8 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="text-xl font-bold">{tr.app.notFound}</h1>
        <Button asChild>
          <Link to="/">{tr.app.goHome}</Link>
        </Button>
      </div>
    </main>
  );
}
