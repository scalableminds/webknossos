export function chainReduce<S, A>(reducer: (arg0: S, arg1: A) => S) {
  return (state: S, actionGetters: Array<A | ((arg0: S) => A)>) => {
    return actionGetters.reduce((currentState, actionGetter) => {
      const action: A =
        typeof actionGetter === "function"
          ? (actionGetter as (state: S) => A)(currentState)
          : actionGetter;
      return reducer(currentState, action);
    }, state);
  };
}
