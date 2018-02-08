/**
 * app.js
 * @flow
 */
import window from "libs/window";
import BackboneEvents from "backbone-events-standalone";

class OxalisApplication {
  vent = Object.assign({}, BackboneEvents);
}

const app = new OxalisApplication();
window.app = app;

export default app;
