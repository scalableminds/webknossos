import $ from "jquery";
import _ from "lodash";
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

ErrorHandling.initialize({ throwAssertions : false, sendLocalErrors : false });

import Router from "./router";

app.on("start", function() {
  app.router = new Router();
  return Backbone.history.start({ pushState : true });
});

app.on("start", () =>
  Request.receiveJSON("/api/user", {doNotCatch : true})
    .then(function(user) {
      app.currentUser = user;
      ErrorHandling.setCurrentUser(user);
    }).catch(function(error) {  })
);

app.on("start", () => {
  // set app.vent to the global radio channel
  app.vent = Backbone.Radio.channel('global')
});


$(function() {
  // show the bootstrap flash modal on load
  $("#flashModal").modal("show");

  return app.start();
});

