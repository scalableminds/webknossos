export function chainReduce<S, A>(reducer: (arg0: S, arg1: A) => S) {
  return (state: S, actionGetters: Array<A | ((arg0: S) => A)>) => {
    return actionGetters.reduce((currentState, actionGetter) => {
      const action: A =
        // @ts-expect-error ts-migrate(2349) FIXME: This expression is not callable.
        typeof actionGetter === "function" ? actionGetter(currentState) : actionGetter;
      return reducer(currentState, action);
    }, state);
  };
}
