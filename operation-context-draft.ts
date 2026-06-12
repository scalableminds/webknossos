import { applyMiddleware, createStore } from "redux";
import createSagaMiddleware from "redux-saga";
import { call, delay, put, take, takeEvery } from "redux-saga/effects";

// ─── Types ────────────────────────────────────────────────────────────────────

type OperationId = string;

interface OperationOptions {
  id: OperationId;
  behaviorWhenDisallowed?: "wait" | "ignore" | "raise";
}

interface OperationContext {
  id: OperationId;
  execute(saga: () => Generator): Generator;
}


// ─── Actions ──────────────────────────────────────────────────────────────────

const REGISTER_OPERATION = "REGISTER_OPERATION" as const;
const UNREGISTER_OPERATION = "UNREGISTER_OPERATION" as const;
const REGISTER_CHILD_OPERATION = "REGISTER_CHILD_OPERATION" as const;
const UNREGISTER_CHILD_OPERATION = "UNREGISTER_CHILD_OPERATION" as const;
const PUSH_SAVE_QUEUE = "PUSH_SAVE_QUEUE" as const;
const ENSURE_NEWEST_VERSION = "ENSURE_NEWEST_VERSION" as const;

const registerOperation = (id: OperationId) => ({ type: REGISTER_OPERATION, id });
const unregisterOperation = (id: OperationId) => ({ type: UNREGISTER_OPERATION, id });
const registerChildOperation = (id: OperationId) => ({ type: REGISTER_CHILD_OPERATION, id });
const unregisterChildOperation = (id: OperationId) => ({ type: UNREGISTER_CHILD_OPERATION, id });
const pushSaveQueueAction = () => ({ type: PUSH_SAVE_QUEUE });
const ensureNewestVersionAction = (
  operationContext?: OperationContext,
  onComplete?: () => void,
) => ({ type: ENSURE_NEWEST_VERSION, operationContext, onComplete });

type AppAction =
  | ReturnType<typeof registerOperation>
  | ReturnType<typeof unregisterOperation>
  | ReturnType<typeof registerChildOperation>
  | ReturnType<typeof unregisterChildOperation>
  | ReturnType<typeof pushSaveQueueAction>
  | ReturnType<typeof ensureNewestVersionAction>;

// ─── Reducer ──────────────────────────────────────────────────────────────────

interface AppState {
  activeOperation: OperationId | null;
  childOperations: OperationId[]; // piggybacking ops currently inside execute()
}

function reducer(
  state: AppState = { activeOperation: null, childOperations: [] },
  action: AppAction,
): AppState {
  switch (action.type) {
    case REGISTER_OPERATION:
      return { ...state, activeOperation: action.id };
    case UNREGISTER_OPERATION:
      // Children cannot outlive their parent — clear them together.
      return { activeOperation: null, childOperations: [] };
    case REGISTER_CHILD_OPERATION:
      return { ...state, childOperations: [...state.childOperations, action.id] };
    case UNREGISTER_CHILD_OPERATION:
      return { ...state, childOperations: state.childOperations.filter((id) => id !== action.id) };
    default:
      return state;
  }
}

// ─── Mutex ────────────────────────────────────────────────────────────────────
// Scalar nullable rather than Set/array — the mutex invariant means only one
// operation can hold the lock at any moment, so multiplicity is never valid.
// JS is single-threaded and Redux-Saga is cooperative, so the null-check +
// assign in createOperationContext are atomic (no other saga can interleave).
// The Redux store mirrors this for observability (DevTools, UI).

let activeLockId: OperationId | null = null;

// ─── Operation Context ────────────────────────────────────────────────────────

// "ignore" is the only behavior that can return null; all others always return a context.
function* createOperationContext(
  options: { id: OperationId; behaviorWhenDisallowed: "ignore" },
): Generator<any, OperationContext | null, any>;
function* createOperationContext(
  options: { id: OperationId; behaviorWhenDisallowed?: "wait" | "raise" },
): Generator<any, OperationContext, any>;
function* createOperationContext(
  options: OperationOptions,
): Generator<any, OperationContext | null, any> {
  const behavior = options.behaviorWhenDisallowed ?? "wait";

  // Atomic check-and-assign: no yield between null check and assign.
  if (activeLockId === null) {
    activeLockId = options.id;
    yield put(registerOperation(options.id));

    // Closure variable: guards against calling execute() more than once on the
    // same context, which would run a saga without holding the lock.
    let consumed = false;
    const context: OperationContext = {
      id: options.id,
      *execute(saga: () => Generator) {
        if (consumed)
          throw new Error(
            `[${options.id}] context already consumed — execute() may only be called once`,
          );
        consumed = true;
        try {
          yield* saga();
        } finally {
          activeLockId = null;
          yield put(unregisterOperation(options.id));
        }
      },
    };
    return context;
  }

  if (behavior === "wait") {
    console.log(`  [${options.id}] blocked — waiting for lock`);
    yield take(UNREGISTER_OPERATION);
    // Re-check after waking: another waiter may have grabbed the lock first.
    return yield* createOperationContext(options);
  }

  if (behavior === "raise") {
    throw new Error(`[${options.id}] cannot start: lock held by [${activeLockId}]`);
  }

  // "ignore"
  console.log(`  [${options.id}] ignoring: lock is held`);
  return null;
}

// Returns a context that runs within an existing (parent) lock.
// The child is registered in the Redux store for the duration of execute(),
// which is also single-use to prevent accidental double-execution.
function borrowedContext(existing: OperationContext, childId: OperationId): OperationContext {
  let consumed = false;
  return {
    id: existing.id,
    *execute(saga: () => Generator) {
      if (consumed)
        throw new Error(`[${childId}] borrowed context already consumed`);
      consumed = true;
      yield put(registerChildOperation(childId));
      try {
        yield* saga();
      } finally {
        yield put(unregisterChildOperation(childId));
      }
    },
  };
}

function* getOrCreateOperationContext(
  options: { id: OperationId; behaviorWhenDisallowed: "ignore" },
  existing?: OperationContext | null,
): Generator<any, OperationContext | null, any>;
function* getOrCreateOperationContext(
  options: { id: OperationId; behaviorWhenDisallowed?: "wait" | "raise" },
  existing?: OperationContext | null,
): Generator<any, OperationContext, any>;
function* getOrCreateOperationContext(
  options: OperationOptions,
  existing?: OperationContext | null,
): Generator<any, OperationContext | null, any> {
  if (existing != null) {
    return borrowedContext(existing, options.id);
  }
  return yield* createOperationContext(options);
}

// ─── Completion Token ─────────────────────────────────────────────────────────

function createCompletionToken(): { promise: Promise<void>; onComplete: () => void } {
  let onComplete!: () => void;
  const promise = new Promise<void>((resolve) => {
    onComplete = resolve;
  });
  return { promise, onComplete };
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
  const ctx = yield* createOperationContext({ id: "pushSaveQueue" });

  yield* ctx.execute(function* () {
    console.log("STARTING handlePushSaveQueue");
    yield* doStuff1();
    const { promise, onComplete } = createCompletionToken();
    yield put(ensureNewestVersionAction(ctx, onComplete));
    yield* doStuff2();
    yield call(() => promise); // wait for ensureNewestVersion to confirm completion
    console.log("ENDING handlePushSaveQueue");
  });
}

function* handleEnsureNewestVersion(action: ReturnType<typeof ensureNewestVersionAction>) {
  const ctx = yield* getOrCreateOperationContext(
    { id: "ensureNewestVersion" },
    action.operationContext,
  );

  yield* ctx.execute(function* () {
    console.log("STARTING ensureNewestVersionImpl");
    yield* ensureNewestVersionImpl();
    console.log("ENDING ensureNewestVersionImpl");
  });
  action.onComplete?.();
}

// ─── Root Saga & Store ────────────────────────────────────────────────────────

function* rootSaga() {
  yield takeEvery(PUSH_SAVE_QUEUE, handlePushSaveQueue);
  yield takeEvery(ENSURE_NEWEST_VERSION, handleEnsureNewestVersion);
}

const sagaMiddleware = createSagaMiddleware();
const store = createStore(reducer, applyMiddleware(sagaMiddleware));

// store.subscribe(() => console.log(`  store: ${JSON.stringify(store.getState())}`));
sagaMiddleware.run(rootSaga);

// ─── Demo ─────────────────────────────────────────────────────────────────────

console.log("\n=== Scenario 1: two pushSaveQueue dispatches in rapid succession ===");
console.log("Second should wait for the first to complete.\n");
store.dispatch(pushSaveQueueAction());
store.dispatch(pushSaveQueueAction());

setTimeout(() => {
  console.log("\n=== Scenario 2: standalone ensureNewestVersion (runs after Scenario 1) ===\n");
  store.dispatch(ensureNewestVersionAction());
  store.dispatch(ensureNewestVersionAction());
}, 2000);
