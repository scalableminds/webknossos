import { getUrlParamValue, hasUrlParam } from "libs/utils";
import type { APIDataset } from "types/api_types";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";

// The layer registration view (layer_registration_view.tsx) embeds two normal sandbox views of the
// same dataset as iframes, one per layer. These views are called "workers". A third, hidden iframe
// loads the layer registration annotation itself, which stores the landmarks ("store"). The iframes
// are recognized by the URL params below. This module holds everything that the layer registration
// view, the iframes and the rest of the app need to know about each other.

// The URL params of each iframe:
// - left worker (fixed layer): layerRegistrationWorker=<fixed layer name>&layerRegistrationPrimary=true
// - right worker (moving layer): layerRegistrationWorker=<moving layer name>
// - store: layerRegistrationStore (without a value)
const WORKER_LAYER_URL_PARAM = "layerRegistrationWorker";
const PRIMARY_WORKER_URL_PARAM = "layerRegistrationPrimary";
const STORE_URL_PARAM = "layerRegistrationStore";

export function isLayerRegistrationWorker(): boolean {
  return hasUrlParam(WORKER_LAYER_URL_PARAM);
}

// The primary (left) worker hosts the layer registration buttons and the link to the dashboard,
// because the layer registration page itself has no navbar.
export function isLayerRegistrationPrimaryWorker(): boolean {
  return isLayerRegistrationWorker() && hasUrlParam(PRIMARY_WORKER_URL_PARAM);
}

// The layer whose landmarks are placed in this worker.
export function getLayerRegistrationWorkerLayerName(): string {
  return getUrlParamValue(WORKER_LAYER_URL_PARAM);
}

export function isLayerRegistrationStore(): boolean {
  return hasUrlParam(STORE_URL_PARAM);
}

// The page that lists the layer registration annotations of a dataset and creates new ones.
export function getLayerRegistrationListUrl(dataset: { name: string; id: string }): string {
  return `/datasets/${getReadableURLPart(dataset)}/register-layers`;
}

// The URL param of the layer registration view that holds the moving layer shown in the right view.
export const MOVING_LAYER_URL_PARAM = "layer";

// Without a moving layer, the layer registration view shows the first moving layer of the dataset.
export function getLayerRegistrationViewUrl(
  dataset: { name: string; id: string },
  annotationId: string,
  movingLayerName?: string,
): string {
  const url = `${getLayerRegistrationListUrl(dataset)}/${annotationId}`;
  return movingLayerName != null
    ? `${url}?${new URLSearchParams({ [MOVING_LAYER_URL_PARAM]: movingLayerName })}`
    : url;
}

// The store iframe must open the layer registration annotation in the normal viewer instead of
// being redirected to the layer registration view again.
export function getLayerRegistrationStoreUrl(annotationId: string): string {
  return `/annotations/${annotationId}?${STORE_URL_PARAM}`;
}

export function getLayerRegistrationWorkerUrl(
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

// Actions that a worker asks the layer registration page to perform. "toggleTransform",
// "toggleOtherLayer" and "syncOtherView" refer to the worker that sent the command.
export type LayerRegistrationCommand =
  | "toggleTransform"
  | "toggleLandmarkPanel"
  | "toggleOtherLayer"
  | "syncOtherView";

// What the layer registration page tells a worker about its view, for the worker's toolbar.
export type LayerRegistrationViewState = {
  // The layer of the other worker, and whether this worker shows it, too.
  otherLayerName: string;
  isOtherLayerVisible: boolean;
  // Whether the worker shows the other layer transformed onto its own layer or untransformed.
  isTransformShown: boolean;
  // Whether there are enough landmark pairs to estimate a transform.
  isTransformAvailable: boolean;
  isLandmarkPanelOpen: boolean; // Only needed for the right worker.
};

export const LAYER_REGISTRATION_COMMAND_MESSAGE_TYPE = "layerRegistrationCommand";

export function sendCommandToLayerRegistrationPage(command: LayerRegistrationCommand) {
  window.parent.postMessage(
    { type: LAYER_REGISTRATION_COMMAND_MESSAGE_TYPE, command },
    window.location.origin,
  );
}

// Sent by the store iframe whenever the save state of the layer registration annotation changes.
export const LAYER_REGISTRATION_STORE_SAVED_STATE_MESSAGE_TYPE = "layerRegistrationStoreSavedState";
export type SaveState = "saved" | "saving" | "unsaved";
