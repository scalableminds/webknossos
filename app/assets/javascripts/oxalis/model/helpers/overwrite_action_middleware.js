const overwrites = {};

export function overwriteAction<S, A>(
  actionName: string,
  overwriteFunction: (store: S, next: ((action: A) => void), action: A) => void,
) {
  if (overwrites[actionName]) {
    console.warn("There is already an overwrite for ", actionName, ". The old overwrite function will be removed");
  }

  overwrites[actionName] = overwriteFunction;
}

export function removeOverwrite(actionName: string) {
  delete overwrites[actionName];
}

export default function overwriteMiddleware<A>(store) {
  return (next: (action: A) => void) =>
    (action: A) => {
      if (overwrites[action.type]) {
        let isSyncExecutionDone = false;
        const wrappedNext = function (...args) {
          if (isSyncExecutionDone) {
            console.warn(
              "Apparently, you used registerOverwrite for", action.type, ` and
              dispatched the action asynchronously (e.g., within a setTimeout call
              or after 'async'). This can lead to weird behaviour, since actions
              are expected to be dispatched synchronously. Please dispatch the
              action in a synchronous way.`);
          }
          next(...args);
        };

        overwrites[action.type](store, wrappedNext, action);
        isSyncExecutionDone = true;
      } else {
        next(action);
      }
    };
}
