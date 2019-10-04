/**
 * chainReducer.spec.js
 * @flow
 */

import ChainReducer from "test/helpers/chainReducer";
import test from "ava";

function IncrementReducer(state: number): number {
  return state + 1;
}

function SumReducer(state: number, action: number): number {
  return state + action;
}

test("ChainReducer should return the initial state if no reducers are called", t => {
  const state = {};
  const newState = ChainReducer(state).unpack();

  t.is(newState, state);
});

test("ChainReducer should be called the correct number of timer", t => {
  const state = 0;
  const newState = ChainReducer(state)
    .apply(IncrementReducer, null)
    .apply(IncrementReducer, null)
    .apply(IncrementReducer, null)
    .apply(IncrementReducer, null)
    .unpack();

  t.is(newState, 4);
});

test("ChainReducer should call the reducer with the correct action", t => {
  const state = 1;
  const newState = ChainReducer(state)
    .apply(SumReducer, 2)
    .apply(SumReducer, 3)
    .apply(SumReducer, 4)
    .unpack();

  t.is(newState, 10);
});
