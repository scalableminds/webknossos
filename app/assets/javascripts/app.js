/**
 * app.js
 * @flow
 */
import type OxalisController from "oxalis/controller";
import window from "libs/window";
import BackboneEvents from "backbone-events-standalone";

class OxalisApplication {
  oxalis: ?OxalisController;
  vent = Object.assign({}, BackboneEvents);
}

// eslint-disable-next-line no-unused-vars
const app = new OxalisApplication();
window.app = app;

export default app;
