export ChainReducer = (state) => {
  return {
    apply(reducer, action) {
      return ChainReducer(reducer(state, action));
    }
    unpack() {
      return state;
    }
  }
}

export ChainReducerWithDiffs = (state, diffFn, diffActions=[]) => {
 return {
   apply(reducer, action) {
     const newState = reducer(state, action);
     const diff = diffFn(state, newState)
     return ChainReducer(newState, diffFn, diffActions.concat(diff));
   }
   unpack() {
     return {state, diffActions};
   }
 }
