import { Button } from "antd";
import type { ServerErrorMessage } from "types/api_types";
import Toast, { showToastOnce } from "./toast";

let _pingFn: (str: string) => void = () => {
  console.warn(
    "pingMentionedDataStores was called before registerPingFn — datastore health check skipped",
  );
};

export function registerPingFn(fn: (str: string) => void): void {
  _pingFn = fn;
}

function parseJsonSafely(text: string): Record<string, any> | null {
  try {
    const json = JSON.parse(text);
    return json != null && typeof json === "object" && !Array.isArray(json) ? json : null;
  } catch (_jsonError) {
    return null;
  }
}

// Most webknossos error responses contain a `messages` list. Some responses (e.g. the
// "Authentication required" response of the authentication library) only contain a single
// `message` string instead, which is converted into the same format here.
function extractServerErrorMessages(json: Record<string, any>): ServerErrorMessage[] | null {
  if (Array.isArray(json.messages)) {
    return json.messages;
  }
  if (typeof json.message === "string") {
    return [{ error: json.message }];
  }
  return null;
}

export const handleError = async (
  requestedUrl: string,
  showErrorToast: boolean,
  doInvestigate: boolean,
  error: Response | Error | DOMException,
): Promise<void> => {
  if (doInvestigate) {
    // Check whether this request failed due to a problematic datastore
    _pingFn(requestedUrl);
    if (error instanceof Response) {
      // Handle 401 Unauthorized errors and ensure an understandable error toast is shown.
      // This might happen e.g. after a user logged out everywhere.
      const showSessionExpiredToast = error.status === 401 && showErrorToast;
      if (showSessionExpiredToast) {
        showToastOnce(
          "error",
          <>
            Your session has expired. Please refresh the page
            <br />
            <Button type="default" onClick={() => location.reload()}>
              Refresh
            </Button>
          </>,
          { timeout: 10000, sticky: true },
        );
      }
      return error.text().then(
        (text) => {
          const json = parseJsonSafely(text);
          const serverMessages = json != null ? extractServerErrorMessages(json) : null;
          if (json != null && serverMessages != null) {
            // Propagate HTTP status code for further processing down the road
            if (error.status != null) {
              json.status = error.status;
            }

            const messages = serverMessages.map((message) => ({
              ...message,
              key: String(json.status),
            }));
            // A generic "Authentication required" message (i.e., one that is not part of the
            // structured `messages` list) is already covered by the session expired toast above.
            const isCoveredBySessionExpiredToast =
              showSessionExpiredToast && !Array.isArray(json.messages);
            if (showErrorToast && !isCoveredBySessionExpiredToast) {
              Toast.messages(messages); // Note: Toast.error internally logs to console
            } else {
              console.error(messages);
            }
            // Check whether the error chain mentions an url which belongs
            // to a datastore. Then, ping the datastore
            _pingFn(text);

            /* eslint-disable-next-line prefer-promise-reject-errors */
            return Promise.reject({ ...json, messages: serverMessages, url: requestedUrl });
          }

          // The response body is not in the expected JSON format. Show it as-is,
          // unless the session expired toast already explains the error.
          if (showErrorToast && !showSessionExpiredToast) {
            Toast.error(text); // Note: Toast.error internally logs to console
          } else {
            console.error(`Request failed for ${requestedUrl}:`, text);
          }

          /* eslint-disable-next-line prefer-promise-reject-errors */
          return Promise.reject({
            errors: [text],
            status: error.status != null ? error.status : -1,
            url: requestedUrl,
          });
        },
        (textError) => {
          Toast.error(textError.toString());
          return Promise.reject(textError);
        },
      );
    }
  }

  // If doInvestigate is false but the error is still a Response, read the body
  // so callers get a proper Error with the status and body text instead of a
  // raw Response object (whose body is a ReadableStream that can't be inspected).
  if (error instanceof Response) {
    const text = await error.text().catch(() => "<unreadable body>");
    return Promise.reject(
      new Error(`Request failed with status ${error.status} for ${requestedUrl}: ${text}`),
    );
  }

  // DOMException (e.g. an aborted fetch, whether via a caller-supplied signal or
  // an options.timeout-triggered abort in request.ts) isn't an Error subclass and
  // its .message shouldn't be mutated -- just propagate it as-is so callers can
  // still detect it via error.name === "AbortError".
  if (error instanceof DOMException) {
    return Promise.reject(error);
  }

  error.message += ` - Url: ${requestedUrl}`;
  return Promise.reject(error);
};
