import { toast } from 'sonner';
import { ApiError, errorMessage } from '@/api/http';
import { tr } from '@/i18n';

/**
 * Toast for a failed dispatcher write. A 403 (INSUFFICIENT_ROLE) gets a "no permission" title;
 * the description is always the server's localized message.
 */
export function actionErrorToast(e: unknown, title: string) {
  const forbidden = e instanceof ApiError && e.status === 403;
  toast.error(forbidden ? tr.rbac.forbidden : title, { description: errorMessage(e) });
}
