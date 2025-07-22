import type { Middleware } from "redux";
import { eventBus } from "./event_bus";

export const eventEmitterMiddleware: Middleware = () => (next) => (action) => {
  eventBus.emit(action.type, action);
  return next(action);
};
