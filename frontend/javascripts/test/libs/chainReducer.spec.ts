import ChainReducer from "test/helpers/chainReducer";
import { describe, it, expect } from "vitest";

function IncrementReducer(state: number): number {
  return state + 1;
}

function SumReducer(state: number, action: number): number {
  return state + action;
}

describe("ChainReducer", () => {
  it("should return the initial state if no reducers are called", () => {
    const state = {};
    const newState = ChainReducer(state, (state) => state).unpack();
    expect(newState).toBe(state);
  });

  it("should be called the correct number of times", () => {
    const state = 0;
    const newState = ChainReducer(state, IncrementReducer)
      .apply(null)
      .apply(null)
      .apply(null)
      .apply(null)
      .unpack();
    expect(newState).toBe(4);
  });

  it("should call the reducer with the correct action", () => {
    const state = 1;
    const newState = ChainReducer(state, SumReducer).apply(2).apply(3).apply(4).unpack();
    expect(newState).toBe(10);
  });
});
