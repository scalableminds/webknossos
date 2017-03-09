import type { ActionType } from "oxalis/model/actions/actions";

export type ActionWithTimestamp<T: ActionType> = T & { timestamp: number };

export default function timestampMiddleware() {
  return (next: (action: ActionWithTimestamp<ActionType>) => void) =>
    (action: ActionType) => {
      Object.assign(action, { timestamp: Date.now() });
      next(action);
    };
}
