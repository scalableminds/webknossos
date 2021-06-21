/**
 * main.js
 * @flow
 */

import { Provider } from "react-redux";
import React from "react";
import ReactDOM from "react-dom";

import { document } from "libs/window";
import { getActiveUser, checkAnyOrganizationExists } from "admin/admin_rest_api";
import { googleAnalyticsLogClicks } from "oxalis/model/helpers/analytics";
import { load as loadFeatureToggles } from "features";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { setHasOrganizationsAction } from "oxalis/model/actions/ui_actions";
import ErrorHandling from "libs/error_handling";
import Router from "router";
import Store from "oxalis/throttled_store";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";

async function loadActiveUser() {
  // Try to retreive the currently active user if logged in
  try {
    const user = await getActiveUser({ showErrorToast: false });
    Store.dispatch(setActiveUserAction(user));
    ErrorHandling.setCurrentUser(user);
  } catch (e) {
    // pass
  }
}

async function loadHasOrganizations() {
  // Check whether any organizations exist
  try {
    const hasOrganizations = await checkAnyOrganizationExists();
    Store.dispatch(setHasOrganizationsAction(hasOrganizations));
  } catch (e) {
    // pass
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  ErrorHandling.initialize({ throwAssertions: false, sendLocalErrors: false });

  document.addEventListener("click", googleAnalyticsLogClicks);
  await Promise.all([loadFeatureToggles(), loadActiveUser(), loadHasOrganizations()]);

  const containerElement = document.getElementById("main-container");
  if (containerElement) {
    ReactDOM.render(
      <Provider store={Store}>
        {/* The DnDProvider is necessary for the TreeHierarchyView. Otherwise, the view may crash in
        certain conditions. See https://github.com/scalableminds/webknossos/issues/5568 for context.
        The fix is inspired by:
        https://github.com/frontend-collective/react-sortable-tree/blob/9aeaf3d38b500d58e2bcc1d9b6febce12f8cc7b4/stories/barebones-no-context.js */}
        <DndProvider backend={HTML5Backend}>
          <Router />
        </DndProvider>
      </Provider>,
      containerElement,
    );
  }
});
