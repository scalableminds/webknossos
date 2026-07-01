import { Button } from "antd";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import window from "libs/window";

// Dynamically imported modules can fail to load, for example, because
// - a new WEBKNOSSOS version was deployed and the URLs of the old chunks
//   the client knows about are no longer valid, or
// - the network or the server is flaky.
// This module makes dynamic import() calls resilient against such errors by
// informing the user about the problem (instead of crashing) and offering a
// page reload. See https://github.com/scalableminds/webknossos/issues/9540
//
// Note: we deliberately do NOT retry the import as browsers cache the failed 
// import upon network problems. When the module is outdated reloading is the
// only solution anyway.

const FAILED_IMPORT_TOAST_KEY = "failed-dynamic-import";

export type DynamicImportFailureReason = "new-version-available" | "network";

// Thrown by importDynamic when the import fails. The `reason` field tells call
// sites whether the failure was due to a new deployment (stale chunk URLs) or a
// network/server problem — so they can show appropriate feedback.
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    // Deliberately not using getBuildInfo() from admin/rest_api here to keep
    // the import graph of this module minimal (it is imported by modules which
    // are loaded very early).
    const response = await fetch("/api/buildinfo", { signal: controller.signal });
    clearTimeout(timeoutId);
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

async function notifyUserAboutFailedDynamicImport(reason: DynamicImportFailureReason) {
  const message =
    reason === "new-version-available"
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

export default async function importDynamic<T>(
  importFn: () => Promise<T>,
  { showErrorToast = true }: { showErrorToast?: boolean } = {},
): Promise<T> {
  try {
    return await importFn();
  } catch (originalError) {
    console.error("Failed to load dynamically imported module.", originalError);
    // Determine the reason before throwing so callers can read it off the error.
    const reason: DynamicImportFailureReason = (await isNewerVersionDeployed())
      ? "new-version-available"
      : "network";
    ErrorHandling.notify(originalError as Error, { context: "dynamic-import", reason });
    if (showErrorToast) {
      notifyUserAboutFailedDynamicImport(reason);
    }
    throw new DynamicImportError(reason, originalError);
  }
}
