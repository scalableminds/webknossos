/**
 * app.js
 * @flow
 */
import _ from "lodash";
import Marionette from "backbone.marionette";
import type Router from "router";
import typeof OxalisController from "oxalis/controller";
import window from "libs/window";
import type { APIUserType } from "admin/api_flow_types";

class OxalisApplication extends Marionette.Application {
  router: Router;
  oxalis: ?OxalisController;
  currentUser: APIUserType;
}

// eslint-disable-next-line no-unused-vars
const app = new OxalisApplication();
app.router = {
  navigate: _.noop,
  loadURL: _.noop,
  hideLoadingSpinner: _.noop,
};
window.app = app;

export default app;
