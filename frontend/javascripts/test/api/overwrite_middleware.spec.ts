import test from "ava";
import overwriteActionMiddleware, {
  overwriteAction,
  removeOverwrite,
} from "oxalis/model/helpers/overwrite_action_middleware";
// @ts-nocheck
import configureMockStore from "redux-mock-store";
const middlewares = [overwriteActionMiddleware];
const mockStore = configureMockStore(middlewares);
test("Tracing Api: registerOverwrite should overwrite an existing function", (t) => {
  const beforeAction = {
    type: "before",
  };
  const overwrittenAction = {
    type: "overwritten",
  };
  const afterAction = {
    type: "after",
  };
  overwriteAction("overwritten", (store, next, action) => {
    store.dispatch(beforeAction);
    next(action);
    store.dispatch(afterAction);
  });
  const expectedActions = [beforeAction, overwrittenAction, afterAction];
  const store = mockStore({});
  store.dispatch(overwrittenAction);
  t.deepEqual(store.getActions(), expectedActions);
});
test("Tracing Api: registerOverwrite should allow removing overwrites", (t) => {
  const beforeAction = {
    type: "before",
  };
  const overwrittenAction = {
    type: "overwritten",
  };
  const afterAction = {
    type: "after",
  };
  overwriteAction("overwritten", (store, next, action) => {
    store.dispatch(beforeAction);
    next(action);
    store.dispatch(afterAction);
  });
  removeOverwrite("overwritten");
  const store = mockStore({});
  store.dispatch(overwrittenAction);
  t.deepEqual(store.getActions(), [overwrittenAction]);
});
