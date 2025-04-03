import test, { type ExecutionContext } from "ava";
import _ from "lodash";
import mockRequire from "mock-require";
import type { OxalisState } from "oxalis/store";
import { createMockTask } from "@redux-saga/testing-utils";
import { put, call } from "redux-saga/effects";
import dummyUser from "test/fixtures/dummy_user";
import defaultState from "oxalis/default_state";
import { expectValueDeepEqual } from "test/helpers/sagaHelpers";
import {
  setAnnotationAllowUpdateAction,
  setBlockedByUserAction,
  setOthersMayEditForAnnotationAction,
} from "oxalis/model/actions/annotation_actions";
import { ensureWkReady } from "oxalis/model/sagas/ready_sagas";

const createInitialState = (othersMayEdit: boolean, allowUpdate: boolean = true): OxalisState => ({
  ...defaultState,
  activeUser: dummyUser,
  annotation: {
    ...defaultState.annotation,
    restrictions: {
      ...defaultState.annotation.restrictions,
      allowUpdate,
    },
    volumes: [],
    othersMayEdit,
    annotationId: "1234",
  },
});

const blockingUser = { firstName: "Sample", lastName: "User", id: "1111" };

mockRequire("libs/toast", {
  warning: _.noop,
  close: _.noop,
  success: _.noop,
});
mockRequire("libs/user_local_storage", {
  getItem: _.noop,
  setItem: _.noop,
  removeItem: _.noop,
  clear: _.noop,
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
    saga.next(storeState.annotation.restrictions.allowUpdate);
    saga.next(storeState.annotation.annotationId);
    t.deepEqual(saga.next().done, true, "The saga should terminate.");
  },
);

function prepareTryAcquireMutexSaga(t: ExecutionContext, othersMayEdit: boolean) {
  const tryAcquireMutexContinuouslyMocked = createMockTask();
  const listenForOthersMayEditMocked = createMockTask();
  const storeState = createInitialState(othersMayEdit);
  const saga = acquireAnnotationMutexMaybe();
  expectValueDeepEqual(t, saga.next(), call(ensureWkReady));
  t.deepEqual(
    saga.next(wkReadyAction()).value.type,
    "SELECT",
    "The saga should select the allowUpdate next.",
  );
  t.deepEqual(
    saga.next(storeState.annotation.restrictions.allowUpdate).value.type,
    "SELECT",
    "The saga should select the annotationId next.",
  );
  t.deepEqual(
    saga.next(storeState.annotation.annotationId).value.type,
    "SELECT",
    "The saga should select the othersMayEdit next.",
  );
  t.deepEqual(
    saga.next(storeState.annotation.othersMayEdit).value.type,
    "SELECT",
    "The saga should select the activeUser next.",
  );
  let sagaValue = saga.next(storeState.activeUser).value;
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
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next(),
    put(setBlockedByUserAction(dummyUser)),
  );
  t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL"); // delay is called
  t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL");
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next({
      canEdit: true,
      blockedByUser: null,
    }),
    put(setBlockedByUserAction(dummyUser)),
  );
  t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL"); // delay is called
  t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL");
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next({
      canEdit: false,
      blockedByUser: blockingUser,
    }),
    put(setAnnotationAllowUpdateAction(false)),
  );
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next(),
    put(setBlockedByUserAction(blockingUser)),
  );
  t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL"); // delay is called
}

function testFailingReacquiringMutex(t: ExecutionContext, tryAcquireMutexContinuously: any) {
  // This method test whether the saga handles the following server responses correctly:
  // 1. canEdit: false, 2. canEdit: false, 3. canEdit: true, 4. canEdit: false
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next(),
    put(setAnnotationAllowUpdateAction(false)),
  );
  t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL");
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next({
      canEdit: false,
      blockedByUser: blockingUser,
    }),
    put(setAnnotationAllowUpdateAction(false)),
  );
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next(),
    put(setBlockedByUserAction(blockingUser)),
  );
  t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL"); // delay is called
  t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL");
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next({
      canEdit: false,
      blockedByUser: blockingUser,
    }),
    put(setAnnotationAllowUpdateAction(false)),
  );
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next(),
    put(setBlockedByUserAction(blockingUser)),
  );
  t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL"); // delay is called
  t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL");
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next({
      canEdit: true,
      blockedByUser: null,
    }),
    put(setAnnotationAllowUpdateAction(false)),
  );
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next(),
    put(setBlockedByUserAction(dummyUser)),
  );
  t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL"); // delay is called
  t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL");
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next({
      canEdit: false,
      blockedByUser: blockingUser,
    }),
    put(setAnnotationAllowUpdateAction(false)),
  );
  expectValueDeepEqual(
    t,
    tryAcquireMutexContinuously.next(),
    put(setBlockedByUserAction(blockingUser)),
  );
  t.deepEqual(tryAcquireMutexContinuously.next().value.type, "CALL"); // delay is called
}

test.serial(
  "An annotation with othersMayEdit = false should not try to acquire the annotation mutex.",
  (t) => {
    prepareTryAcquireMutexSaga(t, false);
  },
);

test.serial(
  "An annotation with othersMayEdit = true should try to acquire the annotation mutex.",
  (t) => {
    prepareTryAcquireMutexSaga(t, true);
  },
);

test.serial(
  "An annotation with othersMayEdit = true should retry to acquire the annotation mutex.",
  (t) => {
    const { tryAcquireMutexContinuously } = prepareTryAcquireMutexSaga(t, true);
    testReacquiringMutex(t, tryAcquireMutexContinuously);
  },
);

test.serial(
  "An annotation with othersMayEdit = true should not be updatable when the initial mutex acquiring failed.",
  (t) => {
    const { tryAcquireMutexContinuously } = prepareTryAcquireMutexSaga(t, true);
    testFailingReacquiringMutex(t, tryAcquireMutexContinuously);
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
    expectValueDeepEqual(
      t,
      tryAcquireMutexContinuously.next(),
      put(setBlockedByUserAction(dummyUser)),
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
  "An annotation with othersMayEdit getting set to true should try to acquire the annotation mutex.",
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
