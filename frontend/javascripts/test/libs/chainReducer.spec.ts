import { chainReduce } from "test/helpers/chainReducer";
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
    const newState = chainReduce((state) => state)(state, []);
    expect(newState).toBe(state);
  });

  it("should be called the correct number of times", () => {
    const state = 0;
    const newState = chainReduce(IncrementReducer)(state, [null, null, null, null]);
    expect(newState).toBe(4);
  });

  it("should call the reducer with the correct action", () => {
    const state = 1;
    const newState = chainReduce(SumReducer)(state, [2, 3, 4]);
    expect(newState).toBe(10);
  });
});
