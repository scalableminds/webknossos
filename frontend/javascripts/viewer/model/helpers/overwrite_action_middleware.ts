import type { Dispatch, MiddlewareAPI, UnknownAction } from "redux";
import type { Action } from "viewer/model/actions/actions";

type OverwriteFunction<S, A> = (store: S, next: (action: A) => void, action: A) => A | Promise<A>;
const overwrites: Record<string, OverwriteFunction<any, any>> = {};

export function overwriteAction<S, A>(
  actionName: string,
  overwriteFunction: OverwriteFunction<S, A>,
) {
  if (overwrites[actionName]) {
    console.warn(
      "There is already an overwrite for ",
      actionName,
      ". The old overwrite function will be removed",
    );
  }

  overwrites[actionName] = overwriteFunction;
  return () => {
    delete overwrites[actionName];
  };
}
export function removeOverwrite(actionName: string) {
  delete overwrites[actionName];
}
export default function overwriteMiddleware<S, A extends UnknownAction>(
  store: MiddlewareAPI<Dispatch<A>, S>,
) {
  return (next: (action: unknown) => unknown) =>
    (action: unknown): unknown => {
      const typedAction = action as Action;
      if (overwrites[typedAction.type]) {
        let isSyncExecutionDone = false;

        // @ts-expect-error ts-migrate(7019) FIXME: Rest parameter 'args' implicitly has an 'any[]' ty... Remove this comment to see the full error message
        const wrappedNext = function (...args) {
          if (isSyncExecutionDone) {
            console.warn(
              "Apparently, you used registerOverwrite for",
              typedAction.type,
              ` and
              dispatched the action asynchronously (e.g., within a setTimeout call
              or after 'async'). This can lead to weird behaviour, since actions
              are expected to be dispatched synchronously. Please dispatch the
              action in a synchronous way.`,
            );
          }

          // @ts-expect-error ts-migrate(2556) FIXME: Expected 1 arguments, but got 0 or more.
          return next(...args);
        };

        const returnValue = overwrites[typedAction.type](store, wrappedNext, action);
        isSyncExecutionDone = true;
        return returnValue;
      } else {
        return next(action);
      }
    };
}
