type ReducerFn<State, Action> = (s: State, arg1: Action) => State;

export function chainReduce<State, Action>(reducer: ReducerFn<State, Action>) {
  /*
   * Given a reducer, chainReduce returns a function which accepts a state and
   * an array of actions (or action getters). When invoked, that function will
   * use the reducer to apply all actions on the initial state.
   */
  return (state: State, actionGetters: Array<Action | ((s: State) => Action)>) => {
    return actionGetters.reduce((currentState, actionGetter) => {
      const action: Action =
        typeof actionGetter === "function"
          ? (actionGetter as (state: State) => Action)(currentState)
          : actionGetter;
      return reducer(currentState, action);
    }, state);
  };
}
