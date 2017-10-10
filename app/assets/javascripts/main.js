/**
 * main.js
 * @flow weak
 */

import $ from "jquery";
import Backbone from "backbone";
import ErrorHandling from "libs/error_handling";
import Request from "libs/request";
import app from "app";
import { getWebGLReport } from "libs/webgl_stats";

import "bootstrap";
import "jasny-bootstrap";
import "whatwg-fetch";
import "es6-promise";
import "libs/core_ext";
import "backbone.marionette";

import "../stylesheets/main.less";
// import Router from "./router";
import React from "react";
import ReactRouter from "./react_router";
import ReactDOM from "react-dom";

ErrorHandling.initialize({ throwAssertions: false, sendLocalErrors: false });

app.on("start", () => {
  // app.router = new Router();
  // return Backbone.history.start({ pushState: true });
});

app.on("start", async () => {
  try {
    const user = await Request.receiveJSON("/api/user", { doNotCatch: true });
    app.currentUser = user;

    ErrorHandling.setCurrentUser(user);
    ReactDOM.render(React.createElement(ReactRouter), document.body);
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
