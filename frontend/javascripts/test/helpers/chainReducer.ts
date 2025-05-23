class ChainReducerClass<S, A> {
  constructor(
    public state: S,
    public reducer: (arg0: S, arg1: A) => S,
  ) {}

  apply(actionGetter: A | ((arg0: S) => A)): ChainReducerClass<S, A> {
    // @ts-expect-error ts-migrate(2349) FIXME: This expression is not callable.
    const action: A = typeof actionGetter === "function" ? actionGetter(this.state) : actionGetter;
    return new ChainReducerClass(this.reducer(this.state, action), this.reducer);
  }

  applyAll(
    reducer: (arg0: S, arg1: A) => S,
    actionGetters: Array<A | ((arg0: S) => A)>,
  ): ChainReducerClass<S, A> {
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'A | ((arg0: S) => A)' is not assignable to t... Remove this comment to see the full error message
    return actionGetters.reduce(
      // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
      (_acc, currentActionGetter: A | ((arg0: S) => A)) => this.apply(reducer, currentActionGetter),
      this,
    );
  }

  unpack(): S {
    return this.state;
  }
}

export default function ChainReducer<S, A>(
  state: S,
  reducer: (arg0: S, arg1: A) => S,
): ChainReducerClass<S, A> {
  return new ChainReducerClass(state, reducer);
}
