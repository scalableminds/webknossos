/*
Our app needs to execute several different sync operations which should not interfere with each other
(so, usually, they should not run concurrently).
To guard against concurrent execution, we suggest an "OperationContext" abstraction. When creating an operation context,
the returned context guarantees that no other operation is executed.
Running operations are stored in a redux store.

However, we need to allow that one operation can call another operation. This should be allowed because the outer
operation explicitly asks for that. The idea is now to piggyback on the existing operation context and passing that
along when dispatching a redux action.
The handler of such redux actions can than either create a new operation context (i.e., needs to wait that other operations
are finished) OR it can reuse the existing context (so, no waiting).
 */

// Should be stored in a redux store.
const runningOperations = [];

function* createOperationContext(options) {
	if (runningOperations.length === 0) {
		runningOperations.push(options.id);
		function* execute(saga) {
			yield put("REGISTER_OPERATION_CONTEXT", options)
			yield call(saga);
			yield put("UNREGISTER_OPERATION_CONTEXT")
		}
		return {
			id: options.id,
			execute,
		}
	} else {
		if (options.behaviorWhenDisallowed === "wait") {
			// wait for the ongoing operation to be exited operations
			yield take("UNREGISTER_OPERATION_CONTEXT");
			// Retry be recursing
			return yield* call(createOperationContext, options);
		} else {
			console.log("Ignore...")
		}
	}
}

function* getOrCreateOperationContext(options, optOperationContext) {
	if (optOperationContext != null) {
		return optOperationContext
	}

	const context = yield* call(createOperationContext, options);
	return context;
}

function* handlePushSaveQueueAsync() {
	const operationContext = yield* call(createOperationContext, {
		id: "handlePushSaveQueueAsync"
		blocksUserInterface: true,
		behaviorWhenDisallowed: "wait", // or: "ignore" | "raise"
	});
	yield* call(operationContext.execute, function* impl() {
		yield* call(doStuff1);
		yield put(ensureHasNewestVersionAction(operationContext))
		yield* call(doStuff2);
	});
}


function* handleEnsureHasNewestVersionAsync(action) {
	const operationContext = yield* call(getOrCreateOperationContext, action.operationContext)
	operationContext.execute(function* impl() {
		...
	}, operationContext)
}

function rootSaga() {
	takeEvery("PUSH_SAVE_QUEUE_ASYNC", handlePushSaveQueueAsync)
	takeEvery("ENSURE_HAS_NEWEST_VERSION_ASYNC", handleEnsureHasNewestVersionAsync)
}
