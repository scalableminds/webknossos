import { sleep } from "libs/utils";
import { call } from "redux-saga/effects";
import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import { dispatchGetNewIdAsync, setIdReservationsAction } from "viewer/model/actions/actions";
import { setSegmentGroupsAction } from "viewer/model/actions/volumetracing_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Store } from "viewer/singletons";
import { startSaga } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, type TestContext, vi } from "vitest";

describe("ID reservation saga (concurrent collaboration mode)", () => {
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
          await sleep(delay);
        }
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

      const reservations =
        Store.getState().localSegmentationStateByLayer[tracingId].idReservations.SegmentGroup;
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

    // 4 usable reservations. After getting a new id, 3 remain which is still greater than
    // IDEAL_ID_BUFFER_SIZE / 2 (2.5), so no replenishment is triggered.
    Store.dispatch(
      setIdReservationsAction(tracingId, "SegmentGroup", [
        { id: 100, used: false },
        { id: 101, used: false },
        { id: 102, used: false },
        { id: 103, used: false },
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

  it("should skip 'unused' reservation IDs for which groups already exist", async () => {
    /*
     * Even when a reservation is marked as "unused", it can happen that they are in fact
     * used. This can happen when the page is reloaded after an id was marked as used, but
     * before usage was communicated to the server.
     */
    const { tracingId } = Store.getState().annotation.volumes[0];

    // Set up a segment group with groupId 5 and 10
    Store.dispatch(
      setSegmentGroupsAction(
        [
          { name: "Existing Group", groupId: 5, children: [] },
          { name: "Existing Group", groupId: 10, children: [] },
        ],
        tracingId,
      ),
    );

    // 5 reservations: IDs 5 and 10 are not usable because such groups already exist.
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
      // After it returns, we are guaranteed that the replenishment has finished.
      const id3 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      expect(id3).toBe(300);

      const reservations =
        Store.getState().localSegmentationStateByLayer[tracingId].idReservations.SegmentGroup;
      expect(reservations).toEqual([
        { id: 201, used: true },
        { id: 300, used: true },
        { id: 301, used: false },
        { id: 302, used: false },
        { id: 303, used: false },
      ]);

      const reserveIdsCalls = vi
        .mocked(mocks.Request.sendJSONReceiveJSON)
        .mock.calls.filter(([url]) => url.includes("/reserveIds"));
      expect(reserveIdsCalls).toHaveLength(1);

      const allReleasedIds = vi
        .mocked(mocks.Request.sendJSONReceiveJSON)
        .mock.calls.filter(([url]) => url.includes("/reserveIds"))
        .flatMap(
          ([, options]) => (options.data as Record<string, unknown>).idsToRelease as number[],
        );
      expect(allReleasedIds).toEqual([199, 200]);
    });

    await task.toPromise();
  });

  it("should include pre-existing used IDs in idsToRelease", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    const { tracingId } = Store.getState().annotation.volumes[0];

    // id=5 is already used (e.g. from a previous session) and must eventually be released to the
    // backend. 2 usable IDs are below the IDEAL_ID_BUFFER_SIZE / 2 threshold, so a non-blocking
    // replenishment will be triggered after the first request.
    Store.dispatch(
      setIdReservationsAction(tracingId, "SegmentGroup", [
        { id: 5, used: true },
        { id: 100, used: false },
        { id: 101, used: false },
      ]),
    );

    mockReserveIdsEndpoint(mocks, [300, 301, 302, 303]);

    const task = startSaga(function* task() {
      // Requesting id1 will already trigger a replenishment.
      const id1 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      expect(id1).toBe(100);

      // Exhaust the buffer so replenishment must complete before the third request returns.
      const id2 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      expect(id2).toBe(101);

      const id3 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      expect(id3).toBe(300);

      const allReleasedIds = vi
        .mocked(mocks.Request.sendJSONReceiveJSON)
        .mock.calls.filter(([url]) => url.includes("/reserveIds"))
        .flatMap(
          ([, options]) => (options.data as Record<string, unknown>).idsToRelease as number[],
        );

      // When id1 was requested, replenishment was initiated (therefore, only id 5 and 100
      // are released here).
      expect(allReleasedIds).toEqual([5, 100]);
    });

    await task.toPromise();
  });

  it("should retry the reserveIds endpoint on transient failures and eventually resolve", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    const { tracingId } = Store.getState().annotation.volumes[0];

    let callCount = 0;
    vi.mocked(mocks.Request.sendJSONReceiveJSON).mockImplementation(async (url: string) => {
      if (url.includes("/reserveIds")) {
        callCount++;
        if (callCount < 3) {
          throw new Error("Simulated network failure");
        }
        return [100, 101, 102, 103, 104];
      }
      return {};
    });

    const task = startSaga(function* task() {
      const id = yield call(() => dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"));

      expect(id).toBe(100);
      expect(callCount).toBe(3);

      const reservations =
        Store.getState().localSegmentationStateByLayer[tracingId].idReservations.SegmentGroup;
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

  it("should reject the promise and keep the saga alive when all retries are exhausted", async (context: WebknossosTestContext) => {
    const { mocks } = context;
    const { tracingId } = Store.getState().annotation.volumes[0];

    const networkError = new Error("Persistent network failure");
    vi.mocked(mocks.Request.sendJSONReceiveJSON).mockImplementation(async (url: string) => {
      if (url.includes("/reserveIds")) {
        throw networkError;
      }
      return {};
    });

    const task = startSaga(function* task() {
      yield call(() =>
        expect(dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup")).rejects.toThrow(
          "Persistent network failure",
        ),
      );

      // The saga is still alive — a subsequent request succeeds once the endpoint recovers.
      vi.mocked(mocks.Request.sendJSONReceiveJSON).mockImplementation(async (url: string) => {
        if (url.includes("/reserveIds")) {
          return [200, 201, 202, 203, 204];
        }
        return {};
      });

      const id = yield call(() => dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"));
      expect(id).toBe(200);

      const reservations =
        Store.getState().localSegmentationStateByLayer[tracingId].idReservations.SegmentGroup;
      expect(reservations).toEqual([
        { id: 200, used: true },
        { id: 201, used: false },
        { id: 202, used: false },
        { id: 203, used: false },
        { id: 204, used: false },
      ]);
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
});

describe("ID reservation saga (exclusive collaboration mode)", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "Exclusive", true, false, "hybrid");
    vi.mocked(context.mocks.Request.sendJSONReceiveJSON).mockClear();
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("should assign new IDs", async () => {
    const { tracingId } = Store.getState().annotation.volumes[0];

    const task = startSaga(function* task() {
      // Set up a segment group with groupId 5 and 10
      Store.dispatch(
        setSegmentGroupsAction(
          [
            { name: "Existing Group", groupId: 5, children: [] },
            { name: "Existing Group", groupId: 10, children: [] },
          ],
          tracingId,
        ),
      );

      const id11 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      expect(id11).toBe(11);

      const id12 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      expect(id12).toBe(12);

      let reservations =
        Store.getState().localSegmentationStateByLayer[tracingId].idReservations.SegmentGroup;
      expect(reservations).toEqual([
        // 5 ids were put into the reservations. Two of them are already now.
        { id: 11, used: true },
        { id: 12, used: true },
        { id: 13, used: false },
        { id: 14, used: false },
        { id: 15, used: false },
      ]);

      const id13 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      expect(id13).toBe(13);

      reservations =
        Store.getState().localSegmentationStateByLayer[tracingId].idReservations.SegmentGroup;
      expect(reservations).toEqual([
        // 11 to 13 were cleaned up now and in total 5 unused ids are available again
        { id: 14, used: false },
        { id: 15, used: false },
        { id: 16, used: false },
        { id: 17, used: false },
        { id: 18, used: false },
      ]);

      const id14 = yield call(() =>
        dispatchGetNewIdAsync(Store.dispatch, tracingId, "SegmentGroup"),
      );
      expect(id14).toBe(14);
    });

    await task.toPromise();
  });
});
