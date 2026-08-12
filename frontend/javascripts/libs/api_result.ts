import type { RequestOptions } from "libs/request";
import Toast, { type Message } from "libs/toast";
import { sleep } from "libs/utils";

/**
 * Discriminated-union failure reason for a rest_api.ts call, classified from
 * whatever libs/request.ts / handle_request_error_helper.tsx currently rejects with
 * (a plain object for HTTP errors, a mutated Error for network/timeout failures).
 * Centralizing the classification here means we can later make request.ts throw
 * proper typed errors without touching any rest_api.ts call site.
 */
export type RestApiErrorKind = "network" | "timeout" | "abort" | "http" | "unknown";

export type RestApiError = {
  kind: RestApiErrorKind;
  status?: number; // only present for kind === "http"
  message: string;
  cause: unknown; // the original rejection value, for logging / ErrorHandling.notify
};

// Named ApiResult (not Result) because admin/voxelytics/utils.ts already
// exports an unrelated `Result<T>` (a UI loading-state union).
export type ApiResult<T, E = RestApiError> = { ok: true; value: T } | { ok: false; error: E };

export type RetryOptions = {
  retries?: number; // default 3
  initialDelayMs?: number; // default 500
  backoffFactor?: number; // default 2
  maxDelayMs?: number; // default 8000
  overallTimeoutMs?: number; // optional cap across all attempts combined; default: none
  isRetryable?: (error: RestApiError) => boolean; // default: network/timeout + http 5xx
};

function classifyError(cause: unknown): RestApiError {
  if (cause instanceof Error && cause.name === "AbortError") {
    return { kind: "abort", message: cause.message, cause };
  }
  if (cause instanceof Error && cause.message === "Timeout") {
    return { kind: "timeout", message: cause.message, cause };
  }
  if (typeof cause === "object" && cause !== null && "status" in cause) {
    const status = (cause as { status?: number }).status;
    const messages = (cause as { messages?: Message[] }).messages;
    return {
      kind: "http",
      status,
      message: messages?.[0]?.error ?? `Request failed with status ${status}`,
      cause,
    };
  }
  if (cause instanceof Error) {
    return { kind: "network", message: cause.message, cause };
  }
  return { kind: "unknown", message: String(cause), cause };
}

function defaultIsRetryable(error: RestApiError): boolean {
  if (error.kind === "network" || error.kind === "timeout") return true;
  if (error.kind === "http" && error.status != null && error.status >= 500) return true;
  return false;
}

// Mirrors the Toast.messages/Toast.error branching in handle_request_error_helper.tsx,
// so the *one* toast we show (see requestResult below) looks the same as today's.
function showErrorToastFor(error: RestApiError): void {
  const messages = (error.cause as { messages?: Message[] } | undefined)?.messages;
  if (error.kind === "http" && messages) {
    Toast.messages(messages);
  } else {
    Toast.error(error.message);
  }
}

/**
 * Runs `requester` (typically a thin wrapper around one Request.* call),
 * retrying with exponential backoff while `isRetryable` says so, and always
 * resolves (never rejects) with an ApiResult.
 *
 * `requester` receives `adaptedOptions` — the caller's `options` with
 * `showErrorToast` forced to `false` for the duration of the retry loop
 * so that no error toast is shown when a retry is pending.
 */
export async function requestResult<T>(
  requester: (adaptedOptions: RequestOptions) => Promise<T>,
  options: RequestOptions = {},
  retryOptions: RetryOptions = {},
): Promise<ApiResult<T>> {
  const {
    retries = 3,
    initialDelayMs = 500,
    backoffFactor = 2,
    maxDelayMs = 8000,
    overallTimeoutMs,
    isRetryable = defaultIsRetryable,
  } = retryOptions;
  const showErrorToast = options.showErrorToast ?? true;
  const deadline = overallTimeoutMs != null ? Date.now() + overallTimeoutMs : null;
  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    try {
      const value = await requester({ ...options, showErrorToast: false });
      return { ok: true, value };
    } catch (cause) {
      const error = classifyError(cause);
      const outOfAttempts = attempt >= retries;
      const outOfTime = deadline != null && Date.now() >= deadline;
      if (outOfAttempts || outOfTime || !isRetryable(error)) {
        if (showErrorToast) showErrorToastFor(error);
        return { ok: false, error };
      }
      attempt++;
      await sleep(Math.min(delay, maxDelayMs));
      delay *= backoffFactor;
    }
  }
}

// Escape hatch for call sites that aren't ready to branch on ApiResult yet —
// restores today's throw-based behavior with a one-line change.
export function unwrapOrThrow<T>(result: ApiResult<T>): T {
  if (result.ok) return result.value;
  throw result.error.cause instanceof Error ? result.error.cause : new Error(result.error.message);
}
