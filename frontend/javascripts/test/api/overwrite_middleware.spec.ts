import { describe, it, expect } from "vitest";
// @ts-ignore
import configureMockStore from "redux-mock-store";
import overwriteActionMiddleware, {
  overwriteAction,
  removeOverwrite,
} from "oxalis/model/helpers/overwrite_action_middleware";

const middlewares = [overwriteActionMiddleware];
const mockStore = configureMockStore(middlewares);

describe("Tracing Api: overwrite middleware", () => {
  it("registerOverwrite should overwrite an existing function", () => {
    const beforeAction = {
      type: "before",
    };
    const overwrittenAction = {
      type: "overwritten",
    };
    const afterAction = {
      type: "after",
    };
    overwriteAction("overwritten", (store: any, next, action) => {
      store.dispatch(beforeAction);
      next(action);
      store.dispatch(afterAction);
    });
    const expectedActions = [beforeAction, overwrittenAction, afterAction];
    const store = mockStore({});
    store.dispatch(overwrittenAction);
    expect(store.getActions()).toEqual(expectedActions);
  });

  it("registerOverwrite should allow removing overwrites", () => {
    const beforeAction = {
      type: "before",
    };
    const overwrittenAction = {
      type: "overwritten",
    };
    const afterAction = {
      type: "after",
    };
    overwriteAction("overwritten", (store: any, next, action) => {
      store.dispatch(beforeAction);
      next(action);
      store.dispatch(afterAction);
    });
    removeOverwrite("overwritten");
    const store = mockStore({});
    store.dispatch(overwrittenAction);
    expect(store.getActions()).toEqual([overwrittenAction]);
  });
});
