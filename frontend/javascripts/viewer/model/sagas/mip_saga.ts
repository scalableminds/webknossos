import type { Task } from "redux-saga";
import { buffers, type Channel, channel } from "redux-saga";
import { cancel, cancelled, fork, put, take, takeEvery } from "typed-redux-saga";
import getSceneController from "viewer/controller/scene_controller_provider";
import { resolveMipLayerSource } from "viewer/geometries/mip_volume";
import {
  type LoadMipAction,
  type RemoveMipForBBoxAction,
  type RemoveMipLayerForBBoxAction,
  setMipForBBoxAction,
} from "viewer/model/actions/annotation_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { call, select } from "viewer/model/sagas/effect_generators";
import { api } from "viewer/singletons";
import type { MipLayerConfig, UserBoundingBox } from "viewer/store";
import { ensureSceneControllerInitialized } from "./ready_sagas";
import BoundingBox from "../bucket_data_handling/bounding_box";
import { getLayerByName } from "../accessors/dataset_accessor";

// Maximum number of MIP layer downloads that run concurrently.
// Queued requests wait for a slot before starting their HTTP fetch.
const DOWNLOAD_CONCURRENCY = 4;

function* runMipDownload(
  workerFlagChannel: Channel<true>,
  bboxId: number,
  bbox: UserBoundingBox,
  config: MipLayerConfig,
): Saga<void> {
  let acquiredWorkerFlag = false;
  const abortController = new AbortController();
  try {
    // Acquire a worker flag; blocks until a slot in the download pool is free
    yield* take(workerFlagChannel);
    acquiredWorkerFlag = true;

    yield* put(setMipForBBoxAction(bboxId, { ...config, isLoading: true }));
    const dataset = yield* select((state) => state.dataset);

    const mag1BBox = new BoundingBox(bbox.boundingBox);
    const mag1BBoxClampedToLayerBounds = BoundingBox.fromBoundBoxObject(
      getLayerByName(dataset, config.layerName).boundingBox,
    )
      .intersectedWith(mag1BBox)
      .toBoundingBoxMinMaxType();
    const { actualZoomStep, textureDims, elementClass } = resolveMipLayerSource(
      dataset,
      config.layerName,
      mag1BBoxClampedToLayerBounds,
      config.zoomStep,
    );

    const rawDataTyped = yield* call(
      [api.data, api.data.getDataForBoundingBox],
      config.layerName,
      mag1BBoxClampedToLayerBounds,
      actualZoomStep,
      null,
      abortController.signal,
    );
    // getDataForBoundingBox returns TypedArray (which includes BigInt64Array) but MIP only
    // supports the four element classes checked by assertSupportedElementClass
    const rawData = rawDataTyped as Uint8Array | Uint16Array | Uint32Array | Float32Array;

    const entry = getSceneController().getMipVolumeEntry(bboxId);
    if (entry != null) {
      entry.volume.setLayerData(config.layerName, rawData, textureDims, elementClass);
    }

    yield* put(setMipForBBoxAction(bboxId, { ...config, isLoading: false }));
  } catch (err: unknown) {
    if (!(yield* cancelled())) {
      console.error(`MIP: failed to load layer "${config.layerName}" for bbox ${bboxId}:`, err);
      yield* put(setMipForBBoxAction(bboxId, { ...config, isLoading: false }));
    }
  } finally {
    if (yield* cancelled()) {
      abortController.abort();
    }
    if (acquiredWorkerFlag) {
      // Release the worker flag so the next queued download can start
      workerFlagChannel.put(true);
    }
  }
}

function taskKey(bboxId: number, layerName: string): string {
  return `${bboxId}:${layerName}`;
}

export default function* mipSaga(): Saga<void> {
  yield* ensureSceneControllerInitialized();

  // workerFlagChannel acts as a counting semaphore: DOWNLOAD_CONCURRENCY flags available.
  // A download task takes one flag before fetching and releases it when done or cancelled.
  const workerFlagChannel = channel<true>(buffers.fixed(DOWNLOAD_CONCURRENCY));
  for (let i = 0; i < DOWNLOAD_CONCURRENCY; i++) {
    workerFlagChannel.put(true);
  }

  // Maps taskKey → forked saga task, so we can cancel in-flight downloads on demand.
  const activeTasks = new Map<string, Task>();

  // New layer scheduled for download: cancel any prior task for the same (bbox, layer) pair,
  // then fork a fresh download. This handles the case where bbox bounds changed, which causes
  // scene_controller to recreate the volume and re-dispatch LOAD_MIP for all layers.
  yield* takeEvery("LOAD_MIP", function* (action: LoadMipAction) {
    const key = taskKey(action.bboxId, action.config.layerName);
    const existing = activeTasks.get(key);
    if (existing != null) {
      yield* cancel(existing);
      activeTasks.delete(key);
    }
    const task = yield* fork(
      runMipDownload,
      workerFlagChannel,
      action.bboxId,
      action.bbox,
      action.config,
    );
    activeTasks.set(key, task);
  });

  // Single layer removed from a bbox: cancel its download if in flight
  yield* takeEvery("REMOVE_MIP_LAYER_FOR_BBOX", function* (action: RemoveMipLayerForBBoxAction) {
    const key = taskKey(action.id, action.layerName);
    const existing = activeTasks.get(key);
    if (existing != null) {
      yield* cancel(existing);
      activeTasks.delete(key);
    }
  });

  // All layers removed from a bbox: cancel every in-flight download for it
  yield* takeEvery("REMOVE_MIP_FOR_BBOX", function* (action: RemoveMipForBBoxAction) {
    yield* cancelAllForBbox(action.id, activeTasks);
  });

  // Bbox deleted: cancel every in-flight download for it
  yield* takeEvery("DELETE_USER_BOUNDING_BOX", function* (action: { type: string; id: number }) {
    yield* cancelAllForBbox(action.id, activeTasks);
  });
}

function* cancelAllForBbox(bboxId: number, activeTasks: Map<string, Task>): Saga<void> {
  const prefix = `${bboxId}:`;
  const keysToCancel = [...activeTasks.keys()].filter((k) => k.startsWith(prefix));
  const tasksToCancel = keysToCancel.map((k) => activeTasks.get(k)!);
  if (tasksToCancel.length > 0) {
    yield* cancel(tasksToCancel);
    for (const key of keysToCancel) activeTasks.delete(key);
  }
}
