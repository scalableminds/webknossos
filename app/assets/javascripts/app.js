/**
 * app.js
 * @flow
 */

import Marionette from "backbone.marionette";
import type Router from "router";
import typeof OxalisController from "oxalis/controller";
import window from "libs/window";

type UserType = {
  firstName: string,
  lastName: string,
  email: string,
  isAnonymous: bool,
  id: string,
}

class OxalisApplication extends Marionette.Application {
  router: Router;
  oxalis: ?OxalisController;
  currentUser: UserType;
}

// eslint-disable-next-line no-unused-vars
const app = new OxalisApplication();
window.app = app;

export default app;
