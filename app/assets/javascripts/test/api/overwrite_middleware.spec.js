/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
import _ from "lodash";
import configureMockStore from 'redux-mock-store'
import overwriteActionMiddleware, {overwriteAction, removeOverwrite} from 'oxalis/model/helpers/overwrite_action_middleware';

const middlewares = [ overwriteActionMiddleware ];
const mockStore = configureMockStore(middlewares);

fdescribe("Api", () => {
  describe("Tracing Api", () => {
    describe("registerOverwrite", () => {
      it("should overwrite an existing function", (done) => {
        const beforeAction = { type: 'before' };
        const overwrittenAction = { type: 'overwritten' };
        const afterAction = { type: 'after' };

        overwriteAction('overwritten', (store, next, action) => {
          store.dispatch(beforeAction);
          next(action);
          store.dispatch(afterAction);
        });

        const expectedActions = [
          beforeAction,
          overwrittenAction,
          afterAction,
        ];

        const store = mockStore({ });
        store.dispatch(overwrittenAction);
        expect(store.getActions()).toEqual(expectedActions)

        done();
      });

      it("should allow removing overwrites", (done) => {
        const beforeAction = { type: 'before' };
        const overwrittenAction = { type: 'overwritten' };
        const afterAction = { type: 'after' };

        overwriteAction('overwritten', (store, next, action) => {
          store.dispatch(beforeAction);
          next(action);
          store.dispatch(afterAction);
        });
        removeOverwrite('overwritten');

        const store = mockStore({ });
        store.dispatch(overwrittenAction);
        expect(store.getActions()).toEqual([overwrittenAction])

        done();
      });
    });
  });
});
