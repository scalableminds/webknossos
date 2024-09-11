import type { Dispatch, MiddlewareAPI } from "redux";
import type { Action } from "oxalis/model/actions/actions";

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
export default function overwriteMiddleware<S, A extends Action>(
  // @ts-expect-error ts-migrate(2314) FIXME: Generic type 'MiddlewareAPI<S>' requires 1 type ar... Remove this comment to see the full error message
  store: MiddlewareAPI<S, A>,
): (next: Dispatch<A>) => Dispatch<A> {
  // @ts-expect-error ts-migrate(2322) FIXME: Type '(next: Dispatch<A>) => (action: A) => A' is ... Remove this comment to see the full error message
  return (next: Dispatch<A>) =>
    (action: A): A => {
      if (overwrites[action.type]) {
        let isSyncExecutionDone = false;

        // @ts-expect-error ts-migrate(7019) FIXME: Rest parameter 'args' implicitly has an 'any[]' ty... Remove this comment to see the full error message
        const wrappedNext = function (...args) {
          if (isSyncExecutionDone) {
            console.warn(
              "Apparently, you used registerOverwrite for",
              action.type,
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

        const returnValue = overwrites[action.type](store, wrappedNext, action);
        isSyncExecutionDone = true;
        return returnValue;
      } else {
        return next(action);
      }
    };
}
