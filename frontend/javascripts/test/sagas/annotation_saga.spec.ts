import { describe, expect, it } from "vitest";
import type { WebknossosState } from "viewer/store";
import { createMockTask } from "@redux-saga/testing-utils";
import { put, call } from "redux-saga/effects";
import dummyUser from "test/fixtures/dummy_user";
import defaultState from "viewer/default_state";
import { expectValueDeepEqual } from "test/helpers/sagaHelpers";
import {
  setAnnotationAllowUpdateAction,
  setBlockedByUserAction,
  setOthersMayEditForAnnotationAction,
} from "viewer/model/actions/annotation_actions";
import { ensureWkReady } from "viewer/model/sagas/ready_sagas";
import { wkReadyAction } from "viewer/model/actions/actions";
import { acquireAnnotationMutexMaybe } from "viewer/model/sagas/saving/save_mutex_saga";

const createInitialState = (
  othersMayEdit: boolean,
  allowUpdate: boolean = true,
): WebknossosState => ({
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

describe("Annotation Saga", () => {
  it("An annotation with allowUpdate = false should not try to acquire the annotation mutex.", () => {
    const storeState = createInitialState(false, false);
    const saga = acquireAnnotationMutexMaybe();
    saga.next();
    saga.next(wkReadyAction());
    saga.next(storeState.annotation.restrictions.allowUpdate);
    saga.next(storeState.annotation.annotationId);
    expect(saga.next().done, "The saga should terminate.").toBe(true);
  });

  function prepareTryAcquireMutexSaga(othersMayEdit: boolean) {
    const tryAcquireMutexContinuouslyMocked = createMockTask();
    const listenForOthersMayEditMocked = createMockTask();
    const storeState = createInitialState(othersMayEdit);
    const saga = acquireAnnotationMutexMaybe();

    expectValueDeepEqual(expect, saga.next(), call(ensureWkReady));
    expect(
      saga.next(wkReadyAction()).value.type,
      "The saga should select the allowUpdate next.",
    ).toBe("SELECT");
    expect(
      saga.next(storeState.annotation.restrictions.allowUpdate).value.type,
      "The saga should select the annotationId next.",
    ).toBe("SELECT");
    expect(
      saga.next(storeState.annotation.annotationId).value.type,
      "The saga should select the othersMayEdit next.",
    ).toBe("SELECT");
    expect(
      saga.next(storeState.annotation.othersMayEdit).value.type,
      "The saga should select the activeUser next.",
    ).toBe("SELECT");

    let sagaValue = saga.next(storeState.activeUser).value;
    const tryAcquireMutexContinuously = sagaValue.payload.fn();
    expect(sagaValue.type, "The saga should fork tryAcquireMutexContinuously.").toBe("FORK");

    sagaValue = saga.next(tryAcquireMutexContinuouslyMocked).value;
    const listenForOthersMayEdit = sagaValue.payload.args[1];
    expect(sagaValue.type, "The saga should fork listenForOthersMayEdit.").toBe("FORK");
    expect(saga.next(listenForOthersMayEditMocked).done).toBe(true);

    return { tryAcquireMutexContinuously, listenForOthersMayEdit };
  }

  function testReacquiringMutex(tryAcquireMutexContinuously: any) {
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next(),
      put(setAnnotationAllowUpdateAction(false)),
    );
    expect(tryAcquireMutexContinuously.next().value.type).toBe("CALL");
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next({
        canEdit: true,
        blockedByUser: null,
      }),
      put(setAnnotationAllowUpdateAction(true)),
    );
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next(),
      put(setBlockedByUserAction(dummyUser)),
    );
    expect(tryAcquireMutexContinuously.next().value.type).toBe("CALL"); // delay is called
    expect(tryAcquireMutexContinuously.next().value.type).toBe("CALL");
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next({
        canEdit: true,
        blockedByUser: null,
      }),
      put(setBlockedByUserAction(dummyUser)),
    );
    expect(tryAcquireMutexContinuously.next().value.type).toBe("CALL"); // delay is called
    expect(tryAcquireMutexContinuously.next().value.type).toBe("CALL");
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next({
        canEdit: false,
        blockedByUser: blockingUser,
      }),
      put(setAnnotationAllowUpdateAction(false)),
    );
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next(),
      put(setBlockedByUserAction(blockingUser)),
    );
    expect(tryAcquireMutexContinuously.next().value.type).toBe("CALL"); // delay is called
  }

  function testFailingReacquiringMutex(tryAcquireMutexContinuously: any) {
    // This method test whether the saga handles the following server responses correctly:
    // 1. canEdit: false, 2. canEdit: false, 3. canEdit: true, 4. canEdit: false
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next(),
      put(setAnnotationAllowUpdateAction(false)),
    );
    expect(tryAcquireMutexContinuously.next().value.type).toBe("CALL");
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next({
        canEdit: false,
        blockedByUser: blockingUser,
      }),
      put(setAnnotationAllowUpdateAction(false)),
    );
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next(),
      put(setBlockedByUserAction(blockingUser)),
    );
    expect(tryAcquireMutexContinuously.next().value.type).toBe("CALL"); // delay is called
    expect(tryAcquireMutexContinuously.next().value.type).toBe("CALL");
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next({
        canEdit: false,
        blockedByUser: blockingUser,
      }),
      put(setAnnotationAllowUpdateAction(false)),
    );
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next(),
      put(setBlockedByUserAction(blockingUser)),
    );
    expect(tryAcquireMutexContinuously.next().value.type).toBe("CALL"); // delay is called
    expect(tryAcquireMutexContinuously.next().value.type).toBe("CALL");
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next({
        canEdit: true,
        blockedByUser: null,
      }),
      put(setAnnotationAllowUpdateAction(false)),
    );
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next(),
      put(setBlockedByUserAction(dummyUser)),
    );
    expect(tryAcquireMutexContinuously.next().value.type).toBe("CALL"); // delay is called
    expect(tryAcquireMutexContinuously.next().value.type).toBe("CALL");
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next({
        canEdit: false,
        blockedByUser: blockingUser,
      }),
      put(setAnnotationAllowUpdateAction(false)),
    );
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next(),
      put(setBlockedByUserAction(blockingUser)),
    );
    expect(tryAcquireMutexContinuously.next().value.type).toBe("CALL"); // delay is called
  }

  it("An annotation with othersMayEdit = false should not try to acquire the annotation mutex.", () => {
    prepareTryAcquireMutexSaga(false);
  });

  it("An annotation with othersMayEdit = true should try to acquire the annotation mutex.", () => {
    prepareTryAcquireMutexSaga(true);
  });

  it("An annotation with othersMayEdit = true should retry to acquire the annotation mutex.", () => {
    const { tryAcquireMutexContinuously } = prepareTryAcquireMutexSaga(true);
    testReacquiringMutex(tryAcquireMutexContinuously);
  });

  it("An annotation with othersMayEdit = true should not be updatable when the initial mutex acquiring failed.", () => {
    const { tryAcquireMutexContinuously } = prepareTryAcquireMutexSaga(true);
    testFailingReacquiringMutex(tryAcquireMutexContinuously);
  });

  it("It should not try to acquire the annotation mutex if othersMayEdit is set to false.", () => {
    const { tryAcquireMutexContinuously, listenForOthersMayEdit } =
      prepareTryAcquireMutexSaga(true);

    // testing the tryAcquireMutexContinuously saga
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next(),
      put(setAnnotationAllowUpdateAction(false)),
    );
    expect(tryAcquireMutexContinuously.next().value.type).toBe("CALL");
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next({
        canEdit: true,
        blockedByUser: null,
      }),
      put(setAnnotationAllowUpdateAction(true)),
    );
    expectValueDeepEqual(
      expect,
      tryAcquireMutexContinuously.next(),
      put(setBlockedByUserAction(dummyUser)),
    );
    tryAcquireMutexContinuously.next(); // delay is called
    const listenForOthersMayEditSaga = listenForOthersMayEdit(
      setOthersMayEditForAnnotationAction(false),
    ); //othersMayEdit is set to false.
    expectValueDeepEqual(
      expect,
      listenForOthersMayEditSaga.next(),
      put(setAnnotationAllowUpdateAction(true)),
    );
    expect(listenForOthersMayEditSaga.next().done).toBe(true);
    expect(tryAcquireMutexContinuously.next().done).toBe(true);
  });

  it("An annotation with othersMayEdit getting set to true should try to acquire the annotation mutex.", () => {
    const tryAcquireMutexContinuouslyMocked = createMockTask();
    const { tryAcquireMutexContinuously: cancelledTryAcquireMutexSaga, listenForOthersMayEdit } =
      prepareTryAcquireMutexSaga(false);
    const listenForOthersMayEditSaga = listenForOthersMayEdit(
      setOthersMayEditForAnnotationAction(true),
    );
    expect(listenForOthersMayEditSaga.next(cancelledTryAcquireMutexSaga).value.type).toBe("CANCEL");
    const sagaValue = listenForOthersMayEditSaga.next(cancelledTryAcquireMutexSaga).value;
    const tryAcquireMutexContinuously = sagaValue.payload.fn();
    expect(sagaValue.type).toBe("FORK");
    expect(
      listenForOthersMayEditSaga.next(tryAcquireMutexContinuouslyMocked).done,
      "The saga should fork tryAcquireMutexContinuously.",
    ).toBe(true);
    testReacquiringMutex(tryAcquireMutexContinuously);
  });
});
