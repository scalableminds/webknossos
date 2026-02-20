import type { Dispatch, Middleware, MiddlewareAPI } from "redux";
import type { Action } from "viewer/model/actions/actions";
import { eventBus } from "./event_bus";

export const eventEmitterMiddleware = function eventEmitterMiddleware(_store: MiddlewareAPI) {
  return (next: Dispatch<Action>) => (action: Action) => {
    eventBus.emit(action.type, action);
    return next(action);
  };
} as Middleware;
