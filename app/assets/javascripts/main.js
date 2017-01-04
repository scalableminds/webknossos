import $ from "jquery";
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

app.on("start", () =>
  Request.receiveJSON("/api/user", { doNotCatch: true })
    .then((user) => {
      app.currentUser = user;
      ErrorHandling.setCurrentUser(user);
      // eslint-disable-next-line no-unused-vars
    }).catch((error) => { }),
);

app.on("start", () => {
  // set app.vent to the global radio channel
  app.vent = Backbone.Radio.channel("global");
});


$(() => {
  // show the bootstrap flash modal on load
  $("#flashModal").modal("show");

  return app.start();
});

