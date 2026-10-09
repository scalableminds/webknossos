import { getUrlParamValue, hasUrlParam } from "libs/utils";
import type { APIDataset } from "types/api_types";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";

// The alignment view (alignment_view.tsx) embeds two normal sandbox views of the same
// dataset as iframes, one per layer. These views are called "workers". A third, hidden
// iframe loads the alignment annotation itself, which stores the landmarks ("store"). The
// iframes are recognized by the URL params below. This module holds everything that the
// alignment view, the iframes and the rest of the app need to know about each other.

const WORKER_LAYER_URL_PARAM = "bigwarpWorker";
const PRIMARY_WORKER_URL_PARAM = "bigwarpPrimary";
const STORE_URL_PARAM = "bigwarpStore";

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

export function isBigWarpStore(): boolean {
  return hasUrlParam(STORE_URL_PARAM);
}

// The page that lists the alignment annotations of a dataset and creates new ones.
export function getAlignmentSelectionUrl(dataset: { name: string; id: string }): string {
  return `/datasets/${getReadableURLPart(dataset)}/align`;
}

export function getAlignmentViewUrl(
  dataset: { name: string; id: string },
  annotationId: string,
): string {
  return `${getAlignmentSelectionUrl(dataset)}/${annotationId}`;
}

// The store iframe must open the alignment annotation in the normal viewer instead of being
// redirected to the alignment view again.
export function getBigWarpStoreUrl(annotationId: string): string {
  return `/annotations/${annotationId}?${STORE_URL_PARAM}`;
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
  window.parent.postMessage(
    { type: BIG_WARP_COMMAND_MESSAGE_TYPE, command },
    window.location.origin,
  );
}

// Sent by the store iframe whenever the alignment annotation gets saved or gets unsaved
// changes.
export const BIG_WARP_STORE_SAVED_STATE_MESSAGE_TYPE = "bigwarpStoreSavedState";
