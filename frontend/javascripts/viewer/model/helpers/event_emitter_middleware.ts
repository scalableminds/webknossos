import type { Dispatch } from "redux";
import type { Action } from "viewer/model/actions/actions";
import { eventBus } from "./event_bus";

export const eventEmitterMiddleware =
  <A extends Action>() =>
  (next: Dispatch<A>) =>
  (action: A) => {
    eventBus.emit(action.type, action);
    return next(action);
  };
