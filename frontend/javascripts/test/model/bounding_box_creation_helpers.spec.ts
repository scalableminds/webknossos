import { sleep } from "libs/utils";
import { reserveIdAndAddBoundingBox } from "viewer/model/helpers/bounding_box_creation_helpers";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isRebasing: false,
  reservedId: 42,
  // Captures the onChange callbacks registered via listenToStoreProperty so the test can simulate
  // the rebase finishing by invoking them.
  storePropertyListeners: [] as Array<(isRebasingOrForwarding: boolean) => void>,
}));

vi.mock("viewer/singletons", () => ({
  Store: {
    getState: () => ({
      save: { rebaseRelevantServerAnnotationState: { isRebasingOrForwarding: mocks.isRebasing } },
    }),
  },
}));

vi.mock("viewer/model/actions/actions", () => ({
  dispatchGetNewIdAsync: vi.fn(async () => mocks.reservedId),
}));

vi.mock("viewer/model/helpers/listener_helpers", () => ({
  listenToStoreProperty: (
    _select: unknown,
    onChange: (isRebasingOrForwarding: boolean) => void,
  ) => {
    mocks.storePropertyListeners.push(onChange);
    return () => {
      const index = mocks.storePropertyListeners.indexOf(onChange);
      if (index >= 0) mocks.storePropertyListeners.splice(index, 1);
    };
  },
}));

// Simulates the rebase/forwarding finishing by flipping the flag and notifying subscribers.
function finishRebase() {
  mocks.isRebasing = false;
  for (const onChange of [...mocks.storePropertyListeners]) {
    onChange(false);
  }
}

describe("reserveIdAndAddBoundingBox", () => {
  beforeEach(() => {
    mocks.isRebasing = false;
    mocks.storePropertyListeners.length = 0;
  });

  it("reserves an id and dispatches the add when no rebase is active", async () => {
    const dispatch = vi.fn();

    await reserveIdAndAddBoundingBox(dispatch, "tracing-id");

    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0][0];
    expect(action.type).toBe("ADD_NEW_USER_BOUNDING_BOX");
    expect(action.id).toBe(42);
    // No store subscription is needed when nothing is rebasing.
    expect(mocks.storePropertyListeners).toHaveLength(0);
  });

  it("defers the add until the rebase/forwarding finishes", async () => {
    mocks.isRebasing = true;
    const dispatch = vi.fn();

    const promise = reserveIdAndAddBoundingBox(dispatch, "tracing-id");

    // The (mocked) id reservation resolves quickly, but the add must not be dispatched while a
    // rebase is still active. Instead, the helper subscribes to the store.
    await sleep(5);
    expect(dispatch).not.toHaveBeenCalled();
    expect(mocks.storePropertyListeners).toHaveLength(1);

    // Finishing the rebase releases the deferred add and unsubscribes.
    finishRebase();
    await promise;

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].id).toBe(42);
    expect(mocks.storePropertyListeners).toHaveLength(0);
  });
});
