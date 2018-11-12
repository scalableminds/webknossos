/**
 * app.js
 * @flow
 */
import BackboneEvents from "backbone-events-standalone";

import window from "libs/window";

class OxalisApplication {
  vent = Object.assign({}, BackboneEvents);
}

const app = new OxalisApplication();
window.app = app;

export default app;
