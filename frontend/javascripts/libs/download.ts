import { saveAs } from "file-saver";
import Request from "libs/request";

/**
 * Extracts the file name from a Content-Disposition header value.
 * Prefers the RFC 5987 encoded `filename*` parameter over the plain `filename` one.
 */
export function parseFilenameFromContentDisposition(
  contentDisposition: string | null | undefined,
): string | null {
  if (contentDisposition == null) {
    return null;
  }

  const encodedMatch = contentDisposition.match(/filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i);
  if (encodedMatch != null) {
    try {
      return decodeURIComponent(encodedMatch[2].trim().replace(/^"(.*)"$/, "$1"));
    } catch {
      // Fall through to the plain filename parameter.
    }
  }

  const plainMatch = contentDisposition.match(/filename\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;]+))/i);
  if (plainMatch != null) {
    const filename = plainMatch[1] != null ? plainMatch[1].replace(/\\(.)/g, "$1") : plainMatch[2];
    return filename.trim() || null;
  }

  return null;
}

/**
 * Fetches the given URL and saves the response as a file once it was fully received.
 * In contrast to a plain link navigation, the returned promise only resolves after the
 * download is complete (and rejects on errors, which are shown as a toast), so that
 * callers can display a loading state in the meantime.
 */
export async function fetchAndSaveFile(url: string): Promise<void> {
  const { blob, filename } = await Request.triggerRequest(url, {}, async (response: Response) => ({
    blob: await response.blob(),
    filename: parseFilenameFromContentDisposition(response.headers.get("Content-Disposition")),
  }));
  saveAs(blob, filename ?? undefined);
}
