// @flow

class ChainReducerClass<S, A> {
  state: S;

  constructor(state: S) {
    this.state = state;
  }

  apply(reducer: (S, A) => S, actionGetter: A | (S => A)): ChainReducerClass<S, A> {
    // $FlowFixMe[incompatible-use] Cannot call actionGetter because the parameter types of an unknown function are unknown.
    const action = typeof actionGetter === "function" ? actionGetter(this.state) : actionGetter;
    return new ChainReducerClass(reducer(this.state, action));
  }

  applyAll(reducer: (S, A) => S, actionGetters: Array<A | (S => A)>): ChainReducerClass<S, A> {
    return actionGetters.reduce(
      (acc, currentActionGetter) => this.apply(reducer, currentActionGetter),
      this,
    );
  }

  unpack(): S {
    return this.state;
  }
}

export default function ChainReducer<S, A>(state: S): ChainReducerClass<S, A> {
  return new ChainReducerClass(state);
}
