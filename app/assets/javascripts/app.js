/**
 * app.js
 * @flow
 */
import Marionette from "backbone.marionette";
import OxalisController from "oxalis/controller";
import window from "libs/window";

class OxalisApplication extends Marionette.Application {
  oxalis: ?OxalisController;
}

// eslint-disable-next-line no-unused-vars
const app = new OxalisApplication();
window.app = app;

export default app;
