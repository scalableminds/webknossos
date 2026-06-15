import { applyMiddleware, createStore } from "redux";
import createSagaMiddleware from "redux-saga";
import { call, delay, put, select, take, takeEvery } from "redux-saga/effects";

// ─── Types ────────────────────────────────────────────────────────────────────

type OperationId = string;

interface OperationOptions {
  id: OperationId;
  behaviorWhenDisallowed?: "wait" | "ignore" | "raise"; // defaults to "wait"
  // If provided, called when `pendingId` wants to start while this operation is
  // running. Return true to allow concurrent execution. Absent means: never allow
  // additional operations. Receives the current store state so it can make
  // state-dependent decisions without yielding (keeping the critical section atomic).
  allowAdditionalOperation?: (pendingId: OperationId, state: AppState) => boolean;
}

interface OperationContext {
  id: OperationId;
  execute(saga: () => Generator): Generator;
}

// Tracks a running operation alongside its concurrency predicate.
interface ActiveOperation {
  id: OperationId;
  allowAdditionalOperation?: (pendingId: OperationId, state: AppState) => boolean;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

const REGISTER_OPERATION = "REGISTER_OPERATION" as const;
const UNREGISTER_OPERATION = "UNREGISTER_OPERATION" as const;
const REGISTER_CHILD_OPERATION = "REGISTER_CHILD_OPERATION" as const;
const UNREGISTER_CHILD_OPERATION = "UNREGISTER_CHILD_OPERATION" as const;
const SET_REBASING = "SET_REBASING" as const;
const PUSH_SAVE_QUEUE = "PUSH_SAVE_QUEUE" as const;
const ENSURE_NEWEST_VERSION = "ENSURE_NEWEST_VERSION" as const;
const PERFORM_UNDO = "PERFORM_UNDO" as const;

const registerOperation = (id: OperationId) => ({ type: REGISTER_OPERATION, id });
const unregisterOperation = (id: OperationId) => ({ type: UNREGISTER_OPERATION, id });
const registerChildOperation = (id: OperationId, parentId: OperationId) => ({
  type: REGISTER_CHILD_OPERATION,
  id,
  parentId,
});
const unregisterChildOperation = (id: OperationId) => ({ type: UNREGISTER_CHILD_OPERATION, id });
const setRebasing = (value: boolean) => ({ type: SET_REBASING, value });
const pushSaveQueueAction = () => ({ type: PUSH_SAVE_QUEUE });
const ensureNewestVersionAction = (
  operationContext?: OperationContext,
  onComplete?: () => void,
) => ({ type: ENSURE_NEWEST_VERSION, operationContext, onComplete });
const performUndoAction = () => ({ type: PERFORM_UNDO });

type AppAction =
  | ReturnType<typeof registerOperation>
  | ReturnType<typeof unregisterOperation>
  | ReturnType<typeof registerChildOperation>
  | ReturnType<typeof unregisterChildOperation>
  | ReturnType<typeof setRebasing>
  | ReturnType<typeof pushSaveQueueAction>
  | ReturnType<typeof ensureNewestVersionAction>
  | ReturnType<typeof performUndoAction>;

// ─── Reducer ──────────────────────────────────────────────────────────────────

interface AppState {
  activeOperations: OperationId[];
  childOperations: Array<{ id: OperationId; parentId: OperationId }>;
  isRebasing: boolean;
}

function reducer(
  state: AppState = { activeOperations: [], childOperations: [], isRebasing: false },
  action: AppAction,
): AppState {
  switch (action.type) {
    case REGISTER_OPERATION:
      return { ...state, activeOperations: [...state.activeOperations, action.id] };
    case UNREGISTER_OPERATION:
      return {
        ...state,
        activeOperations: state.activeOperations.filter((id) => id !== action.id),
        // Children of the unregistered operation cannot outlive their parent.
        childOperations: state.childOperations.filter((c) => c.parentId !== action.id),
      };
    case REGISTER_CHILD_OPERATION:
      return {
        ...state,
        childOperations: [...state.childOperations, { id: action.id, parentId: action.parentId }],
      };
    case UNREGISTER_CHILD_OPERATION:
      return { ...state, childOperations: state.childOperations.filter((c) => c.id !== action.id) };
    case SET_REBASING:
      return { ...state, isRebasing: action.value };
    default:
      return state;
  }
}

// ─── Mutex ────────────────────────────────────────────────────────────────────
// Array rather than scalar to support optional concurrent operations.
// The Redux store mirrors this for observability.

let activeOperations: ActiveOperation[] = [];

// Promise-chain mutex serializing the check-and-register critical section.
// acquireOperationsMutex() is synchronous and atomically advances the chain tail,
// so two callers in the same JS tick queue correctly behind each other.
// The returned promise resolves only when the previous holder calls release().
let operationsMutex: Promise<void> = Promise.resolve();

function acquireOperationsMutex(): Promise<() => void> {
  let release!: () => void;
  const prev = operationsMutex;
  operationsMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  return prev.then(() => release);
}

// ─── Operation Context ────────────────────────────────────────────────────────

// Pure synchronous check — called while holding the mutex, so activeOperations
// cannot be mutated between this read and the subsequent push.
// The same operation ID is never allowed to run twice in parallel, regardless of predicates.
function checkCanStart(pendingId: OperationId, state: AppState): boolean {
  if (activeOperations.length === 0) return true;
  for (const op of activeOperations) {
    if (op.id === pendingId) return false;
    if (op.allowAdditionalOperation == null) return false;
    if (!op.allowAdditionalOperation(pendingId, state)) return false;
  }
  return true;
}

type IgnoreOptions = Omit<OperationOptions, "behaviorWhenDisallowed"> & {
  behaviorWhenDisallowed: "ignore";
};
type NonNullableOptions = Omit<OperationOptions, "behaviorWhenDisallowed"> & {
  behaviorWhenDisallowed?: "wait" | "raise";
};

// "ignore" is the only behavior that can return null; all others always return a context.
function* createOperationContext(
  options: IgnoreOptions,
): Generator<any, OperationContext | null, any>;
function* createOperationContext(
  options: NonNullableOptions,
): Generator<any, OperationContext, any>;
function* createOperationContext(
  options: OperationOptions,
): Generator<any, OperationContext | null, any> {
  const behavior = options.behaviorWhenDisallowed ?? "wait";

  // Acquire the mutex, snapshot state, do the atomic check-and-push, then release
  // before any further yields. This prevents two concurrent callers from both
  // reading activeOperations and both deciding canStart = true.
  const release: () => void = yield call(acquireOperationsMutex);
  const state: AppState = yield select((s: AppState) => s);
  const canStart = checkCanStart(options.id, state);
  if (canStart) {
    activeOperations.push({ id: options.id, allowAdditionalOperation: options.allowAdditionalOperation });
  }
  release();

  if (canStart) {
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
          activeOperations = activeOperations.filter((op) => op.id !== options.id);
          yield put(unregisterOperation(options.id));
        }
      },
    };
    return context;
  }

  if (behavior === "wait") {
    console.log(`  [${options.id}] blocked — waiting`);
    yield take(UNREGISTER_OPERATION);
    // Re-check after waking: another waiter may have grabbed the lock first.
    return yield* createOperationContext(options);
  }

  if (behavior === "raise") {
    throw new Error(
      `[${options.id}] cannot start: active operations: [${activeOperations.map((op) => op.id).join(", ")}]`,
    );
  }

  // "ignore"
  console.log(`  [${options.id}] ignoring: operations already running`);
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
      if (consumed) throw new Error(`[${childId}] borrowed context already consumed`);
      consumed = true;
      yield put(registerChildOperation(childId, existing.id));
      try {
        yield* saga();
      } finally {
        yield put(unregisterChildOperation(childId));
      }
    },
  };
}

function* getOrCreateOperationContext(
  options: IgnoreOptions,
  existing?: OperationContext | null,
): Generator<any, OperationContext | null, any>;
function* getOrCreateOperationContext(
  options: NonNullableOptions,
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
  const ctx = yield* createOperationContext({
    id: "pushSaveQueue",
    // Allow undo to run concurrently, but only while not rebasing.
    // State is passed in by the framework — no yield needed.
    allowAdditionalOperation(pendingId, state) {
      return pendingId === "undo" && !state.isRebasing;
    },
  });

  yield* ctx.execute(function* () {
    console.log("  [save] starting — normal phase");
    yield* doStuff1(); // 300ms, undo allowed here

    console.log("  [save] entering rebasing phase");
    yield put(setRebasing(true));
    yield delay(400); // 400ms, undo blocked here
    yield put(setRebasing(false));
    console.log("  [save] exiting rebasing phase");

    const { promise, onComplete } = createCompletionToken();
    yield put(ensureNewestVersionAction(ctx, onComplete));
    yield* doStuff2(); // 300ms, undo allowed here
    yield call(() => promise);
    console.log("  [save] done");
  });
}

function* handleEnsureNewestVersion(action: ReturnType<typeof ensureNewestVersionAction>) {
  const ctx = yield* getOrCreateOperationContext(
    { id: "ensureNewestVersion" },
    action.operationContext,
  );
  yield* ctx.execute(function* () {
    console.log("    [ensureNewestVersion] start");
    yield* ensureNewestVersionImpl();
    console.log("    [ensureNewestVersion] done");
  });
  action.onComplete?.();
}

function* handlePerformUndo() {
  const ctx = yield* createOperationContext({ id: "undo" });
  yield* ctx.execute(function* () {
    console.log("  [undo] start");
    yield delay(100);
    console.log("  [undo] done");
  });
}

// ─── Root Saga & Store ────────────────────────────────────────────────────────

function* rootSaga() {
  yield takeEvery(PUSH_SAVE_QUEUE, handlePushSaveQueue);
  yield takeEvery(ENSURE_NEWEST_VERSION, handleEnsureNewestVersion);
  yield takeEvery(PERFORM_UNDO, handlePerformUndo);
}

const sagaMiddleware = createSagaMiddleware();
const store = createStore(reducer, applyMiddleware(sagaMiddleware));

// store.subscribe(() => console.log(`  store: ${JSON.stringify(store.getState())}`));
sagaMiddleware.run(rootSaga);

// ─── Demo ─────────────────────────────────────────────────────────────────────
// Each save takes ~1000ms: 300ms normal + 400ms rebasing + 300ms normal.

console.log("\n=== Scenario 1: two pushSaveQueue in rapid succession (second waits) ===\n");
store.dispatch(pushSaveQueueAction());
store.dispatch(pushSaveQueueAction());

// Scenario 2 at t=2500ms (after both saves finish ~2000ms).
setTimeout(() => {
  console.log("\n=== Scenario 2: two standalone ensureNewestVersion (second waits) ===\n");
  store.dispatch(ensureNewestVersionAction());
  store.dispatch(ensureNewestVersionAction());
}, 2500);

// Scenario 3a at t=3500ms: undo dispatched 100ms into save → hits the normal phase,
// allowAdditionalOperation returns true → undo runs concurrently with save.
setTimeout(() => {
  console.log("\n=== Scenario 3a: undo during normal phase — should run concurrently ===\n");
  store.dispatch(pushSaveQueueAction());
  setTimeout(() => store.dispatch(performUndoAction()), 100);
}, 3500);

// Scenario 3b at t=5300ms: undo dispatched 400ms into save → hits the rebasing phase,
// allowAdditionalOperation returns false → undo blocks until rebasing ends at 700ms.
setTimeout(() => {
  console.log("\n=== Scenario 3b: undo during rebasing phase — should wait ===\n");
  store.dispatch(pushSaveQueueAction());
  setTimeout(() => store.dispatch(performUndoAction()), 400);
}, 5300);
