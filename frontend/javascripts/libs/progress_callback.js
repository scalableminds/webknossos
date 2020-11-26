// @flow

import { message } from "antd";
import { sleep } from "libs/utils";

export type ProgressCallback = (isDone: boolean, progressState: string) => Promise<void>;

// This function returns another function which can be called within a longer running
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
export default function createProgressCallback(options: {
  pauseDelay: number,
  successMessageDelay: number,
}): ProgressCallback {
  const { pauseDelay, successMessageDelay } = options;
  let hideFn = null;
  return async (isDone: boolean, status: string): Promise<void> => {
    if (hideFn != null) {
      // Clear old progress message
      hideFn();
      hideFn = null;
    }
    if (!isDone) {
      // Show new progress message
      hideFn = message.loading(status, 0);
      // Allow the browser to catch up with rendering the progress
      // indicator.
      await sleep(pauseDelay);
    } else {
      // Show success message and clear that after
      // ${successDelay} ms
      const successDelay = successMessageDelay;
      hideFn = message.success(status, 0);
      setTimeout(() => {
        if (hideFn == null) {
          return;
        }
        hideFn();
        hideFn = null;
      }, successDelay);
    }
  };
}
