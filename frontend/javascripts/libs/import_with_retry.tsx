import { Button } from "antd";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import { retryAsyncFunction } from "libs/utils";
import window from "libs/window";

// Dynamically imported modules can fail to load, for example, because
// - a new WEBKNOSSOS version was deployed and the URLs of the old chunks
//   the client knows about are no longer valid, or
// - the network or the server is flaky.
// This module makes dynamic import() calls resilient against such errors
// by retrying the import and by informing the user about the problem
// (instead of crashing). See https://github.com/scalableminds/webknossos/issues/9540

const RETRY_COUNT = 2; // 2 retries == 3 attempts in total
const RETRY_DELAY_FACTOR_MS = 500; // leads to delays of 1s and 2s between the attempts

const FAILED_IMPORT_TOAST_KEY = "failed-dynamic-import";

export type DynamicImportFailureReason = "new-version" | "network";

// Thrown by importWithRetry when all retries are exhausted. The `reason` field
// tells call sites whether the failure was due to a new deployment (stale chunk
// URLs) or a network/server problem — so they can show appropriate feedback.
export class DynamicImportError extends Error {
  readonly reason: DynamicImportFailureReason;

  constructor(reason: DynamicImportFailureReason, cause?: unknown) {
    super(`Failed to load a dynamically imported module (reason: ${reason})`);
    this.name = "DynamicImportError";
    this.reason = reason;
    // `cause` is part of the ES2022 Error spec and is supported in all modern
    // browsers; it lets error reporters (e.g. Airbrake) see the original error.
    if (cause != null) {
      (this as any).cause = cause;
    }
  }
}

async function isNewerVersionDeployed(): Promise<boolean> {
  try {
    // Deliberately not using getBuildInfo() from admin/rest_api here to keep
    // the import graph of this module minimal (it is imported by modules which
    // are loaded very early).
    const response = await fetch("/api/buildinfo");
    const { webknossos } = await response.json();
    return (
      ErrorHandling.commitHash != null &&
      webknossos?.commitHash != null &&
      ErrorHandling.commitHash !== webknossos.commitHash
    );
  } catch (_error) {
    return false;
  }
}

// reason is optional: if omitted (e.g. from the vite:preloadError handler in
// main.tsx), the version check is performed here instead.
export async function notifyUserAboutFailedDynamicImport(reason?: DynamicImportFailureReason) {
  const resolvedReason = reason ?? ((await isNewerVersionDeployed()) ? "new-version" : "network");
  const message =
    resolvedReason === "new-version"
      ? "A new version of WEBKNOSSOS was released. Please reload the page to avoid errors."
      : "Some parts of WEBKNOSSOS could not be loaded (the server might be unreachable). Please check your network connection and reload the page.";
  Toast.error(message, {
    sticky: true,
    // Use a fixed key so that multiple failed imports only produce a single toast.
    key: FAILED_IMPORT_TOAST_KEY,
    customFooter: (
      <Button type="primary" size="small" onClick={() => window.location.reload()}>
        Reload Page
      </Button>
    ),
  });
}

export default async function importWithRetry<T>(
  importFn: () => Promise<T>,
  { showErrorToast = true }: { showErrorToast?: boolean } = {},
): Promise<T> {
  try {
    return await retryAsyncFunction(importFn, RETRY_COUNT, RETRY_DELAY_FACTOR_MS);
  } catch (originalError) {
    console.error("Failed to load dynamically imported module.", originalError);
    // Determine the reason before throwing so callers can read it off the error.
    const reason: DynamicImportFailureReason = (await isNewerVersionDeployed())
      ? "new-version"
      : "network";
    ErrorHandling.notify(originalError as Error, { context: "dynamic-import", reason });
    if (showErrorToast) {
      notifyUserAboutFailedDynamicImport(reason);
    }
    throw new DynamicImportError(reason, originalError);
  }
}
