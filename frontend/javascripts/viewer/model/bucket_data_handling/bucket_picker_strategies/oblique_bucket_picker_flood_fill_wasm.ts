import type { Matrix4x4 } from "libs/mjs";
import type { Vector3 } from "viewer/constants";
import type { EnqueueFunction } from "viewer/model/bucket_data_handling/layer_rendering_manager";
import {
  getBucketExtent,
  globalPositionToBucketPosition,
} from "viewer/model/helpers/position_converter";
import type { LoadingStrategy, PlaneRects } from "viewer/store";
import { getPriorityWeightForZoomStepDiff, MAX_ZOOM_STEP_DIFF } from "../loading_strategy_logic";
import type { ScanLineCallback } from "./oblique_bucket_picker";

// This module is a WASM(SIMD) port of oblique_bucket_picker_flood_fill.ts: the same
// single-flood-fill-across-all-3-planes algorithm (6-connectivity, exact SAT-style
// box-vs-plane intersection test), ported to C
// (see wasm/oblique_bucket_picker_flood_fill/oblique_bucket_picker_flood_fill.c and build.sh).
// The outer zoomStepDiff loop and all JS-side glue stay here; only the hot inner loop (BFS +
// intersection tests + dedup + priority) runs in WASM.
//
// The scan-line debug visualization (onScanLine) isn't implemented for this strategy.
//
// See oblique_bucket_picker_wasm.ts's module comment for why this function is async and why
// it uses a dynamic `import("node:fs")` (whitelisted in tools/check-no-bare-dynamic-imports.js)
// rather than a static one.

const isNodeContext =
  typeof process !== "undefined" && process.versions != null && process.versions.node != null;

const wasmUrl = new URL(
  "../../../../../assets/wasm/oblique_bucket_picker_flood_fill.wasm",
  import.meta.url,
);

type WasmExports = {
  memory: WebAssembly.Memory;
  get_matrix_ptr: () => number;
  get_rect_width_ptr: () => number;
  get_rect_height_ptr: () => number;
  get_voxel_size_ptr: () => number;
  set_scalars: (
    centerX: number,
    centerY: number,
    centerZ: number,
    additionalPriorityWeight: number,
    logZoomStep: number,
    abortLimit: number,
  ) => void;
  get_output_ptr: () => number;
  pick_buckets_for_plane: () => number;
};

let wasmExportsPromise: Promise<WasmExports> | null = null;

async function loadInNode(): Promise<WasmExports> {
  const [{ readFileSync }, { fileURLToPath }] = await Promise.all([
    import("node:fs"),
    import("node:url"),
  ]);
  const bytes = readFileSync(fileURLToPath(wasmUrl));
  const module = new WebAssembly.Module(bytes);
  const instance = new WebAssembly.Instance(module, {});
  return instance.exports as unknown as WasmExports;
}

async function loadInBrowser(): Promise<WasmExports> {
  const response = await fetch(wasmUrl);
  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports as unknown as WasmExports;
}

function getWasmExports(): Promise<WasmExports> {
  if (wasmExportsPromise == null) {
    wasmExportsPromise = isNodeContext ? loadInNode() : loadInBrowser();
  }
  return wasmExportsPromise;
}

export default async function determineBucketsForPlane(
  loadingStrategy: LoadingStrategy,
  denseMags: Array<Vector3>,
  position: Vector3,
  enqueueFunction: EnqueueFunction,
  matrix: Matrix4x4,
  logZoomStep: number,
  rects: PlaneRects,
  abortLimit?: number,
  _onScanLine?: ScanLineCallback,
): Promise<void> {
  const wasm = await getWasmExports();

  const f64 = () => new Float64Array(wasm.memory.buffer);
  const i32 = () => new Int32Array(wasm.memory.buffer);

  f64().set(matrix, wasm.get_matrix_ptr() / 8);
  f64().set(
    [rects.PLANE_XY.width, rects.PLANE_XZ.width, rects.PLANE_YZ.width],
    wasm.get_rect_width_ptr() / 8,
  );
  f64().set(
    [rects.PLANE_XY.height, rects.PLANE_XZ.height, rects.PLANE_YZ.height],
    wasm.get_rect_height_ptr() / 8,
  );

  let zoomStepDiff = 0;

  while (logZoomStep + zoomStepDiff < denseMags.length && zoomStepDiff <= MAX_ZOOM_STEP_DIFF) {
    const thisLogZoomStep = logZoomStep + zoomStepDiff;
    // null is passed as additionalCoordinates, since the bucket picker doesn't care about the
    // additional coordinates. It simply sticks to 3D and the caller is responsible for
    // augmenting potential other coordinates.
    const centerAddress = globalPositionToBucketPosition(
      position,
      denseMags,
      thisLogZoomStep,
      null,
    );
    const voxelSize = getBucketExtent(denseMags[thisLogZoomStep]);
    f64().set(voxelSize, wasm.get_voxel_size_ptr() / 8);

    const additionalPriorityWeight = getPriorityWeightForZoomStepDiff(
      loadingStrategy,
      zoomStepDiff,
    );
    wasm.set_scalars(
      centerAddress[0],
      centerAddress[1],
      centerAddress[2],
      additionalPriorityWeight,
      thisLogZoomStep,
      abortLimit ?? -1,
    );

    const outputCount = wasm.pick_buckets_for_plane();

    const output = i32();
    const base = wasm.get_output_ptr() / 4;
    for (let i = 0; i < outputCount; i++) {
      const o = base + i * 5;
      enqueueFunction([output[o], output[o + 1], output[o + 2], output[o + 3]], output[o + 4]);
    }

    zoomStepDiff++;
  }
}
