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
import createBrowserHistory from "history/createBrowserHistory";

class OxalisApplication extends Marionette.Application {
  oxalis: ?OxalisController;
  currentUser: APIUserType;
  history: typeof createBrowserHistory;
}

// eslint-disable-next-line no-unused-vars
const app = new OxalisApplication();

// legacy mock
// TODO remove
app.router = {
  hideLoadingSpinner: _.noop,
};

app.history = createBrowserHistory();

window.app = app;

export default app;
