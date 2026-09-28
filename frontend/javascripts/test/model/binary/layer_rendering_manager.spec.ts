import { M4x4 } from "libs/mjs";
import { sleep } from "libs/utils";
import datasetServerObject from "test/fixtures/dataset_server_object";
import { tracing as skeletontracingServerObject } from "test/fixtures/skeletontracing_server_objects";
import type { Vector3, Vector4 } from "viewer/constants";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import DataCube from "viewer/model/bucket_data_handling/data_cube";
import LayerRenderingManager from "viewer/model/bucket_data_handling/layer_rendering_manager";
import { MagInfo } from "viewer/model/helpers/mag_info";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mags: Vector3[] = [
  [1, 1, 1],
  [2, 2, 2],
  [4, 4, 4],
];

// Every call to the (mocked) bucket picker worker is recorded here, so that the test
// can decide when each pick finishes and which buckets it returns.
const { pendingPicks } = vi.hoisted(() => ({
  pendingPicks: [] as Array<(buffer: ArrayBuffer) => void>,
}));

vi.mock("viewer/workers/comlink_wrapper", () => ({
  createWorker: () => () =>
    new Promise<ArrayBuffer>((resolve) => {
      pendingPicks.push(resolve);
    }),
}));

vi.mock("viewer/store", () => ({
  default: {
    getState: () => ({
      dataset: datasetServerObject,
      annotation: {
        skeleton: skeletontracingServerObject,
      },
      task: null,
      datasetConfiguration: {
        fourBit: false,
        loadingStrategy: "BEST_QUALITY_FIRST",
        nativelyRenderedLayerName: null,
      },
      temporaryConfiguration: {
        viewMode: "orthogonal",
        activeMappingByLayer: {},
      },
      userConfiguration: {
        sphericalCapRadius: 100,
      },
      flycam: {
        zoomStep: 1,
        currentMatrix: M4x4.identity(),
        additionalCoordinates: null,
      },
      flycamInfoCache: {
        maximumZoomForAllMags: { layerName: [1, 2, 4] },
      },
    }),
    dispatch: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock("viewer/model/accessors/dataset_accessor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viewer/model/accessors/dataset_accessor")>()),
  getLayerByName: () => ({ name: "layerName", mags: mags.map((mag) => ({ mag })) }),
  getMagInfo: () => new MagInfo(mags),
  isLayerVisible: () => true,
}));

vi.mock("viewer/model/accessors/dataset_layer_transformation_accessor", () => ({
  getTransformsForLayer: () => ({ affineMatrix: M4x4.identity() }),
  invertAndTranspose: (matrix: unknown) => matrix,
}));

vi.mock("viewer/model/accessors/view_mode_accessor", () => ({
  getViewportRects: () => ({}),
}));

vi.mock("viewer/model/sagas/root_saga", () => ({
  default: function* () {
    yield;
  },
}));

vi.mock("app", () => ({ default: { vent: { emit: vi.fn() } } }));

function createPickerBuffer(addresses: Vector4[]): ArrayBuffer {
  // Mirrors the format of the bucket picker worker: [x, y, z, zoomStep, priority] per bucket.
  const buffer = new Uint32Array(addresses.length * 5);
  addresses.forEach((address, index) => {
    buffer.set([...address, index], index * 5);
  });
  return buffer.buffer;
}

describe("LayerRenderingManager", () => {
  interface TestContext {
    cube: DataCube;
    layerRenderingManager: LayerRenderingManager;
  }

  beforeEach<TestContext>((context) => {
    pendingPicks.length = 0;
    const cube = new DataCube(
      new BoundingBox({ min: [0, 0, 0], max: [100, 100, 100] }),
      [],
      new MagInfo(mags),
      "uint32",
      false,
      "layerName",
    );
    const pullQueue = { clear: vi.fn(), addAll: vi.fn(), pull: vi.fn() };
    cube.initializeWithQueues(pullQueue as any, { insert: vi.fn(), push: vi.fn() } as any);

    const layerRenderingManager = new LayerRenderingManager(
      "layerName",
      pullQueue as any,
      cube,
      512,
      1,
    );
    // Avoid setting up real textures (which would need a WebGL context).
    layerRenderingManager.textureBucketManager = {
      maximumCapacity: 100,
      setActiveBuckets: vi.fn(),
    } as any;

    context.cube = cube;
    context.layerRenderingManager = layerRenderingManager;
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
    pendingPicks[0](createPickerBuffer([onlyInFirstPickAddress, inBothPicksAddress]));
    await sleep(0);
    expect(pendingPicks.length).toBe(2);

    // The latest pick finishes and no longer contains the first bucket.
    pendingPicks[1](createPickerBuffer([inBothPicksAddress, onlyInLastPickAddress]));
    await sleep(0);

    const isNeeded = (address: Vector4) => cube.getOrCreateBucket([...address, []]).isNeeded();
    expect(isNeeded(inBothPicksAddress)).toBe(true);
    expect(isNeeded(onlyInLastPickAddress)).toBe(true);
    // The bucket was only picked by the outdated first pick, so it should no longer be
    // protected from garbage collection or be part of the rendered value set.
    expect(isNeeded(onlyInFirstPickAddress)).toBe(false);
  });
});
