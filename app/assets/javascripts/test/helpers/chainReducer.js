// @flow

class ChainReducerClass<S, A> {
  state: S;

  constructor(state: S) {
    this.state = state;
  }

  apply(reducer: (S, A) => S, action: A): ChainReducerClass<S, A> {
    return new ChainReducerClass(reducer(this.state, action));
  }

  unpack(): S {
    return this.state;
  }
}

export default function ChainReducer<S, A>(state: S): ChainReducerClass<S, A> {
  return new ChainReducerClass(state);
}
