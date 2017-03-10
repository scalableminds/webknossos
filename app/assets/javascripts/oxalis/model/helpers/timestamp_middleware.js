import type { ActionType } from "oxalis/model/actions/actions";

export type ActionWithTimestamp<T: ActionType> = T & { timestamp: number };

export function addTimestamp<T: ActionType>(action: T, timestamp?: number = Date.now()): ActionWithTimestamp<T> {
  return Object.assign(action, { timestamp });
}

export default function timestampMiddleware() {
  return (next: (action: ActionWithTimestamp<ActionType>) => void) =>
    (action: ActionType) => {
      next(addTimestamp(action));
    };
}
