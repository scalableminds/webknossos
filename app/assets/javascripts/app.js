/**
 * app.js
 * @flow
 */

import Marionette from "backbone.marionette";
import Router from "router";
import OxalisController from "oxalis/controller";

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
let app;

export default window.app = app = new OxalisApplication();
