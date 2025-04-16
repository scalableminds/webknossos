import { showVerificationReminderToast } from "admin/auth/verify_email_view";
import { takeEvery } from "typed-redux-saga";
import type { SetActiveUser } from "../actions/user_actions";

export function* warnIfEmailIsUnverified() {
  yield* takeEvery("SET_ACTIVE_USER", function handler(action: SetActiveUser) {
    const { user } = action;
    if (user && !user.isEmailVerified) {
      showVerificationReminderToast();
    }
  });
}
