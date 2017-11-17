/**
 * main.js
 * @flow
 */

import ErrorHandling from "libs/error_handling";

import React from "react";
import ReactRouter from "react_router";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";
import Store from "oxalis/throttled_store";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";

import "whatwg-fetch";
import "es6-promise";

import { getActiveUser } from "admin/admin_rest_api";

// $FlowFixMe: CSS/LESS imports are a special WebPack feature
import "../stylesheets/main.less";

document.addEventListener("DOMContentLoaded", async () => {
  ErrorHandling.initialize({ throwAssertions: false, sendLocalErrors: false });

  const containerElement = document.getElementById("main-container");
  if (containerElement) {
    ReactDOM.render(
      <Provider store={Store}>
        <ReactRouter />
      </Provider>,
      containerElement,
    );
  }

  // try retreive the currently active user if logged in
  try {
    const user = await getActiveUser({ doNotCatch: true });
    Store.dispatch(setActiveUserAction(user));
    ErrorHandling.setCurrentUser(user);
  } catch (e) {
    // pass
  }
});
