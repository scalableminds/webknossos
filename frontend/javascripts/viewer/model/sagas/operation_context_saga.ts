import { call, put, select, take } from "redux-saga/effects";
import type { OperationId } from "viewer/model/actions/operation_context_actions";
import {
  registerChildOperationAction,
  registerOperationAction,
  unregisterChildOperationAction,
  unregisterOperationAction,
} from "viewer/model/actions/operation_context_actions";
import type { WebknossosState } from "viewer/store";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OperationOptions {
  id: OperationId;
  description?: string; // human-readable label stored in Redux (e.g. "Min-cut is being computed.")
  behaviorWhenDisallowed?: "wait" | "ignore" | "raise"; // defaults to "wait"
  // If provided, called when `pendingId` wants to start while this operation is
  // running. Return true to allow concurrent execution. Absent means: never allow
  // additional operations. Receives the current store state so it can make
  // state-dependent decisions without yielding (keeping the critical section atomic).
  allowAdditionalOperation?: (pendingId: OperationId, state: WebknossosState) => boolean;
}

export interface OperationContext {
  id: OperationId;
  execute(saga: () => Generator): Generator;
}

// Tracks a running operation alongside its concurrency predicate.
interface ActiveOperation {
  id: OperationId;
  description?: string;
  allowAdditionalOperation?: (pendingId: OperationId, state: WebknossosState) => boolean;
}

// ─── Mutex ────────────────────────────────────────────────────────────────────
// Array rather than scalar to support optional concurrent operations.
// The Redux store mirrors this for observability.

let activeOperations: ActiveOperation[] = [];

// Promise-chain mutex serializing the check-and-register critical section.
// acquireOperationsMutex() is synchronous and atomically advances the chain tail,
// so two callers in the same JS tick queue correctly behind each other.
// The returned promise resolves only when the previous holder calls release().
// todo: reset this when WK main sagas are reset.
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
function checkCanStart(pendingId: OperationId, state: WebknossosState): boolean {
  if (activeOperations.length === 0) return true;
  // The same operation ID is never allowed to run twice in parallel.
  if (activeOperations.some((op) => op.id === pendingId)) return false;
  for (const op of activeOperations) {
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
export function createOperationContext(
  options: IgnoreOptions,
): Generator<any, OperationContext | null, any>;
export function createOperationContext(
  options: NonNullableOptions,
): Generator<any, OperationContext, any>;
export function* createOperationContext(
  options: OperationOptions,
): Generator<any, OperationContext | null, any> {
  const behavior = options.behaviorWhenDisallowed ?? "wait";

  // Acquire the mutex, snapshot state, do the atomic check-and-push, then release
  // before any further yields. This prevents two concurrent callers from both
  // reading activeOperations and both deciding canStart = true.
  const release: () => void = yield call(acquireOperationsMutex);
  const state: WebknossosState = yield select((s: WebknossosState) => s);
  const canStart = checkCanStart(options.id, state);
  if (canStart) {
    activeOperations.push({
      id: options.id,
      description: options.description,
      allowAdditionalOperation: options.allowAdditionalOperation,
    });
  }
  release();

  if (canStart) {
    yield put(registerOperationAction(options.id, options.description));

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
          yield put(unregisterOperationAction(options.id));
        }
      },
    };
    return context;
  }

  if (behavior === "wait") {
    yield take("UNREGISTER_OPERATION");
    // Re-check after waking: another waiter may have grabbed the lock first.
    // Cast is safe: we only reach "wait" when behaviorWhenDisallowed is "wait" or undefined.
    return yield* createOperationContext(options as NonNullableOptions);
  }

  if (behavior === "raise") {
    throw new Error(
      `[${options.id}] cannot start: active operations: [${activeOperations.map((op) => op.id).join(", ")}]`,
    );
  }

  // "ignore"
  return null;
}

// Returns a context that runs within an existing (parent) lock.
// The child is registered in the Redux store for the duration of execute(),
// which is also single-use to prevent accidental double-execution.
export function borrowedContext(
  existing: OperationContext,
  childId: OperationId,
): OperationContext {
  let consumed = false;
  return {
    id: existing.id,
    *execute(saga: () => Generator) {
      if (consumed) throw new Error(`[${childId}] borrowed context already consumed`);
      consumed = true;
      yield put(registerChildOperationAction(childId, existing.id));
      try {
        yield* saga();
      } finally {
        yield put(unregisterChildOperationAction(childId));
      }
    },
  };
}

export function getOrCreateOperationContext(
  options: IgnoreOptions,
  existing?: OperationContext | null,
): Generator<any, OperationContext | null, any>;
export function getOrCreateOperationContext(
  options: NonNullableOptions,
  existing?: OperationContext | null,
): Generator<any, OperationContext, any>;
export function* getOrCreateOperationContext(
  options: OperationOptions,
  existing?: OperationContext | null,
): Generator<any, OperationContext | null, any> {
  if (existing != null) {
    return borrowedContext(existing, options.id);
  }
  // Cast is safe: if options is NonNullableOptions, the result is non-null (handled by overloads).
  return yield* createOperationContext(options as NonNullableOptions);
}

// ─── Completion Token ─────────────────────────────────────────────────────────

export function createCompletionToken(): { promise: Promise<void>; onComplete: () => void } {
  let onComplete!: () => void;
  const promise = new Promise<void>((resolve) => {
    onComplete = resolve;
  });
  return { promise, onComplete };
}

// ─── Test utilities ───────────────────────────────────────────────────────────

// Resets module-level state. Only intended for use in tests.
export function _resetOperationContextForTesting(): void {
  activeOperations = [];
  operationsMutex = Promise.resolve();
}
