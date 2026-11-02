import { useQueryClient } from "@tanstack/react-query";
import { getOrganization } from "admin/api/organization";
import { getActiveUser } from "admin/rest_api";
import ErrorHandling from "libs/error_handling";
import { useWkSelector } from "libs/react_hooks";
import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";

// The session cookie is shared between all tabs. Switching the organization (or logging in as
// someone else) in another tab therefore changes the user of all requests sent from this tab,
// while the active user and organization in the store stay the same until the page is reloaded.
// Whenever the tab regains focus, adopt the user of the session and refetch all queries, which
// were loaded for the previous user.
export function SyncActiveOrganization() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const dispatch = useDispatch();
  const queryClient = useQueryClient();
  const isSyncingRef = useRef(false);

  useEffect(() => {
    if (activeUser == null) {
      return;
    }

    const syncSessionUser = async () => {
      if (document.visibilityState !== "visible" || isSyncingRef.current) {
        return;
      }
      isSyncingRef.current = true;
      try {
        const user = await getActiveUser({ showErrorToast: false });
        if (user.id === activeUser.id && user.organization === activeUser.organization) {
          return;
        }
        const organization = await getOrganization(user.organization);
        // Update the user first, so that UserLocalStorage (which also backs the persisted
        // query cache) switches to the keys of the new user and organization.
        dispatch(setActiveUserAction(user));
        dispatch(setActiveOrganizationAction(organization));
        ErrorHandling.setCurrentUser(user);
        await queryClient.resetQueries();
      } catch (_e) {
        // The user might have logged out in another tab. Requests from this tab will fail
        // and redirect to the login anyway.
      } finally {
        isSyncingRef.current = false;
      }
    };

    // visibilitychange covers switching browser tabs, focus covers switching between windows.
    document.addEventListener("visibilitychange", syncSessionUser);
    window.addEventListener("focus", syncSessionUser);
    return () => {
      document.removeEventListener("visibilitychange", syncSessionUser);
      window.removeEventListener("focus", syncSessionUser);
    };
  }, [activeUser, dispatch, queryClient]);

  return null;
}
