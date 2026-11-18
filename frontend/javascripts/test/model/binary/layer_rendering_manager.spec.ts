import { sleep } from "libs/utils";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import type { Vector3, Vector4 } from "viewer/constants";
import { assertNonNullBucket } from "viewer/model/bucket_data_handling/bucket";
import type DataCube from "viewer/model/bucket_data_handling/data_cube";
import type LayerRenderingManager from "viewer/model/bucket_data_handling/layer_rendering_manager";
import { Model } from "viewer/singletons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every call to the (mocked) bucket picker worker is recorded here, so that the test
// can decide when each pick finishes and which buckets it returns.
const { pendingPicks } = vi.hoisted(() => ({
  pendingPicks: [] as Array<(buffer: ArrayBuffer) => void>,
}));

vi.mock("viewer/workers/comlink_wrapper", async (importOriginal) => {
  const original = await importOriginal<typeof import("viewer/workers/comlink_wrapper")>();
  return {
    ...original,
    createWorker: (pathToWorker: string) => {
      if (pathToWorker !== "async_bucket_picker.worker.ts") {
        return original.createWorker(pathToWorker);
      }
      return () =>
        new Promise<ArrayBuffer>((resolve) => {
          pendingPicks.push(resolve);
        });
    },
  };
});

function createPickerBuffer(addresses: Vector4[]): ArrayBuffer {
  // Mirrors the format of the bucket picker worker: [x, y, z, zoomStep, priority] per bucket.
  const buffer = new Uint32Array(addresses.length * 5);
  addresses.forEach((address, index) => {
    buffer.set([...address, index], index * 5);
  });
  return buffer.buffer;
}

describe("LayerRenderingManager", () => {
  interface TestContext extends WebknossosTestContext {
    cube: DataCube;
    layerRenderingManager: LayerRenderingManager;
  }

  beforeEach<TestContext>(async (context) => {
    pendingPicks.length = 0;
    await setupWebknossosForTesting(context, "skeleton");

    const layer = Model.getLayerByName("color");
    const { layerRenderingManager } = layer;
    // Avoid setting up real textures (which would need a WebGL context).
    layerRenderingManager.textureBucketManager = {
      maximumCapacity: 100,
      setActiveBuckets: vi.fn(),
    } as any;

    context.cube = layer.cube;
    context.layerRenderingManager = layerRenderingManager;
  });

  afterEach<TestContext>((context) => {
    context.tearDownPullQueues();
  });

  it<TestContext>("should not keep buckets needed which were only picked by an outdated pick", async ({
    cube,
    layerRenderingManager,
  }) => {
    const onlyInFirstPickAddress: Vector4 = [0, 0, 0, 0];
    const inBothPicksAddress: Vector4 = [1, 0, 0, 0];
    const onlyInLastPickAddress: Vector4 = [2, 0, 0, 0];

    const updateView = (position: Vector3) => {
      // Force a new bucket-picker tick. The position differs for each call so that the
      // memoized bucket picker is invoked every time.
      layerRenderingManager.needsRefresh = true;
      layerRenderingManager.updateDataTextures(position, 0);
    };

    // The first pick starts running immediately.
    updateView([0, 0, 0]);
    // While it runs, the view changes twice. The LatestTaskExecutor queues the second pick
    // and discards it in favor of the third one.
    updateView([1, 0, 0]);
    updateView([2, 0, 0]);
    expect(pendingPicks.length).toBe(1);

    // The first pick finishes. Its result is still consumed even though the view has
    // changed since. Afterwards, the executor starts the third (latest) pick.
    const resolveFirstPick = pendingPicks[0];
    resolveFirstPick(createPickerBuffer([onlyInFirstPickAddress, inBothPicksAddress]));
    await sleep(0);
    expect(pendingPicks.length).toBe(2);

    // The latest pick finishes and no longer contains the first bucket.
    const resolveLatestPick = pendingPicks[1];
    resolveLatestPick(createPickerBuffer([inBothPicksAddress, onlyInLastPickAddress]));
    await sleep(0);

    const isNeeded = (address: Vector4) => {
      const bucket = cube.getOrCreateBucket([...address, []]);
      assertNonNullBucket(bucket);
      return bucket.isNeeded();
    };
    expect(isNeeded(inBothPicksAddress)).toBe(true);
    expect(isNeeded(onlyInLastPickAddress)).toBe(true);
    // The bucket was only picked by the outdated first pick, so it should no longer be
    // protected from garbage collection or be part of the rendered value set.
    expect(isNeeded(onlyInFirstPickAddress)).toBe(false);
  });
});
