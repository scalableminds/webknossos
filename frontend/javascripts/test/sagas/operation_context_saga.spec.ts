import { noop } from "lodash-es";
import { applyMiddleware, createStore } from "redux";
import createSagaMiddleware from "redux-saga";
import { delay } from "redux-saga/effects";
import { call } from "typed-redux-saga";
import {
  _resetOperationContextForTesting,
  borrowedContext,
  createOperationContext,
  getOrCreateOperationContext,
} from "viewer/model/sagas/operation_context_saga";
import { beforeEach, describe, expect, it } from "vitest";

// Minimal store for operation context tests — only handles the four operation context
// action types. Predicates in these tests don't access other WK state slices.
function makeTestStore() {
  const sagaMiddleware = createSagaMiddleware();
  const store = createStore(
    (
      state: any = { operationContext: { activeOperations: [], childOperations: [] } },
      action: any,
    ) => {
      switch (action.type) {
        case "REGISTER_OPERATION":
          return {
            operationContext: {
              ...state.operationContext,
              activeOperations: [...state.operationContext.activeOperations, action.id],
            },
          };
        case "UNREGISTER_OPERATION":
          return {
            operationContext: {
              activeOperations: state.operationContext.activeOperations.filter(
                (id: string) => id !== action.id,
              ),
              childOperations: state.operationContext.childOperations.filter(
                (c: any) => c.parentId !== action.id,
              ),
            },
          };
        case "REGISTER_CHILD_OPERATION":
          return {
            operationContext: {
              ...state.operationContext,
              childOperations: [
                ...state.operationContext.childOperations,
                { id: action.id, parentId: action.parentId },
              ],
            },
          };
        case "UNREGISTER_CHILD_OPERATION":
          return {
            operationContext: {
              ...state.operationContext,
              childOperations: state.operationContext.childOperations.filter(
                (c: any) => c.id !== action.id,
              ),
            },
          };
        default:
          return state;
      }
    },
    applyMiddleware(sagaMiddleware),
  );
  return { store, sagaMiddleware };
}

describe("operation_context_saga", () => {
  beforeEach(() => {
    _resetOperationContextForTesting();
  });

  it("second operation waits for first to complete", async () => {
    const { sagaMiddleware } = makeTestStore();
    const log: string[] = [];

    function* op1() {
      const ctx = yield* createOperationContext({ id: "op1" });
      yield* ctx.execute(function* () {
        log.push("op1:start");
        yield delay(20);
        log.push("op1:end");
      });
    }

    function* op2() {
      const ctx = yield* createOperationContext({ id: "op2" });
      yield* ctx.execute(function* () {
        yield* call(noop);
        log.push("op2:start");
        log.push("op2:end");
      });
    }

    const t1 = sagaMiddleware.run(op1);
    const t2 = sagaMiddleware.run(op2);
    await Promise.all([t1.toPromise(), t2.toPromise()]);

    expect(log).toEqual(["op1:start", "op1:end", "op2:start", "op2:end"]);
  });

  it("same-ID guard prevents concurrent execution", async () => {
    const { sagaMiddleware } = makeTestStore();
    let concurrentCount = 0;
    let maxConcurrentCount = 0;

    function* opA() {
      const ctx = yield* createOperationContext({ id: "my-op", behaviorWhenDisallowed: "ignore" });
      if (ctx == null) return;
      yield* ctx.execute(function* () {
        concurrentCount++;
        maxConcurrentCount = Math.max(maxConcurrentCount, concurrentCount);
        yield delay(10);
        concurrentCount--;
      });
    }

    const t1 = sagaMiddleware.run(opA);
    const t2 = sagaMiddleware.run(opA);
    await Promise.all([t1.toPromise(), t2.toPromise()]);

    // Even with ignore, the same ID can never run twice concurrently
    expect(maxConcurrentCount).toBe(1);
  });

  it("allowAdditionalOperation permits concurrent execution", async () => {
    const { sagaMiddleware } = makeTestStore();
    const log: string[] = [];

    function* saveOp() {
      const ctx = yield* createOperationContext({
        id: "save",
        allowAdditionalOperation: (pendingId) => pendingId === "undo",
      });
      yield* ctx.execute(function* () {
        log.push("save:start");
        yield delay(30);
        log.push("save:end");
      });
    }

    function* undoOp() {
      const ctx = yield* createOperationContext({ id: "undo" });
      yield* ctx.execute(function* () {
        yield* call(noop);
        log.push("undo:start");
        log.push("undo:end");
      });
    }

    const t1 = sagaMiddleware.run(saveOp);
    const t2 = sagaMiddleware.run(undoOp);
    await Promise.all([t1.toPromise(), t2.toPromise()]);

    // undo ran concurrently — it started and finished before save ended
    expect(log).toEqual(["save:start", "undo:start", "undo:end", "save:end"]);
  });

  it("allowAdditionalOperation receives current store state", async () => {
    const { sagaMiddleware } = makeTestStore();
    let stateSeenByPredicate: any = null;

    function* saveOp() {
      const ctx = yield* createOperationContext({
        id: "save",
        allowAdditionalOperation: (pendingId, state) => {
          stateSeenByPredicate = state;
          return pendingId === "undo";
        },
      });
      yield* ctx.execute(function* () {
        yield delay(20);
      });
    }

    function* undoOp() {
      const ctx = yield* createOperationContext({ id: "undo" });
      yield* ctx.execute(function* () {});
    }

    const t1 = sagaMiddleware.run(saveOp);
    const t2 = sagaMiddleware.run(undoOp);
    await Promise.all([t1.toPromise(), t2.toPromise()]);

    // The predicate received state with save already registered
    expect(stateSeenByPredicate?.operationContext?.activeOperations).toContain("save");
  });

  it("behaviorWhenDisallowed: ignore returns null when blocked", async () => {
    const { sagaMiddleware } = makeTestStore();
    let secondContextWasNull = false;

    function* op1() {
      const ctx = yield* createOperationContext({ id: "op1" });
      yield* ctx.execute(function* () {
        yield delay(20);
      });
    }

    function* op2() {
      const ctx = yield* createOperationContext({ id: "op2", behaviorWhenDisallowed: "ignore" });
      secondContextWasNull = ctx == null;
    }

    const t1 = sagaMiddleware.run(op1);
    const t2 = sagaMiddleware.run(op2);
    await Promise.all([t1.toPromise(), t2.toPromise()]);

    expect(secondContextWasNull).toBe(true);
  });

  it("behaviorWhenDisallowed: raise throws when blocked", async () => {
    const { sagaMiddleware } = makeTestStore();
    let caughtError: Error | null = null;

    function* op1() {
      const ctx = yield* createOperationContext({ id: "op1" });
      yield* ctx.execute(function* () {
        yield delay(20);
      });
    }

    function* op2() {
      try {
        yield* createOperationContext({ id: "op2", behaviorWhenDisallowed: "raise" });
      } catch (err) {
        caughtError = err as Error;
      }
    }

    const t1 = sagaMiddleware.run(op1);
    const t2 = sagaMiddleware.run(op2);
    await Promise.all([t1.toPromise(), t2.toPromise()]);

    expect(caughtError).not.toBeNull();
    expect((caughtError as unknown as Error).message).toContain("op2");
    expect((caughtError as unknown as Error).message).toContain("op1");
  });

  it("execute() throws on second call", async () => {
    const { sagaMiddleware } = makeTestStore();
    let threwOnSecondCall = false;

    function* op() {
      const ctx = yield* createOperationContext({ id: "op" });
      yield* ctx.execute(function* () {});
      try {
        yield* ctx.execute(function* () {});
      } catch (_e) {
        threwOnSecondCall = true;
      }
    }

    await sagaMiddleware.run(op).toPromise();
    expect(threwOnSecondCall).toBe(true);
  });

  it("activeOperations in store tracks operation lifecycle", async () => {
    const { store, sagaMiddleware } = makeTestStore();
    const snapshots: string[][] = [];

    function* op() {
      const ctx = yield* createOperationContext({ id: "tracked-op" });
      snapshots.push([...store.getState().operationContext.activeOperations]);
      yield* ctx.execute(function* () {
        snapshots.push([...store.getState().operationContext.activeOperations]);
        yield delay(5);
      });
      snapshots.push([...store.getState().operationContext.activeOperations]);
    }

    await sagaMiddleware.run(op).toPromise();

    expect(snapshots[0]).toEqual(["tracked-op"]); // after createOperationContext, before execute
    expect(snapshots[1]).toEqual(["tracked-op"]); // during execute
    expect(snapshots[2]).toEqual([]); // after execute completes
  });

  it("borrowedContext registers child operation and inherits parent lock", async () => {
    const { store, sagaMiddleware } = makeTestStore();
    const log: string[] = [];

    function* op() {
      const parentCtx = yield* createOperationContext({ id: "parent" });
      yield* parentCtx.execute(function* () {
        log.push("parent:start");
        const childCtx = borrowedContext(parentCtx, "child");
        yield* childCtx.execute(function* () {
          log.push("child:start");
          const inStore = store
            .getState()
            .operationContext.childOperations.some((c: any) => c.id === "child");
          log.push(inStore ? "child:in-store" : "child:not-in-store");
          log.push("child:end");
        });
        log.push("parent:end");
        const stillInStore = store
          .getState()
          .operationContext.childOperations.some((c: any) => c.id === "child");
        log.push(stillInStore ? "child:still-in-store" : "child:removed-from-store");
      });
    }

    await sagaMiddleware.run(op).toPromise();

    expect(log).toEqual([
      "parent:start",
      "child:start",
      "child:in-store",
      "child:end",
      "parent:end",
      "child:removed-from-store",
    ]);
  });

  it("borrowedContext execute() throws on second call", async () => {
    const { sagaMiddleware } = makeTestStore();
    let threwOnSecondCall = false;

    function* op() {
      const parentCtx = yield* createOperationContext({ id: "parent" });
      yield* parentCtx.execute(function* () {
        const childCtx = borrowedContext(parentCtx, "child");
        yield* childCtx.execute(function* () {});
        try {
          yield* childCtx.execute(function* () {});
        } catch (_e) {
          threwOnSecondCall = true;
        }
      });
    }

    await sagaMiddleware.run(op).toPromise();
    expect(threwOnSecondCall).toBe(true);
  });

  it("getOrCreateOperationContext borrows when existing context is provided", async () => {
    const { sagaMiddleware } = makeTestStore();
    const log: string[] = [];

    function* op() {
      const parentCtx = yield* createOperationContext({ id: "parent" });
      yield* parentCtx.execute(function* () {
        const childCtx = yield* getOrCreateOperationContext({ id: "child" }, parentCtx);
        // Borrowed context preserves the parent's ID
        log.push(`id-matches-parent: ${childCtx.id === parentCtx.id}`);
        yield* childCtx.execute(function* () {
          yield* call(noop);
          log.push("child:ran");
        });
      });
    }

    await sagaMiddleware.run(op).toPromise();
    expect(log).toEqual(["id-matches-parent: true", "child:ran"]);
  });

  it("getOrCreateOperationContext creates new context when none provided", async () => {
    const { sagaMiddleware } = makeTestStore();
    const log: string[] = [];

    function* op() {
      // No existing context — should acquire a new lock
      const ctx = yield* getOrCreateOperationContext({ id: "standalone" });
      log.push(`id: ${ctx.id}`);
      yield* ctx.execute(function* () {
        yield* call(noop);
        log.push("ran");
      });
    }

    await sagaMiddleware.run(op).toPromise();
    expect(log).toEqual(["id: standalone", "ran"]);
  });
});
