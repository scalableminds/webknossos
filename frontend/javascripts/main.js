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
        <Router />
      </Provider>,
      containerElement,
    );
  }
});
