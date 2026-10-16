import app from "app";
import showFpsMeter from "libs/fps_meter";
import { V3 } from "libs/mjs";
import { roundTo, sleep } from "libs/utils";
import mean from "lodash-es/mean";
import { type OrthographicCamera, type PerspectiveCamera, WebGLRenderTarget } from "three";
import { type OrthoView, OrthoViews, type Vector3 } from "viewer/constants";
import { Model, Store } from "viewer/singletons";
import type { ApiInterface } from "./api_latest";
import type ApiLoader from "./api_loader";

/**
 * The benchmarks' dependencies, loaded on first use.
 *
 * This module is reachable from `api_latest.ts`, which most of those
 * dependencies import in turn, so importing them statically would close a
 * cycle. They are collected in one module (`wk_dev_benchmark_deps.ts`) so this
 * is the only dynamic import in the file.
 *
 * A bare `import()` rather than `importDynamic()`: wrapping it would pull the
 * cycle back in, and for a dev-only benchmark a failed import is an acceptable
 * outcome. Whitelisted in `tools/check-no-bare-dynamic-imports.js`.
 */
function loadBenchmarkDeps() {
  return import("./wk_dev_benchmark_deps");
}

// Can be accessed via window.webknossos.DEV.flags. Only use this
// for debugging or one off scripts.
export const WkDevFlags = {
  logActions: false,
  logFullActionObjects: false,
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
  debugging: {
    showCurrentVersionInInfoTab: false,
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
  benchmarkHistory: {
    MOVE: number[];
    ROTATE: number[];
    SEGMENTS_SCROLL: number[];
    RENDER: number[];
  } = {
    MOVE: [],
    ROTATE: [],
    SEGMENTS_SCROLL: [],
    RENDER: [],
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

  createManyTrees(
    treeCount: number = 2000,
    withNodes: boolean = false,
    withComments: boolean = false,
    nodesPerTree: number = 10,
  ) {
    const api = this.api;

    console.log("Creating", treeCount, "trees...");
    for (let i = 0; i < treeCount; i++) {
      const treeId = api.tracing.createTree();
      if (!withNodes) {
        continue;
      }
      for (let n = 0; n < nodesPerTree; n++) {
        api.tracing.createNode([n, n, n]);
        if (!withComments) {
          continue;
        }
        const nodeId = api.tracing.getActiveNodeId();
        if (nodeId != null) {
          api.tracing.setCommentForNode(`Comment ${n}`, nodeId, treeId);
        }
      }
    }
    console.log("Created", treeCount, "trees.");
  }

  resetBenchmarks() {
    this.benchmarkHistory = { MOVE: [], ROTATE: [], SEGMENTS_SCROLL: [], RENDER: [] };
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
        mean(this.benchmarkHistory.MOVE),
      );
    }
  }

  async benchmarkBrush(repeatAmount: number = 1) {
    /*
     * Benchmark brushing a stroke from the top-left to the bottom-right corner
     * of the XY viewport, repeated ${repeatAmount} times. Preparation — creating
     * a new segment id, setting the brush size to 300 and the overwrite mode to
     * "OVERWRITE_ALL" — happens once beforehand and is not measured.
     */
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "Note that this benchmark does not run in a production build. Results might not be meaningful.",
      );
    }

    const {
      createCellAction,
      getActiveSegmentationTracing,
      getInputCatcherRect,
      handleDrawStart,
      handleEndForDrawOrErase,
      handleMoveForDrawOrErase,
      setViewportAction,
      updateUserSettingAction,
    } = await loadBenchmarkDeps();

    const api = this.api;

    // --- Preparation. Not measured. ---
    const volumeTracing = getActiveSegmentationTracing(Store.getState());
    if (volumeTracing == null) {
      console.error("No active volume tracing found. Aborting benchmark.");
      return;
    }
    if (volumeTracing.largestSegmentId == null) {
      console.error("largestSegmentId is not known yet. Aborting benchmark.");
      return;
    }

    api.tracing.setAnnotationTool("BRUSH");
    Store.dispatch(setViewportAction(OrthoViews.PLANE_XY));
    Store.dispatch(createCellAction(volumeTracing.activeCellId, volumeTracing.largestSegmentId));
    Store.dispatch(updateUserSettingAction("brushSize", 300));
    Store.dispatch(updateUserSettingAction("overwriteMode", "OVERWRITE_ALL"));
    await sleep(0);

    const { width, height } = getInputCatcherRect(Store.getState(), OrthoViews.PLANE_XY);
    const topLeft = { x: 0, y: 0 };
    const bottomRight = { x: width, y: height };

    // --- Actual painting. Measured. ---
    const durations: number[] = [];
    console.time("Brush Benchmark");
    for (let i = 0; i < repeatAmount; i++) {
      const start = performance.now();
      handleDrawStart(topLeft, OrthoViews.PLANE_XY);
      handleMoveForDrawOrErase(bottomRight);
      handleEndForDrawOrErase();
      await sleep(0);
      durations.push(performance.now() - start);
    }
    console.timeEnd("Brush Benchmark");

    console.log("Brush benchmark durations (ms):", durations);
    if (durations.length > 1) {
      console.log("Mean:", mean(durations));
    }
  }

  async benchmarkRotate(n: number = 10) {
    const { rotate3DViewTo } = await loadBenchmarkDeps();

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
        mean(this.benchmarkHistory.ROTATE),
      );
    }
  }

  waitForCompletedDataLoading(
    timeout: number | null = null,
    debounceMs: number = 500,
  ): Promise<void> {
    /*
     * Returns a promise that resolves once all pull queues across all layers
     * are empty and stay empty for debounceMs milliseconds. For example, useful in
     * screenshot tests to wait for data loading to truly finish.
     * If no data is being fetched when this method is called and when no data
     * is starting to be fetched within debounceMs, the returned promise will
     * resolve immediately after debounceMs has passed.
     * Therefore, you may want to call an additional sleep prior to calling this method,
     * if you want to minimize the risk that data loading hasn't started yet.
     */
    const areQueuesEmpty = () => Model.getAllLayers().every((layer) => layer.pullQueue.isEmpty());
    return new Promise((resolve, reject) => {
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      if (timeout != null) {
        timeoutTimer = setTimeout(() => {
          if (debounceTimer != null) clearTimeout(debounceTimer);
          unsubscribe();
          reject(new Error("Waiting for completed data loading timed out."));
        }, timeout);
      }

      const checkAndSettle = () => {
        if (!areQueuesEmpty()) {
          // Ignore event.
          return;
        }
        if (debounceTimer != null) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          // Re-check whether new requests have started during the debounce window.
          // If so, a new pullqueue:empty event will arrive, so we don't need to
          // do anything else here.
          if (areQueuesEmpty()) {
            unsubscribe();
            if (timeoutTimer != null) clearTimeout(timeoutTimer);
            resolve();
          }
        }, debounceMs);
      };

      const unsubscribe = app.vent.on("pullqueue:empty", checkAndSettle);
      // Check immediately in case all queues are already empty at call time.
      checkAndSettle();
    });
  }

  async benchmarkRender(frameCount: number = 300, plane: OrthoView = OrthoViews.PLANE_XY) {
    /*
     * Measures how long one frame of the given plane takes to render. First waits
     * until all data is loaded and uploaded, then renders the same frame
     * frameCount times into an offscreen target, so loading and vsync don't
     * affect the result. Uses GPU timer queries if available; otherwise
     * gl.finish() + performance.now(), which also includes CPU time.
     * For comparisons, keep dataset, position, zoom, layer settings and window
     * size identical, and compare medians over several runs.
     */
    // Dynamic imports to avoid circular imports (see benchmarkRotate).
    const { default: getSceneController } = await import(
      "viewer/controller/scene_controller_provider"
    );
    const { getInputCatcherRect } = await import("viewer/model/accessors/view_mode_accessor");

    await this.waitForCompletedDataLoading();
    const areUploadsDone = () =>
      Model.getAllLayers().every(
        (layer) =>
          (layer.layerRenderingManager.textureBucketManager?.writerQueue.length ?? 0) === 0,
      );
    while (!areUploadsDone()) {
      await sleep(50);
    }

    const sceneController = getSceneController();
    const { renderer, scene } = sceneController;
    const camera = scene.getObjectByName(plane) as OrthographicCamera | PerspectiveCamera;
    const rect = getInputCatcherRect(Store.getState(), plane);
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    const renderTarget = new WebGLRenderTarget(width, height);
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const timerExtension = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    if (timerExtension == null) {
      console.warn(
        "EXT_disjoint_timer_query_webgl2 is not available. Using gl.finish() instead, which also measures CPU time.",
      );
    }

    sceneController.updateSceneForCam(plane);
    renderer.setRenderTarget(renderTarget);
    const render = () => renderer.render(scene, camera);
    // Warm up, so that shader compilation and pending uploads aren't measured.
    for (let i = 0; i < 10; i++) {
      render();
    }
    gl.finish();

    const queries: WebGLQuery[] = [];
    const cpuDurations: number[] = [];
    if (timerExtension != null) {
      // Reading the flag resets it, so that only disjoint events during the
      // measurement are detected below.
      gl.getParameter(timerExtension.GPU_DISJOINT_EXT);
    }
    for (let i = 0; i < frameCount; i++) {
      const start = performance.now();
      if (timerExtension != null) {
        const query = gl.createQuery();
        gl.beginQuery(timerExtension.TIME_ELAPSED_EXT, query);
        render();
        gl.endQuery(timerExtension.TIME_ELAPSED_EXT);
        queries.push(query);
      } else {
        render();
        gl.finish();
      }
      cpuDurations.push(performance.now() - start);
    }
    renderer.setRenderTarget(null);
    renderTarget.dispose();
    app.vent.emit("forceImmediateRerender");

    let gpuDurations: number[] | null = null;
    if (timerExtension != null) {
      // Query results only become available after returning to the event loop.
      while (!queries.every((query) => gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))) {
        await sleep(10);
      }
      const wasDisjoint = gl.getParameter(timerExtension.GPU_DISJOINT_EXT);
      gpuDurations = queries.map((query) => gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      for (const query of queries) {
        gl.deleteQuery(query);
      }
      if (wasDisjoint) {
        console.warn("The GPU timings are invalid (GPU_DISJOINT_EXT). Please run again.");
        gpuDurations = null;
      }
    }

    const summarize = (durations: number[]) => {
      const sorted = [...durations].sort((a, b) => a - b);
      const atPercentile = (p: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
      return {
        median: roundTo(atPercentile(0.5), 3),
        p90: roundTo(atPercentile(0.9), 3),
        min: roundTo(sorted[0], 3),
        mean: roundTo(mean(durations), 3),
      };
    };
    console.log(
      `Render Benchmark: ${plane}, ${width}x${height}, ${frameCount} frames, ms per frame`,
    );
    console.table({
      ...(gpuDurations != null ? { GPU: summarize(gpuDurations) } : {}),
      [timerExtension != null ? "CPU (submit only)" : "CPU + GPU (gl.finish)"]:
        summarize(cpuDurations),
    });

    this.benchmarkHistory.RENDER.push(summarize(gpuDurations ?? cpuDurations).median);
    if (this.benchmarkHistory.RENDER.length > 1) {
      const sortedMedians = [...this.benchmarkHistory.RENDER].sort((a, b) => a - b);
      console.log(
        `Median of the medians of all ${sortedMedians.length} runs:`,
        sortedMedians[Math.floor(sortedMedians.length / 2)],
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
          mean(this.benchmarkHistory.SEGMENTS_SCROLL),
        );
      }
    });
  }
}
