/**
 * app.js
 * @flow
 */

import Marionette from "backbone.marionette";
import type Router from "router";
import OxalisController from "oxalis/controller";
import window from "libs/window";
import type { APIUserType } from "admin/api_flow_types";

class OxalisApplication extends Marionette.Application {
  router: Router;
  oxalis: ?OxalisController;
  currentUser: APIUserType;
}

// eslint-disable-next-line no-unused-vars
const app = new OxalisApplication();
window.app = app;

export default app;
