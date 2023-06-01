import window from "libs/window";
import { createNanoEvents } from "nanoevents";

class OxalisApplication {
  vent = createNanoEvents();
}

const app = new OxalisApplication();
(window as any).app = app;

export default app;
