import { call } from "redux-saga/effects";
import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { sleep } from "libs/utils";
import { dispatchGetNewIdAsync } from "viewer/model/actions/actions";
import {
  setIdReservationsAction,
  setSegmentGroupsAction,
} from "viewer/model/actions/volumetracing_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, type TestContext, vi } from "vitest";

describe("ID reservation saga", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
    vi.mocked(context.mocks.Request.sendJSONReceiveJSON).mockClear();
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  function mockReserveIdsEndpoint(
    mocks: WebknossosTestContext["mocks"],
    ids: number[],
    delay: number = 0,
  ) {
    vi.mocked(mocks.Request.sendJSONReceiveJSON).mockImplementation(async (url: string) => {
      if (url.includes("/reserveIds")) {
        if (delay > 0) {
          console.log("sleep...");
          await sleep(delay);
          console.log("sleep done.");
        }
        console.log("return ids");
        return ids;
      }
      return {};
    });
  }

  it("should fetch new IDs and return the first when no reservations exist", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    const { tracingId } = Store.getState().annotation.volumes[0];

    mockReserveIdsEndpoint(mocks, [100, 101, 102, 103, 104]);

    const task = startSaga(function* task() {
      const id = yield call(() => dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"));

      expect(id).toBe(100);

      const reservations = Store.getState().annotation.volumes[0].idReservations.SegmentGroup;
      expect(reservations).toEqual([
        { id: 100, used: true },
        { id: 101, used: false },
        { id: 102, used: false },
        { id: 103, used: false },
        { id: 104, used: false },
      ]);
    });

    await task.toPromise();
  });

  it("should use an existing reservation without calling the API when the buffer is sufficient", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    const { tracingId } = Store.getState().annotation.volumes[0];

    // 3 usable reservations: 3 >= IDEAL_ID_BUFFER_SIZE / 2 (2.5), so no replenishment is triggered
    Store.dispatch(
      setIdReservationsAction(tracingId, "SegmentGroup", [
        { id: 100, used: false },
        { id: 101, used: false },
        { id: 102, used: false },
      ]),
    );

    const task = startSaga(function* task() {
      const id = yield call(() => dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"));

      expect(id).toBe(100);

      const reserveIdsCalls = vi
        .mocked(mocks.Request.sendJSONReceiveJSON)
        .mock.calls.filter(([url]) => url.includes("/reserveIds"));
      expect(reserveIdsCalls).toHaveLength(0);
    });

    await task.toPromise();
  });

  it("should skip reservation IDs at or below the maximum segment group ID", async () => {
    const { tracingId } = Store.getState().annotation.volumes[0];

    // Set up a segment group with groupId=10, making maxGroupId=10
    Store.dispatch(
      setSegmentGroupsAction([{ name: "Existing Group", groupId: 10, children: [] }], tracingId),
    );

    // 5 reservations: IDs 5 and 10 are stale (not > maxGroupId=10), IDs 15, 20, 25 are valid.
    // 3 valid reservations >= IDEAL_ID_BUFFER_SIZE / 2 (2.5), so no replenishment is triggered
    Store.dispatch(
      setIdReservationsAction(tracingId, "SegmentGroup", [
        { id: 5, used: false },
        { id: 10, used: false },
        { id: 15, used: false },
        { id: 20, used: false },
        { id: 25, used: false },
      ]),
    );

    const task = startSaga(function* task() {
      const id = yield call(() => dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"));

      // IDs 5 and 10 are filtered; 15 is the first valid ID
      expect(id).toBe(15);
    });

    await task.toPromise();
  });

  it.for([
    [0],
    [20],
  ])("should replenish the buffer after an ID is returned when the remaining count falls below the threshold (delay=%i)", async ([
    // We use an artificial delay to also test whether dispatchGetNewIdAsync correctly
    // awaits ongoing replenishment requests
    delay,
  ], context: TestContext) => {
    const { mocks } = context as WebknossosTestContext;
    const { tracingId } = Store.getState().annotation.volumes[0];

    // 2 usable reservations: 2 < IDEAL_ID_BUFFER_SIZE / 2 (2.5), so replenishment fires after the
    // first use. But replenishment is async — it runs concurrently with the next request.
    Store.dispatch(
      setIdReservationsAction(tracingId, "SegmentGroup", [
        { id: 199, used: true },
        { id: 200, used: false },
        { id: 201, used: false },
      ]),
    );

    mockReserveIdsEndpoint(mocks, [300, 301, 302, 303], delay);

    const task = startSaga(function* task() {
      const id1 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      expect(id1).toBe(200);

      const id2 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      expect(id2).toBe(201);

      // Buffer is now empty; this request must wait for the replenishment saga to complete.
      // After it returns we are guaranteed replenishment has run.
      const id3 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      expect(id3).toBe(300);

      const reservations = Store.getState().annotation.volumes[0].idReservations.SegmentGroup;
      expect(reservations).toEqual(
        expect.arrayContaining([
          { id: 300, used: true },
          { id: 301, used: false },
          { id: 302, used: false },
          { id: 303, used: false },
        ]),
      );
    });

    await task.toPromise();
  });

  it("should release stale (already-used) IDs when fetching new reservations", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    const { tracingId } = Store.getState().annotation.volumes[0];

    // Both existing reservations are marked used. New ids must be fetched.
    Store.dispatch(
      setIdReservationsAction(tracingId, "SegmentGroup", [
        { id: 5, used: true },
        { id: 10, used: true },
      ]),
    );

    mockReserveIdsEndpoint(mocks, [100, 101, 102, 103, 104]);

    const task = startSaga(function* task() {
      const id = yield call(() => dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"));

      expect(id).toBe(100);

      const reserveIdsCalls = vi
        .mocked(mocks.Request.sendJSONReceiveJSON)
        .mock.calls.filter(([url]) => url.includes("/reserveIds"));
      expect(reserveIdsCalls).toHaveLength(1);

      const [, options] = reserveIdsCalls[0];
      expect((options.data as Record<string, unknown>).numberOfIdsToReserve).toBe(5);
      // Used IDs must be released so the backend can reassign them
      expect((options.data as Record<string, unknown>).idsToRelease).toEqual(
        expect.arrayContaining([5, 10]),
      );
    });

    await task.toPromise();
  });

  it("should return a different ID for each sequential request", async () => {
    const { tracingId } = Store.getState().annotation.volumes[0];

    // Set up a segment group with groupId=101, making maxGroupId=101
    Store.dispatch(
      setSegmentGroupsAction([{ name: "Existing Group", groupId: 101, children: [] }], tracingId),
    );

    // Enough reservations to avoid replenishment across three requests
    Store.dispatch(
      setIdReservationsAction(tracingId, "SegmentGroup", [
        { id: 100, used: true },
        { id: 101, used: false }, // the ID wasn't marked as used, but maxGroupId should still exclude it.
        { id: 102, used: false },
        { id: 103, used: false },
        { id: 104, used: false },
        { id: 105, used: false },
      ]),
    );

    const task = startSaga(function* task() {
      const id1 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      const id2 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      const id3 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );

      expect(id1).toBe(102);
      expect(id2).toBe(103);
      expect(id3).toBe(104);
    });

    await task.toPromise();
  });
});
