let overwrites = {};

export function overwriteAction<S, A>(
  actionName: string,
  overwriteFunction: (store: S, next: ((action: A) => void), action: A) => void
) {
  if (overwrites[actionName]) {
    console.warn("There is already an overwrite for ", actionName, ". The old overwrite function will be removed");
  }

  overwrites[actionName] = overwriteFunction;
}

export function removeOverwrite(actionName: string) {
  delete overwrites[actionName];
}

export default function overwriteMiddleware(store) {
  return (next: (action: ActionType) => void) =>
    (action: ActionType) => {
      if (overwrites[action.type]) {
        overwrites[action.type](store, next, action);
      } else {
        next(action);
      }
    };
}
