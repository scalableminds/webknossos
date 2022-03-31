class ChainReducerClass<S, A> {
  state: S;

  constructor(state: S) {
    this.state = state;
  }

  apply(
    reducer: (arg0: S, arg1: A) => S,
    actionGetter: A | ((arg0: S) => A),
  ): ChainReducerClass<S, A> {
    // $FlowFixMe[incompatible-use] Cannot call actionGetter because the parameter types of an unknown function are unknown.
    const action = typeof actionGetter === "function" ? actionGetter(this.state) : actionGetter;
    return new ChainReducerClass(reducer(this.state, action));
  }

  applyAll(
    reducer: (arg0: S, arg1: A) => S,
    actionGetters: Array<A | ((arg0: S) => A)>,
  ): ChainReducerClass<S, A> {
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
