/**
 * main.js
 * @flow
 */

import $ from "jquery";
import Backbone from "backbone";
import ErrorHandling from "libs/error_handling";
import Request from "libs/request";
import app from "app";
import { getWebGLReport } from "libs/webgl_stats";

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
  app.currentUser = {
    id: "59cbd00f5bd4c0f801061856",
    email: "scmboy@scalableminds.com",
    firstName: "SCM",
    lastName: "Boy",
    isActive: true,
    teams: [{ team: "Connectomics department", role: { name: "admin" } }],
    experiences: { asd: 10 },
    lastActivity: 1507566685002,
    isAnonymous: false,
    isEditable: true,
  };
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

app.on("start", () => {
  // send WebGL analytics once per session
  if (!window.sessionStorage.getItem("hasSentWebGLAnalytics")) {
    try {
      const webGLStats = getWebGLReport();
      Request.sendJSONReceiveJSON("/api/analytics/webgl", {
        data: webGLStats,
      });
      window.sessionStorage.setItem("hasSentWebGLAnalytics", true);
    } catch (error) {
      ErrorHandling.notify(error);
    }
  }
});

$(() => {
  // show the bootstrap flash modal on load
  $("#flashModal").modal("show");

  return app.start();
});
