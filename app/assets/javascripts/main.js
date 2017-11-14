/**
 * main.js
 * @flow
 */

import $ from "jquery";
import Backbone from "backbone";
import ErrorHandling from "libs/error_handling";
import app from "app";

import React from "react";
import ReactRouter from "react_router";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";
import Store from "oxalis/throttled_store";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";

import "bootstrap";
import "jasny-bootstrap";
import "whatwg-fetch";
import "es6-promise";
import "libs/core_ext";
import "backbone.marionette";

import { getActiveUser } from "admin/admin_rest_api";

// $FlowFixMe: CSS/LESS imports are a special WebPack feature
import "../stylesheets/main.less";

ErrorHandling.initialize({ throwAssertions: false, sendLocalErrors: false });

app.on("start", async () => {
  ReactDOM.render(
    <Provider store={Store}>
      <ReactRouter />
    </Provider>,
    document.getElementById("main-container"),
  );
});

app.on("start", async () => {
  try {
    const user = await getActiveUser({ doNotCatch: true });
    Store.dispatch(setActiveUserAction(user));
    ErrorHandling.setCurrentUser(user);
  } catch (e) {
    // pass
  }
});

app.on("start", () => {
  // set app.vent to the global radio channel
  app.vent = Backbone.Radio.channel("global");
});

$(() => {
  // show the bootstrap flash modal on load
  $("#flashModal").modal("show");

  return app.start();
});
