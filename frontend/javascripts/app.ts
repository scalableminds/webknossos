// @flow
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'back... Remove this comment to see the full error message
import BackboneEvents from "backbone-events-standalone";
import window from "libs/window";

class OxalisApplication {
  vent = Object.assign({}, BackboneEvents);
}

const app = new OxalisApplication();
// @ts-expect-error ts-migrate(2339) FIXME: Property 'app' does not exist on type '(Window & t... Remove this comment to see the full error message
window.app = app;
export default app;
