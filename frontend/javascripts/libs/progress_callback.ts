// @flow
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'utility-types' or its correspo... Remove this comment to see the full error message
import { $Shape } from "utility-types";
import { message } from "antd";
import { sleep } from "libs/utils";
type HideFn = () => void;
export type ProgressCallback = (
  isDone: boolean,
  progressState: string | React.ReactNode,
) => Promise<{
  hideFn: HideFn;
}>;
type Options = {
  pauseDelay: number;
  successMessageDelay: number;
  key?: string;
}; // This function returns another function which can be called within a longer running
// process to update the UI with progress information. Example usage:
// const progressCallback = createProgressCallback({ pauseDelay: 100, successMessageDelay: 5000 });
// await progressCallback(false, "Beginning work...")
// ... long running code
// await progressCallback(false, "First part done...")
// ... long running code
// await progressCallback(true, "Success!")
//
// The `progressCallback` should be awaited so that the UI can catch up
// with rendering the actual feedback.

export default function createProgressCallback(options: Options): ProgressCallback {
  // @ts-expect-error ts-migrate(7034) FIXME: Variable 'hideFn' implicitly has type 'any' in som... Remove this comment to see the full error message
  let hideFn = null;
  return async (
    isDone: boolean,
    status: string | React.ReactNode,
    overridingOptions: $Shape<Options> = {},
    finalFeedbackMethod: "success" | "error" | "info" | "warning" = "success",
  ): Promise<{
    hideFn: HideFn;
  }> => {
    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'hideFn' implicitly has an 'any' type.
    if (hideFn != null) {
      // Clear old progress message
      // @ts-expect-error ts-migrate(7005) FIXME: Variable 'hideFn' implicitly has an 'any' type.
      hideFn();
      hideFn = null;
    }

    if (!isDone) {
      // Show new progress message
      hideFn = message.loading({
        content: status,
        duration: 0,
        key: overridingOptions.key || options.key,
      });
      // Allow the browser to catch up with rendering the progress
      // indicator.
      const pauseDelay = overridingOptions.pauseDelay || options.pauseDelay;
      await sleep(pauseDelay);
    } else {
      // Show (success) message and clear that after
      // ${successDelay} ms
      const successDelay = overridingOptions.successMessageDelay || options.successMessageDelay;
      hideFn = message[finalFeedbackMethod]({
        content: status,
        duration: 0,
        key: overridingOptions.key || options.key,
      });
      setTimeout(() => {
        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'hideFn' implicitly has an 'any' type.
        if (hideFn == null) {
          return;
        }

        // @ts-expect-error ts-migrate(7005) FIXME: Variable 'hideFn' implicitly has an 'any' type.
        hideFn();
        hideFn = null;
      }, successDelay);
    }

    // hideFn seems to be awaitable, but the caller only wants to await the
    // async progressCallback function, not the hideFn. Wrap it in an object, therefore.
    return {
      hideFn,
    };
  };
}
