import app from "app";
import showFpsMeter from "libs/fps_meter";
import { V3 } from "libs/mjs";
import { roundTo, sleep } from "libs/utils";
import _ from "lodash";
import { type OrthoView, OrthoViews, type Vector3 } from "viewer/constants";
import { Model, Store } from "viewer/singletons";
import type { ApiInterface } from "./api_latest";
import type ApiLoader from "./api_loader";

// Can be accessed via window.webknossos.DEV.flags. Only use this
// for debugging or one off scripts.
export const WkDevFlags = {
  logActions: false,
  sam: {
    useLocalMask: true,
  },
  bucketDebugging: {
    // For visualizing buckets which are passed to the GPU
    visualizeBucketsOnGPU: false,
    // For visualizing buckets which are prefetched
    visualizePrefetchedBuckets: false,
    // For enforcing fallback rendering. enforcedZoomDiff == 2, means
    // that buckets of currentZoomStep + 2 are rendered.
    enforcedZoomDiff: undefined,
    // This variable is only respected during shader compilation. Therefore,
    // it needs to be set to true before the rendering is initialized.
    disableLayerNameSanitization: false,
  },
  meshing: {
    marchingCubeSizeInTargetMag: [64, 64, 64] as Vector3,
  },
  datasetComposition: {
    allowThinPlateSplines: false,
  },
};

export default class WkDev {
  /*
   * This class is only exposed to simplify debugging via the command line.
   * It is not meant as an official API.
   * Can be accessed via window.webknossos.DEV
   */
  apiLoader: ApiLoader;
  _api!: ApiInterface;
  benchmarkHistory: { MOVE: number[]; ROTATE: number[]; SEGMENTS_SCROLL: number[] } = {
    MOVE: [],
    ROTATE: [],
    SEGMENTS_SCROLL: [],
  };

  flags = WkDevFlags;

  constructor(apiLoader: ApiLoader) {
    this.apiLoader = apiLoader;
    this.apiLoader.apiReady().then(async (api) => {
      this._api = api;
    });
  }

  public get store() {
    /* Access to the store */
    return Store;
  }

  public get model() {
    /* Access to the model */
    return Model;
  }

  public get api() {
    /* Access to the API (will fail if API is not initialized yet). */
    if (this._api == null) {
      throw new Error("Api is not ready yet");
    }
    return this._api;
  }

  async debuggerIn(delay: number = 2000) {
    /*
     * Hit a breakpoint in ${delay} seconds. Useful when inspecting
     * something in the DOM which is subject to change on mouse move.
     */
    await sleep(delay);
    // biome-ignore lint/suspicious/noDebugger: expected
    debugger;
  }

  showFpsMeter() {
    /*
     * Show a FPS meter with min/max/mean values.
     */
    showFpsMeter();
  }

  async createManySegments(
    min: Vector3 = [1066, 1070, 1536],
    extent: Vector3 = [1000, 1000, 10],
    maxSegmentCount: number = 2000,
  ) {
    /*
     * Find all segments in a bounding box and register them.
     * At maximum, ${maxSegmentCount} will be registered.
     */
    const api = this.api;
    const segmentationLayerName = api.data.getSegmentationLayerNames()[0];
    const max = V3.add(min, extent);
    const data = await api.data.getDataForBoundingBox(segmentationLayerName, {
      min,
      max,
    });

    const getMap = () => {
      const segmentIdToPosition = new Map();
      let idx = 0;
      for (let z = min[2]; z < max[2]; z++) {
        for (let y = min[1]; y < max[1]; y++) {
          for (let x = min[0]; x < max[0]; x++) {
            const id = data[idx];
            if (!segmentIdToPosition.has(id)) {
              segmentIdToPosition.set(id, [x, y, z]);
              if (segmentIdToPosition.size >= maxSegmentCount) {
                return segmentIdToPosition;
              }
            }
            idx++;
          }
        }
      }
      return segmentIdToPosition;
    };

    console.log("Gathering segments...");
    const segmentIdToPosition = getMap();

    console.log(`Registering ${segmentIdToPosition.size} segments...`);
    for (const [id, position] of segmentIdToPosition.entries()) {
      api.tracing.registerSegment(id, position, undefined, segmentationLayerName);
    }
    console.log(`Registered ${segmentIdToPosition.size} segments.`);
  }

  createManyTrees(treeCount: number = 2000) {
    const api = this.api;

    console.log("Creating", treeCount, "trees...");
    for (let i = 0; i < treeCount; i++) {
      api.tracing.createTree();
    }
    console.log("Created", treeCount, "trees.");
  }

  resetBenchmarks() {
    this.benchmarkHistory = { MOVE: [], ROTATE: [], SEGMENTS_SCROLL: [] };
  }

  async benchmarkMove(zRange: [number, number] = [1025, 1250], repeatAmount: number = 1) {
    /*
     * Benchmark moving in z from zRange[0] to zRange[1] ${repeatAmount} times.
     */
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "Note that this benchmark does not run in a production build. Results might not be meaningful.",
      );
    }

    const api = this.api;

    const zDepth = zRange[1] - zRange[0];
    const totalCount = repeatAmount * zDepth;

    const initialPos = api.tracing.getCameraPosition();
    api.tracing.centerPositionAnimated([initialPos[0], initialPos[1], zRange[0] - 1], false);
    await sleep(1500);

    const start = performance.now();
    console.time("Move Benchmark");
    let currentIteration = 0;
    for (let x = 0; x < repeatAmount; x++) {
      for (let z = 0; z < zDepth; z++) {
        if (currentIteration > 0 && currentIteration % Math.ceil(totalCount / 10) === 0) {
          console.log(
            "Progress:",
            roundTo((currentIteration / totalCount) * 100, 1),
            "% | Estimated total: ",
            roundTo(((performance.now() - start) / currentIteration) * totalCount, 0),
            "ms",
          );
        }

        await sleep(0);
        const currentPos = api.tracing.getCameraPosition();
        if (currentPos[0] !== initialPos[0] || currentPos[1] !== initialPos[1]) {
          console.log("Cancelling Benchmark due to external movement.");
          return;
        }
        api.tracing.centerPositionAnimated([currentPos[0], currentPos[1], zRange[0] + z], false);
        currentIteration++;
      }
    }
    const duration = performance.now() - start;
    console.timeEnd("Move Benchmark");
    this.benchmarkHistory.MOVE.push(duration);
    if (this.benchmarkHistory.MOVE.length > 1) {
      console.log(
        `Mean of all ${this.benchmarkHistory.MOVE.length} benchmark runs:`,
        _.mean(this.benchmarkHistory.MOVE),
      );
    }
  }

  async benchmarkRotate(n: number = 10) {
    // Dynamic import to avoid circular imports.
    const { rotate3DViewTo } = await import("viewer/controller/camera_controller");

    const animateAsPromise = (plane: OrthoView) => {
      return new Promise<void>((resolve) => {
        rotate3DViewTo(plane, false, resolve);
      });
    };

    const start = performance.now();
    console.time("Rotate Benchmark");

    for (let i = 0; i < n; i++) {
      app.vent.emit("forceImmediateRerender");
      await sleep(0);
      await animateAsPromise(OrthoViews.PLANE_XY);

      app.vent.emit("forceImmediateRerender");
      await sleep(0);
      await animateAsPromise(OrthoViews.PLANE_YZ);

      app.vent.emit("forceImmediateRerender");
      await sleep(0);
      await animateAsPromise(OrthoViews.PLANE_XZ);

      app.vent.emit("forceImmediateRerender");
      await sleep(0);
      await animateAsPromise(OrthoViews.TDView);
    }
    console.timeEnd("Rotate Benchmark");

    const duration = performance.now() - start;
    this.benchmarkHistory.ROTATE.push(duration);
    if (this.benchmarkHistory.ROTATE.length > 1) {
      console.log(
        `Mean of all ${this.benchmarkHistory.ROTATE.length} benchmark runs:`,
        _.mean(this.benchmarkHistory.ROTATE),
      );
    }
  }

  async benchmarkSegmentListScroll(n: number = 100) {
    const then = performance.now();
    console.time("Segment Scroll Benchmark");

    app.vent.emit("benchmark:segmentlist:scroll", n, () => {
      const duration = performance.now() - then;
      console.timeEnd("Segment Scroll Benchmark");

      this.benchmarkHistory.SEGMENTS_SCROLL.push(duration);
      if (this.benchmarkHistory.SEGMENTS_SCROLL.length > 1) {
        console.log(
          `Mean of all ${this.benchmarkHistory.SEGMENTS_SCROLL.length} benchmark runs:`,
          _.mean(this.benchmarkHistory.SEGMENTS_SCROLL),
        );
      }
    });
  }
}
