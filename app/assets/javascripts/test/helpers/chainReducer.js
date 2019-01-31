// @flow

class ChainReducerClass<S, A> {
  state: S;

  constructor(state: S) {
    this.state = state;
  }

  apply(reducer: (S, A) => S, actionGetter: A | (S => A)): ChainReducerClass<S, A> {
    // $FlowFixMe Cannot call actionGetter because the parameter types of an unknown function are unknown.
    const action = typeof actionGetter === "function" ? actionGetter(this.state) : actionGetter;
    return new ChainReducerClass(reducer(this.state, action));
  }

  unpack(): S {
    return this.state;
  }
}

export default function ChainReducer<S, A>(state: S): ChainReducerClass<S, A> {
  return new ChainReducerClass(state);
}
