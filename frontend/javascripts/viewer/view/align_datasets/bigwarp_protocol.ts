import { getUrlParamValue, hasUrlParam } from "libs/utils";
import type { APIDataset } from "types/api_types";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";

// The dataset alignment page (align_datasets_view.tsx) embeds two normal sandbox views of
// the same dataset as iframes, one per layer. These views are called "workers". A worker
// is recognized by the URL params below. This module holds everything that both the
// alignment page and the workers need to know about each other.

const WORKER_LAYER_URL_PARAM = "bigwarpWorker";
const PRIMARY_WORKER_URL_PARAM = "bigwarpPrimary";

export function isBigWarpWorker(): boolean {
  return hasUrlParam(WORKER_LAYER_URL_PARAM);
}

// The primary (left) worker hosts the alignment buttons and the link to the dashboard,
// because the alignment page itself has no navbar.
export function isBigWarpPrimaryWorker(): boolean {
  return isBigWarpWorker() && hasUrlParam(PRIMARY_WORKER_URL_PARAM);
}

// The layer whose landmarks are placed in this worker.
export function getBigWarpWorkerLayerName(): string {
  return getUrlParamValue(WORKER_LAYER_URL_PARAM);
}

export function getAlignmentPageUrl(dataset: { name: string; id: string }): string {
  return `/align-datasets/${getReadableURLPart(dataset)}`;
}

export function getBigWarpWorkerUrl(
  dataset: APIDataset,
  layerName: string,
  isPrimary: boolean,
): string {
  const params = new URLSearchParams({ [WORKER_LAYER_URL_PARAM]: layerName });
  if (isPrimary) {
    params.set(PRIMARY_WORKER_URL_PARAM, "true");
  }
  return `/datasets/${getReadableURLPart(dataset)}/sandbox/skeleton?${params}`;
}

// Actions that a worker asks the alignment page to perform. "toggleOtherLayer" and
// "syncOtherView" refer to the worker that sent the command.
export type BigWarpCommand =
  | "align"
  | "forceSave"
  | "toggleLandmarkPanel"
  | "toggleOtherLayer"
  | "syncOtherView";

export const BIG_WARP_COMMAND_MESSAGE_TYPE = "bigwarpCommand";

export function sendCommandToAlignmentPage(command: BigWarpCommand) {
  window.parent.postMessage({ type: BIG_WARP_COMMAND_MESSAGE_TYPE, command }, "*");
}
