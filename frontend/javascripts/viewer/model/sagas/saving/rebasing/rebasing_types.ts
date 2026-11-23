// Describes why applying update actions (and thus rebasing) failed. It is reported to Airbrake
// by the version polling saga (see version_poll_saga.ts).
export type RebasingFailure = {
  // A stable description without ids so that Airbrake groups the reports.
  reason: string;
  // Expected failures (e.g., another user reverted the annotation) are reported as warnings.
  isExpected?: boolean;
  error?: unknown;
  details?: Record<string, unknown>;
};

export type ApplyingUpdatesResult =
  | { success: true }
  | { success: false; failure: RebasingFailure };
