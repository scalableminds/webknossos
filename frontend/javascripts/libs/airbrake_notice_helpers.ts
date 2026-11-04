import type { INotice } from "@airbrake/browser";

// Airbrake groups errors by type, message, file and environment. To keep the grouping
// of long messages (which often contain varying ids, urls or tokens) somewhat stable, only the
// first characters of the message are used for prefixed errors.
const MAX_GROUPING_MESSAGE_LENGTH = 80;

// Name of the notice param that carries the untruncated message (see notifyWithPrefix).
export const ORIGINAL_ERROR_PARAM = "originalError";
const ORIGINAL_ERROR_TYPE = "OriginalError";

export function getPrefixedErrorMessage(
  prefix: string,
  maybeError: unknown,
): { prefixedMessage: string; fullMessage: string } {
  const fullMessage =
    maybeError instanceof Error ? maybeError.toString() : JSON.stringify(maybeError);
  const prefixedMessage = prefix + fullMessage.slice(0, MAX_GROUPING_MESSAGE_LENGTH);

  return { prefixedMessage, fullMessage };
}

// The untruncated message is passed as a notice param. However, the Airbrake notifier shrinks
// the string limit of params (1024 characters at first, then less and less) when a notice
// exceeds the maximum size, e.g., because of a large action log. Also, params are not easy to
// find in the Airbrake UI.
// Therefore, the full message is moved into an additional entry of `notice.errors`. Airbrake
// displays these as the cause chain of the error. Grouping only considers the first
// entry, which keeps the (truncated) message and thus the grouping unchanged.
// Entries of `notice.errors` are truncated once to 1024 characters, but never shrunk further.
// If the message wasn't cut, the first error already contains it completely (after the prefix),
// so no additional entry is added.
export function moveOriginalErrorToNoticeErrors(notice: INotice): INotice {
  const originalError = notice.params?.[ORIGINAL_ERROR_PARAM];
  if (typeof originalError !== "string") {
    return notice;
  }
  const { [ORIGINAL_ERROR_PARAM]: _removed, ...remainingParams } = notice.params;
  notice.params = remainingParams;

  const firstError = notice.errors?.[0];
  const wasMessageCut = originalError.length > MAX_GROUPING_MESSAGE_LENGTH;
  if (firstError != null && wasMessageCut) {
    notice.errors = [
      ...(notice.errors ?? []),
      {
        type: ORIGINAL_ERROR_TYPE,
        message: originalError,
        // Reuse the backtrace, because Airbrake expects one for each error.
        backtrace: firstError.backtrace,
      },
    ];
  }
  return notice;
}
