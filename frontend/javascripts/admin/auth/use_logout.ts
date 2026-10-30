import { unwrapOrThrow } from "admin/api/api_result";
import { logoutUser, logoutUserEverywhere } from "admin/rest_api";
import { reactQueryClient } from "libs/react_query_client";
import { location } from "libs/window";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router";
import { logoutUserAction } from "viewer/model/actions/user_actions";

/*
 * Returns a function that logs out the active user and cleans up all client-side state that
 * belongs to them. All logouts should go through this hook so that no user data (e.g. the
 * shared react-query cache) survives into the next login in the same tab.
 * - everywhere: false logs out this session and hard-navigates to the redirect URL
 *   provided by the backend.
 * - everywhere: true invalidates all sessions of the user and navigates to the login page.
 * Errors of the logout request are thrown so that callers can show their own message.
 */
export function useLogout() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  return useCallback(
    async ({ everywhere }: { everywhere: boolean }) => {
      let redirectUrl: string | null = null;
      if (everywhere) {
        unwrapOrThrow(await logoutUserEverywhere());
      } else {
        redirectUrl = unwrapOrThrow(await logoutUser());
      }

      reactQueryClient.clear();
      dispatch(logoutUserAction());

      if (redirectUrl != null) {
        location.href = redirectUrl;
      } else {
        navigate("/auth/login");
      }
    },
    [dispatch, navigate],
  );
}
