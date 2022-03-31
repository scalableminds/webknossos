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
    // @ts-expect-error ts-migrate(2349) FIXME: This expression is not callable.
    const action = typeof actionGetter === "function" ? actionGetter(this.state) : actionGetter;
    return new ChainReducerClass(reducer(this.state, action));
  }

  applyAll(
    reducer: (arg0: S, arg1: A) => S,
    actionGetters: Array<A | ((arg0: S) => A)>,
  ): ChainReducerClass<S, A> {
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'A | ((arg0: S) => A)' is not assignable to t... Remove this comment to see the full error message
    return actionGetters.reduce(
      // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
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
