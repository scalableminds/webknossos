// @flow

import type { ActionType } from "oxalis/model/actions/actions";
import type { OxalisState, ReducerType } from "oxalis/store";

export default function ChainReducer(state: OxalisState) {
  return {
    apply(reducer: ReducerType, action: ActionType): ChainReducer {
      return ChainReducer(reducer(state, action));
    },
    unpack(): OxalisState {
      return state;
    },
  };
}
