/**
 * main.js
 * @flow weak
 */

import Backbone from "backbone";
import ErrorHandling from "libs/error_handling";
import Request from "libs/request";
import app from "app";

import "bootstrap";
import "jasny-bootstrap";
import "whatwg-fetch";
import "es6-promise";
import "libs/core_ext";
import "backbone.marionette";

import "../stylesheets/main.less";
import Router from "./router";

ErrorHandling.initialize({ throwAssertions: false, sendLocalErrors: false });

app.on("start", () => {
  app.router = new Router();
  return Backbone.history.start({ pushState: true });
});

app.on("start", async () => {
  try {
    const user = await Request.receiveJSON("/api/user", { doNotCatch: true });
    app.currentUser = user;
    ErrorHandling.setCurrentUser(user);
  } catch (e) {
    // pass
  }
});

app.on("start", () => {
  // set app.vent to the global radio channel
  app.vent = Backbone.Radio.channel("global");
});

document.addEventListener("DOMContentLoaded", () => {
  app.start();
});
