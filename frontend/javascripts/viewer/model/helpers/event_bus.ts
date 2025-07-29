import { type Emitter, createNanoEvents } from "nanoevents";

type ActionPayload = {
  type: string;
  [key: string]: any;
};

type Events = {
  [actionType: string]: (action: ActionPayload) => void;
};

export const eventBus: Emitter<Events> = createNanoEvents<Events>();
