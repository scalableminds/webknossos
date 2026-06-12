import { applyMiddleware, createStore } from "redux";
import createSagaMiddleware from "redux-saga";
import { delay, put, take, takeEvery } from "redux-saga/effects";

// ─── Types ────────────────────────────────────────────────────────────────────

type OperationId = string;

interface OperationOptions {
  id: OperationId;
  behaviorWhenDisallowed: "wait" | "ignore" | "raise";
}

interface OperationContext {
  id: OperationId;
  execute(saga: () => Generator): Generator;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

const REGISTER_OPERATION = "REGISTER_OPERATION" as const;
const UNREGISTER_OPERATION = "UNREGISTER_OPERATION" as const;
const PUSH_SAVE_QUEUE = "PUSH_SAVE_QUEUE" as const;
const ENSURE_NEWEST_VERSION = "ENSURE_NEWEST_VERSION" as const;

const registerOperation = (id: OperationId) => ({ type: REGISTER_OPERATION, id });
const unregisterOperation = (id: OperationId) => ({ type: UNREGISTER_OPERATION, id });
const pushSaveQueueAction = () => ({ type: PUSH_SAVE_QUEUE });
const ensureNewestVersionAction = (operationContext?: OperationContext) => ({
  type: ENSURE_NEWEST_VERSION,
  operationContext,
});

type AppAction =
  | ReturnType<typeof registerOperation>
  | ReturnType<typeof unregisterOperation>
  | ReturnType<typeof pushSaveQueueAction>
  | ReturnType<typeof ensureNewestVersionAction>;

// ─── Reducer ──────────────────────────────────────────────────────────────────

interface AppState {
  runningOperations: OperationId[];
}

function reducer(state: AppState = { runningOperations: [] }, action: AppAction): AppState {
  switch (action.type) {
    case REGISTER_OPERATION:
      return { ...state, runningOperations: [...state.runningOperations, action.id] };
    case UNREGISTER_OPERATION:
      return {
        ...state,
        runningOperations: state.runningOperations.filter((id) => id !== action.id),
      };
    default:
      return state;
  }
}

// ─── Mutex ────────────────────────────────────────────────────────────────────
// Module-level set is the actual lock. JS is single-threaded and Redux-Saga is
// cooperative, so the size-check + add in createOperationContext are atomic —
// no other saga can interleave between them. The Redux store mirrors this for
// observability (DevTools, UI).

const activeLockIds = new Set<OperationId>();

// ─── Operation Context ────────────────────────────────────────────────────────

function* createOperationContext(
  options: OperationOptions,
): Generator<any, OperationContext | null, any> {
  // Atomic check-and-set: no yield between size check and add.
  if (activeLockIds.size === 0) {
    activeLockIds.add(options.id);
    yield put(registerOperation(options.id));

    const context: OperationContext = {
      id: options.id,
      *execute(saga: () => Generator) {
        try {
          yield* saga();
        } finally {
          activeLockIds.delete(options.id);
          yield put(unregisterOperation(options.id));
        }
      },
    };
    return context;
  }

  if (options.behaviorWhenDisallowed === "wait") {
    console.log(`  [${options.id}] blocked — waiting for lock`);
    yield take(UNREGISTER_OPERATION);
    // Re-check after waking: another waiter may have grabbed the lock first.
    return yield* createOperationContext(options);
  }

  if (options.behaviorWhenDisallowed === "raise") {
    throw new Error(`[${options.id}] cannot start: lock held by [${[...activeLockIds]}]`);
  }

  // "ignore"
  console.log(`  [${options.id}] ignoring: lock is held`);
  return null;
}

// When an existing context is passed, return a borrowed wrapper whose execute()
// just runs the saga — no lock acquisition or release — so the outer context
// keeps ownership of the lock.
function borrowedContext(existing: OperationContext): OperationContext {
  return {
    id: existing.id,
    *execute(saga: () => Generator) {
      console.log(`  [${existing.id}] piggybacking — skipping lock`);
      yield* saga();
    },
  };
}

function* getOrCreateOperationContext(
  options: OperationOptions,
  existing?: OperationContext | null,
): Generator<any, OperationContext | null, any> {
  if (existing != null) {
    return borrowedContext(existing);
  }
  return yield* createOperationContext(options);
}

// ─── Simulated Work ───────────────────────────────────────────────────────────

function* doStuff1() {
  console.log("    [doStuff1] start");
  yield delay(300);
  console.log("    [doStuff1] done");
}

function* doStuff2() {
  console.log("    [doStuff2] start");
  yield delay(300);
  console.log("    [doStuff2] done");
}

function* ensureNewestVersionImpl() {
  console.log("    [ensureNewestVersionImpl] start");
  yield delay(150);
  console.log("    [ensureNewestVersionImpl] done");
}

// ─── Saga Handlers ────────────────────────────────────────────────────────────

function* handlePushSaveQueue() {
  const ctx: OperationContext | null = yield* createOperationContext({
    id: "pushSaveQueue",
    behaviorWhenDisallowed: "wait",
  });
  if (ctx == null) return;

  yield* ctx.execute(function* () {
    yield* doStuff1();
    // Pass our context so the handler can piggyback instead of waiting for the lock.
    yield put(ensureNewestVersionAction(ctx));
    yield* doStuff2();
  });
}

function* handleEnsureNewestVersion(action: ReturnType<typeof ensureNewestVersionAction>) {
  const ctx: OperationContext | null = yield* getOrCreateOperationContext(
    { id: "ensureNewestVersion", behaviorWhenDisallowed: "wait" },
    action.operationContext,
  );
  if (ctx == null) return;

  yield* ctx.execute(function* () {
    yield* ensureNewestVersionImpl();
  });
}

// ─── Root Saga & Store ────────────────────────────────────────────────────────

function* rootSaga() {
  yield takeEvery(PUSH_SAVE_QUEUE, handlePushSaveQueue);
  yield takeEvery(ENSURE_NEWEST_VERSION, handleEnsureNewestVersion);
}

const sagaMiddleware = createSagaMiddleware();
const store = createStore(reducer, applyMiddleware(sagaMiddleware));

store.subscribe(() => console.log(`  store: ${JSON.stringify(store.getState())}`));
sagaMiddleware.run(rootSaga);

// ─── Demo ─────────────────────────────────────────────────────────────────────

console.log("\n=== Scenario 1: two pushSaveQueue dispatches in rapid succession ===");
console.log("Second should wait for the first to complete.\n");
store.dispatch(pushSaveQueueAction());
store.dispatch(pushSaveQueueAction());

// Trigger a standalone ensureNewestVersion after both finish to show normal queuing.
setTimeout(() => {
  console.log("\n=== Scenario 2: standalone ensureNewestVersion (runs after Scenario 1) ===\n");
  store.dispatch(ensureNewestVersionAction());
}, 2000);
