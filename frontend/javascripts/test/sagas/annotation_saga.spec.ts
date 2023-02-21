import test, { ExecutionContext } from "ava";
import mockRequire from "mock-require";
import { OxalisState } from "oxalis/store";
import { createMockTask } from "@redux-saga/testing-utils";
import { take, put } from "redux-saga/effects";
import defaultState from "oxalis/default_state";
import { expectValueDeepEqual } from "test/helpers/sagaHelpers";
import {
  setAnnotationAllowUpdateAction,
  setOthersMayEditForAnnotationAction,
} from "oxalis/model/actions/annotation_actions";

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
  "An annotation with allowUpdate = false should not try to acquire the annotation mutex.",
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

function prepareTryAcquireMutexSaga(t: ExecutionContext, othersMayEdit: boolean) {
  const tryAcquireMutexContinuouslyMocked = createMockTask();
  const listenForOthersMayEditMocked = createMockTask();
  const storeState = createInitialState(othersMayEdit);
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
  const tryAcquireMutexContinuously = sagaValue.payload.fn();
  t.deepEqual(sagaValue.type, "FORK", "The saga should fork tryAcquireMutexContinuously.");
  sagaValue = saga.next(tryAcquireMutexContinuouslyMocked).value;
  const listenForOthersMayEdit = sagaValue.payload.args[1];
  t.deepEqual(sagaValue.type, "FORK", "The saga should fork listenForOthersMayEdit.");
  t.deepEqual(saga.next(listenForOthersMayEditMocked).done, true, "The saga should terminate.");
  return { tryAcquireMutexContinuously, listenForOthersMayEdit };
}

function testReacquiringMutex(t: ExecutionContext, tryAcquireMutexContinuously: any) {
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next(),
    put(setAnnotationAllowUpdateAction(false)),
  );
  t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL");
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next({
      canEdit: true,
      blockedByUser: null,
    }),
    put(setAnnotationAllowUpdateAction(true)),
  );
  tryAcquireMutexContinuously.next(); // delay is called
  t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL");
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next({
      canEdit: false,
      blockedByUser: { firstName: "Sample", lastName: "User", id: "1111" },
    }),
    put(setAnnotationAllowUpdateAction(false)),
  );
}

test.serial(
  "A annotation with othersMayEdit = false should not try to acquire the annotation mutex.",
  (t) => {
    prepareTryAcquireMutexSaga(t, false);
  },
);

test.serial(
  "A annotation with othersMayEdit = true should try to acquire the annotation mutex.",
  (t) => {
    prepareTryAcquireMutexSaga(t, true);
  },
);

test.serial(
  "A annotation with othersMayEdit = true should retry to acquire the annotation mutex.",
  (t) => {
    const { tryAcquireMutexContinuously } = prepareTryAcquireMutexSaga(t, true);
    testReacquiringMutex(t, tryAcquireMutexContinuously);
  },
);

test.serial(
  "It should not try to acquire the annotation mutex if othersMayEdit is set to false.",
  (t) => {
    const { tryAcquireMutexContinuously, listenForOthersMayEdit } = prepareTryAcquireMutexSaga(
      t,
      true,
    );

    // testing the tryAcquireMutexContinuously saga
    expectValueDeepEqual(
      t,
      tryAcquireMutexContinuously.next(),
      put(setAnnotationAllowUpdateAction(false)),
    );
    t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL");
    expectValueDeepEqual(
      t,
      tryAcquireMutexContinuously.next({
        canEdit: true,
        blockedByUser: null,
      }),
      put(setAnnotationAllowUpdateAction(true)),
    );
    tryAcquireMutexContinuously.next(); // delay is called
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
      tryAcquireMutexContinuously.next().done,
      true,
      "The tryAcquireMutexContinuously saga should terminate as otherMayEdit is set to false.",
    );
  },
);

test.serial(
  "A annotation with othersMayEdit getting set to true should try to acquire the annotation mutex.",
  (t) => {
    const tryAcquireMutexContinuouslyMocked = createMockTask();
    const { tryAcquireMutexContinuously: cancelledTryAcquireMutexSaga, listenForOthersMayEdit } =
      prepareTryAcquireMutexSaga(t, false);
    const listenForOthersMayEditSaga = listenForOthersMayEdit(
      setOthersMayEditForAnnotationAction(true),
    );
    t.deepEqual(listenForOthersMayEditSaga.next(cancelledTryAcquireMutexSaga).value.type, "CANCEL");
    const sagaValue = listenForOthersMayEditSaga.next(cancelledTryAcquireMutexSaga).value;
    const tryAcquireMutexContinuously = sagaValue.payload.fn();
    t.deepEqual(sagaValue.type, "FORK");
    t.deepEqual(
      listenForOthersMayEditSaga.next(tryAcquireMutexContinuouslyMocked).done,
      true,
      "The listenForOthersMayEdit saga should terminate.",
    );
    testReacquiringMutex(t, tryAcquireMutexContinuously);
  },
);
