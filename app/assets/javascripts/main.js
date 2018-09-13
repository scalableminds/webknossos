/**
 * main.js
 * @flow
 */

import ErrorHandling from "libs/error_handling";

import React from "react";
import Router from "router";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";
import { load as loadFeatureToggles } from "features";
import Store from "oxalis/throttled_store";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { googleAnalyticsLogClicks } from "oxalis/model/helpers/google_analytics_middleware";

import "whatwg-fetch";
import "es6-promise";

import { getActiveUser } from "admin/admin_rest_api";

import "../stylesheets/main.less";

async function loadActiveUser() {
  // Try to retreive the currently active user if logged in
  try {
    const user = await getActiveUser({ dontShowErrorToast: true });
    Store.dispatch(setActiveUserAction(user));
    ErrorHandling.setCurrentUser(user);
  } catch (e) {
    // pass
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  ErrorHandling.initialize({ throwAssertions: false, sendLocalErrors: false });

  document.addEventListener("click", googleAnalyticsLogClicks);
  await Promise.all([loadFeatureToggles(), loadActiveUser()]);

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
