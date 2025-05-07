import { createNanoEvents } from "nanoevents";

class WebknossosApplication {
  // This event emitter is currently only used for two types of events:
  // 1) webknossos:ready
  //    When WK is done with initialization, the front-end API can be constructed.
  // 2) rerender
  //    Most of the time, rendering happens when something in the Store changes. However,
  //    sometimes the store is not updated, but something in the ThreeJS scene is. In these
  //    cases an explicit rerender can be triggered with this event.
  vent = createNanoEvents();
}

const app = new WebknossosApplication();

export default app;
