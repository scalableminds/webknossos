import "test/mocks/lz4";
import test, { ExecutionContext } from "ava";
import mockRequire from "mock-require";
import { OxalisState } from "oxalis/store";
import { take, put, call } from "redux-saga/effects";
import defaultState from "oxalis/default_state";
import { expectValueDeepEqual } from "test/helpers/sagaHelpers";
import {
  setAnnotationAllowUpdateAction,
  setOthersMayEditForAnnotationAction,
} from "oxalis/model/actions/annotation_actions";
import { acquireAnnotationMutex } from "admin/admin_rest_api";

const createInitialState = (othersMayEdit: boolean, allowUpdate: boolean = true): OxalisState => ({
  ...defaultState,
  tracing: {
    ...defaultState.tracing,
    restrictions: {
      ...defaultState.tracing.restrictions,
      allowUpdate,
    },
    volumes: [],
    othersMayEdit,
    annotationId: "1234",
  },
});

const { wkReadyAction } = mockRequire.reRequire("oxalis/model/actions/actions");
const { acquireAnnotationMutexMaybe } = mockRequire.reRequire("oxalis/model/sagas/annotation_saga");

test.serial(
  "A annotation with allowUpdate = false should not try to acquire the annotation mutex.",
  (t) => {
    const storeState = createInitialState(false, false);
    const saga = acquireAnnotationMutexMaybe();
    saga.next();
    saga.next(wkReadyAction());
    saga.next(storeState.tracing.restrictions.allowUpdate);
    saga.next(storeState.tracing.annotationId);
    t.deepEqual(saga.next().done, true, "The saga should terminate.");
  },
);

function prepareListenForOthersMayEdit(t: ExecutionContext) {
  const storeState = createInitialState(false);
  const saga = acquireAnnotationMutexMaybe();
  expectValueDeepEqual(t, saga.next(), take("WK_READY"));
  t.deepEqual(
    saga.next(wkReadyAction()).value.type,
    "SELECT",
    "The saga should select the allowUpdate next.",
  );
  t.deepEqual(
    saga.next(storeState.tracing.restrictions.allowUpdate).value.type,
    "SELECT",
    "The saga should select the annotationId next.",
  );
  t.deepEqual(
    saga.next(storeState.tracing.annotationId).value.type,
    "SELECT",
    "The saga should select the othersMayEdit next.",
  );
  let sagaValue = saga.next(storeState.tracing.othersMayEdit).value;
  const listenForOthersMayEdit = sagaValue.payload.args[1];
  t.deepEqual(sagaValue.type, "FORK", "The saga should fork listenForOthersMayEdit.");
  t.deepEqual(saga.next().done, true, "The saga should terminate.");
  return listenForOthersMayEdit;
}

function prepareTryAcquireMutexSaga(t: ExecutionContext) {
  const storeState = createInitialState(true);
  const saga = acquireAnnotationMutexMaybe();
  expectValueDeepEqual(t, saga.next(), take("WK_READY"));
  t.deepEqual(
    saga.next(wkReadyAction()).value.type,
    "SELECT",
    "The saga should select the allowUpdate next.",
  );
  t.deepEqual(
    saga.next(storeState.tracing.restrictions.allowUpdate).value.type,
    "SELECT",
    "The saga should select the annotationId next.",
  );
  t.deepEqual(
    saga.next(storeState.tracing.annotationId).value.type,
    "SELECT",
    "The saga should select the othersMayEdit next.",
  );
  let sagaValue = saga.next(storeState.tracing.othersMayEdit).value;
  const tryAcquireMutex = sagaValue.payload.fn();
  t.deepEqual(sagaValue.type, "FORK", "The saga should fork tryAcquireMutex.");
  sagaValue = saga.next(storeState.tracing.othersMayEdit).value;
  const listenForOthersMayEdit = sagaValue.payload.args[1];
  t.deepEqual(sagaValue.type, "FORK", "The saga should fork listenForOthersMayEdit.");
  t.deepEqual(saga.next().done, true, "The saga should terminate.");
  return { tryAcquireMutex, listenForOthersMayEdit };
}

function testReacquiringMutex(t: ExecutionContext, tryAcquireMutex: any) {
  const storeState = createInitialState(true);
  expectValueDeepEqual(t, tryAcquireMutex.next(), put(setAnnotationAllowUpdateAction(false)));
  expectValueDeepEqual(
    t,
    tryAcquireMutex.next(),
    call(acquireAnnotationMutex, storeState.tracing.annotationId),
  );
  expectValueDeepEqual(
    t,
    tryAcquireMutex.next({
      canEdit: true,
      blockedByUser: null,
    }),
    put(setAnnotationAllowUpdateAction(true)),
  );
  tryAcquireMutex.next(); // delay is called
  expectValueDeepEqual(
    t,
    tryAcquireMutex.next(),
    call(acquireAnnotationMutex, storeState.tracing.annotationId),
  );
  expectValueDeepEqual(
    t,
    tryAcquireMutex.next({
      canEdit: false,
      blockedByUser: { firstName: "Sample", lastName: "User", id: "1111" },
    }),
    put(setAnnotationAllowUpdateAction(false)),
  );
}

test.serial(
  "A annotation with othersMayEdit = false should not try to acquire the annotation mutex.",
  (t) => {
    prepareListenForOthersMayEdit(t);
  },
);

test.serial(
  "A annotation with othersMayEdit = true should try to acquire the annotation mutex.",
  (t) => {
    prepareTryAcquireMutexSaga(t);
  },
);

test.serial(
  "A annotation with othersMayEdit = true should retry to acquire the annotation mutex.",
  (t) => {
    const { tryAcquireMutex } = prepareTryAcquireMutexSaga(t);
    testReacquiringMutex(t, tryAcquireMutex);
  },
);

test.serial(
  "It should not try to acquire the annotation mutex if othersMayEdit is set to false.",
  (t) => {
    const storeState = createInitialState(true);
    const { tryAcquireMutex, listenForOthersMayEdit } = prepareTryAcquireMutexSaga(t);

    // testing the tryAcquireMutex saga
    expectValueDeepEqual(t, tryAcquireMutex.next(), put(setAnnotationAllowUpdateAction(false)));
    expectValueDeepEqual(
      t,
      tryAcquireMutex.next(),
      call(acquireAnnotationMutex, storeState.tracing.annotationId),
    );
    expectValueDeepEqual(
      t,
      tryAcquireMutex.next({
        canEdit: true,
        blockedByUser: null,
      }),
      put(setAnnotationAllowUpdateAction(true)),
    );
    tryAcquireMutex.next(); // delay is called
    const listenForOthersMayEditSaga = listenForOthersMayEdit(
      setOthersMayEditForAnnotationAction(false),
    ); //othersMayEdit is set to false.
    expectValueDeepEqual(
      t,
      listenForOthersMayEditSaga.next(),
      put(setAnnotationAllowUpdateAction(true)),
    );
    t.deepEqual(
      listenForOthersMayEditSaga.next().done,
      true,
      "The listenForOthersMayEdit saga should terminate.",
    );
    t.deepEqual(
      tryAcquireMutex.next().done,
      true,
      "The tryAcquireMutex saga should terminate as otherMayEdit is set to false.",
    );
  },
);

test.serial(
  "A annotation with othersMayEdit getting set to true should try to acquire the annotation mutex.",
  (t) => {
    const listenForOthersMayEdit = prepareListenForOthersMayEdit(t);
    const listenForOthersMayEditSaga = listenForOthersMayEdit(
      setOthersMayEditForAnnotationAction(true),
    );
    const sagaValue = listenForOthersMayEditSaga.next().value;
    const tryAcquireMutex = sagaValue.payload.fn();
    t.deepEqual(sagaValue.type, "CALL");
    t.deepEqual(
      listenForOthersMayEditSaga.next().done,
      true,
      "The listenForOthersMayEdit saga should terminate.",
    );
    testReacquiringMutex(t, tryAcquireMutex);
  },
);
