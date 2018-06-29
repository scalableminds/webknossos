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

import "whatwg-fetch";
import "es6-promise";

import { getActiveUser } from "admin/admin_rest_api";

// $FlowFixMe: CSS/LESS imports are a special WebPack feature
import "../stylesheets/main.less";

document.addEventListener("DOMContentLoaded", async () => {
  ErrorHandling.initialize({ throwAssertions: false, sendLocalErrors: false });

  // try retreive the currently active user if logged in
  try {
    // eslint-disable-next-line no-unused-vars
    const [_, user] = await Promise.all([
      loadFeatureToggles(),
      getActiveUser({ doNotCatch: true }),
    ]);
    Store.dispatch(setActiveUserAction(user));
    ErrorHandling.setCurrentUser(user);
  } catch (e) {
    // pass
  }

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
