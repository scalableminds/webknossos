import { Button } from "antd";
import type { ServerErrorMessage } from "types/api_types";
import Toast, { showToastOnce } from "./toast";

export const handleError = async (
  requestedUrl: string,
  showErrorToast: boolean,
  doInvestigate: boolean,
  error: Response | Error,
): Promise<void> => {
  if (doInvestigate) {
    // Avoid circular imports via dynamic import
    const { pingMentionedDataStores } = await import("admin/datastore_health_check");
    // Check whether this request failed due to a problematic datastore
    pingMentionedDataStores(requestedUrl);
    if (error instanceof Response) {
      // Handle 401 Unauthorized errors and ensure an understandable error toast is shown.
      // This might happen e.g. after a user logged out everywhere.
      if (error.status === 401 && showErrorToast) {
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
          try {
            const json = JSON.parse(text);

            // Propagate HTTP status code for further processing down the road
            if (error.status != null) {
              json.status = error.status;
            }

            const messages = json.messages.map((message: ServerErrorMessage[]) => ({
              ...message,
              key: json.status.toString(),
            }));
            if (showErrorToast) {
              Toast.messages(messages); // Note: Toast.error internally logs to console
            } else {
              console.error(messages);
            }
            // Check whether the error chain mentions an url which belongs
            // to a datastore. Then, ping the datastore
            pingMentionedDataStores(text);

            /* eslint-disable-next-line prefer-promise-reject-errors */
            return Promise.reject({ ...json, url: requestedUrl });
          } catch (_jsonError) {
            if (showErrorToast) {
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
          }
        },
        (textError) => {
          Toast.error(textError.toString());
          return Promise.reject(textError);
        },
      );
    }
  }

  // If doInvestigate is false or the error is not instanceof Response,
  // still add additional information to the error
  if (!(error instanceof Response)) {
    error.message += ` - Url: ${requestedUrl}`;
  }

  return Promise.reject(error);
};
