/**
 * app.js
 * @flow
 */
import _ from "lodash";
import Marionette from "backbone.marionette";
import typeof OxalisController from "oxalis/controller";
import window from "libs/window";
import type { APIUserType } from "admin/api_flow_types";
import createBrowserHistory from "history/createBrowserHistory";

class OxalisApplication extends Marionette.Application {
  oxalis: ?OxalisController;
  currentUser: APIUserType;
  history: any;
}

// eslint-disable-next-line no-unused-vars
const app = new OxalisApplication();

app.history = createBrowserHistory();

window.app = app;

export default app;
