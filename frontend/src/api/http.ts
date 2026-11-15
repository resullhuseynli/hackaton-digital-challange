import { tr, useLangStore } from '@/i18n';
import { getDeviceId } from '@/lib/deviceId';
import { env } from '@/lib/env';
import { useAuthStore } from '@/stores/authStore';
import { useCitizenStore } from '@/stores/citizenStore';
import { limitLeft, useRateLimitStore } from '@/stores/rateLimitStore';
import type { ApiErrorBody } from '@/types/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Seconds until the request may be retried (429 SOS_COOLDOWN: details.retry_after_sec). */
  readonly retryAfter: number | null;
  /** `error.details` from the envelope (e.g. the 422 VALIDATION_ERROR field list). */
  readonly details: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfter: number | null = null,
    details: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.details = details;
  }

  get isNetwork() {
    return this.status === 0;
  }
}

export type AuthMode = 'device' | 'dispatcher' | 'none';

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: AuthMode;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  /** Extra request headers (e.g. `Idempotency-Key`). */
  headers?: Record<string, string>;
}

/** Parsed body plus the response headers (for `X-Duplicate-Of`, `Idempotent-Replay`, …). */
export interface FullResponse<T> {
  data: T;
  headers: Headers;
}

function isErrorBody(v: unknown): v is ApiErrorBody {
  return (
    typeof v === 'object' &&
    v !== null &&
    'error' in v &&
    typeof (v as ApiErrorBody).error?.message === 'string'
  );
}

/** FastAPI validation errors come as {detail: ...}; normalise them too. */
function detailMessage(v: unknown): string | null {
  if (typeof v === 'object' && v !== null && 'detail' in v) {
    const d = (v as { detail: unknown }).detail;
    if (typeof d === 'string') return d;
  }
  return null;
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${env.apiUrl}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/** Shared in-flight registration so parallel requests re-register only once. */
let registering: Promise<void> | null = null;
function reRegisterDevice(): Promise<void> {
  // A registration limit is active: don't hammer the server; the original call fails instead.
  if (limitLeft('register') > 0) return Promise.resolve();
  registering ??= fetch(buildUrl('/citizens/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId() },
    // Re-send the saved profile so a backend reset doesn't lose the accessibility flag.
    body: JSON.stringify({
      device_id: getDeviceId(),
      phone: useCitizenStore.getState().phone || undefined,
      mobility_impaired: useCitizenStore.getState().mobilityImpaired,
    }),
  })
    .then((res) => {
      if (res.status === 429) {
        const retry = Number(res.headers.get('Retry-After'));
        useRateLimitStore
          .getState()
          .block('register', Number.isFinite(retry) && retry > 0 ? retry : 60);
      }
    })
    .finally(() => {
      registering = null;
    });
  return registering;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return (await requestFull<T>(path, opts)).data;
}

/** Like `request`, but also returns the response headers. */
export async function requestFull<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<FullResponse<T>> {
  try {
    return await rawRequest<T>(path, opts);
  } catch (e) {
    // The backend forgets devices after a reset; register again transparently and retry once.
    if (
      e instanceof ApiError &&
      e.status === 401 &&
      e.code === 'CITIZEN_NOT_REGISTERED' &&
      opts.auth === 'device' &&
      path !== '/citizens/register'
    ) {
      await reRegisterDevice();
      return rawRequest<T>(path, opts);
    }
    throw e;
  }
}

async function rawRequest<T>(path: string, opts: RequestOptions): Promise<FullResponse<T>> {
  const { method = 'GET', body, auth = 'none', query, signal } = opts;
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth === 'device') headers['X-Device-Id'] = getDeviceId();
  // Lets the backend localise its error messages if it supports it.
  headers['Accept-Language'] = useLangStore.getState().lang;
  if (auth === 'dispatcher') {
    const token = useAuthStore.getState().token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', tr.app.networkError);
  }

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const headerRetry = Number(res.headers.get('Retry-After'));
    if (res.status === 401 && auth === 'dispatcher') {
      useAuthStore.getState().logout(tr.auth.sessionExpired);
    }
    if (isErrorBody(json)) {
      const details = json.error.details ?? null;
      const fromDetails =
        details && typeof details === 'object' && 'retry_after_sec' in details
          ? Number((details as { retry_after_sec: unknown }).retry_after_sec)
          : NaN;
      const retry = Number.isFinite(fromDetails)
        ? fromDetails
        : (json.error.retry_after ?? (Number.isFinite(headerRetry) ? headerRetry : null));
      throw new ApiError(res.status, json.error.code, json.error.message, retry || null, details);
    }
    throw new ApiError(
      res.status,
      `HTTP_${res.status}`,
      detailMessage(json) ?? tr.app.unknownError,
      Number.isFinite(headerRetry) && headerRetry > 0 ? headerRetry : null,
    );
  }

  return { data: json as T, headers: res.headers };
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return tr.app.unknownError;
}
