import { getUrlParamValue, hasUrlParam } from "libs/utils";
import type { Matrix4x4 } from "mjs";
import type { APIDataset, APIDatasetCompact, APIMaybeUnimportedDataset } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import {
  getMappingFromLayerNameToBaseDatasetLayerName,
  getReadableURLPart,
} from "viewer/model/accessors/dataset_accessor";
import type { LandmarkPairInfo, Side } from "./helpers/layer_registration_helpers";

// The layer registration view (layer_registration_view.tsx) embeds two normal sandbox views of the
// same dataset as iframes, one per layer. These views are called "workers". A third, hidden iframe
// loads the layer registration annotation itself, which stores the landmarks ("store").
// This module defines everything that the layer registration page, the iframes and the rest of
// the app have to agree on. It only holds definitions; the code that sends and receives the
// messages is in IframeBridge (page side), cross_origin_api.ts and layer_registration_worker.ts
// (iframe side):
// 1. The role of each iframe, encoded in its URL params, and the URLs of the pages.
// 2. Page → iframe: the commands of the cross-origin API that the page uses (IframeCommands)
//    and the message envelope.
// 3. Iframe → page: the commands of the workers and the save state of the store.

// The role of an iframe. The URL params of each iframe:
// - left worker (fixed layer): layerRegistrationWorker=<fixed layer name>&layerRegistrationPrimary=true
// - right worker (moving layer): layerRegistrationWorker=<moving layer name>
// - store: layerRegistrationStore (without a value)
const WORKER_LAYER_URL_PARAM = "layerRegistrationWorker";
const PRIMARY_WORKER_URL_PARAM = "layerRegistrationPrimary";
const STORE_URL_PARAM = "layerRegistrationStore";

export type IframeRole = Side | "store";

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

// Whether the layers of a dataset can be registered: it needs to be active and have a fixed layer
// and at least one moving layer (any other layer, see getMovingLayerNames). All entry points use
// this, so that they match what the layer registration view accepts.
export function canRegisterLayers(dataset: APIDatasetCompact | APIMaybeUnimportedDataset): boolean {
  if (!dataset.isActive) {
    return false;
  }
  // In the viewer, the dataset also contains the volume annotation layers. The mapping counts
  // only the layers of the dataset itself.
  const layerCount =
    "colorLayerNames" in dataset
      ? dataset.colorLayerNames.length + dataset.segmentationLayerNames.length
      : getMappingFromLayerNameToBaseDatasetLayerName(dataset).size;
  return layerCount >= 2;
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

// Page → iframe: the commands of the cross-origin API (cross_origin_api.ts) that the layer
// registration page sends, with their arguments and return values.
export type IframeCommands = {
  // Workers only.
  importLandmarks: { args: [nmlString: string]; returns: void };
  setLandmarkPairInfo: { args: [pairInfo: LandmarkPairInfo]; returns: void };
  setLayerRegistrationViewState: { args: [viewState: LayerRegistrationViewState]; returns: void };
  // Null restores the original layer colors.
  setOverlayLayerColors: {
    args: [colorsByLayerName: Record<string, Vector3> | null];
    returns: void;
  };
  exportLandmarkPairsAsNml: {
    args: [treeIdsByPairId: Array<[pairId: number, treeId: number]>];
    returns: string;
  };
  setActiveNode: {
    args: [nodeId: number, suppressAnimation: boolean, suppressCentering: boolean];
    returns: void;
  };
  deleteNode: { args: [nodeId: number, treeId: number]; returns: void };
  deleteTree: { args: [treeId: number]; returns: void };
  getCameraPosition: { args: []; returns: Vector3 };
  centerPositionAnimated: { args: [position: Vector3]; returns: void };
  setLayerVisibility: { args: [layerName: string, isVisible: boolean]; returns: void };
  setAffineLayerTransforms: { args: [layerName: string, matrix: Matrix4x4]; returns: void };
  // Workers and store. Without a group id, all trees are exported.
  exportTreesAsNmlString: { args: [filter?: { groupId?: number }]; returns: string };
  // Store only.
  ensureTreeGroupPath: { args: [groupNames: string[]]; returns: number };
  // Null if a group along the path doesn't exist.
  findTreeGroupPath: { args: [groupNames: string[]]; returns: number | null };
  replaceTreesInGroup: { args: [nmlString: string, groupId: number]; returns: void };
  setAnnotationName: { args: [name: string]; returns: void };
  setAnnotationDescription: { args: [description: string]; returns: void };
  save: { args: []; returns: void };
};
export type IframeCommand = keyof IframeCommands;

// The message envelope of the cross-origin API. An iframe sends "init" once its API is ready and
// drops commands that arrive earlier. It answers each command with "ack" and the return value,
// or with "err" if the command failed.
export type IframeCommandMessage<C extends IframeCommand> = {
  type: C;
  args: IframeCommands[C]["args"];
  messageId: string;
};
export type IframeInitMessage = { type: "init" };
export type IframeReplyMessage =
  | { type: "ack"; messageId: string; returnValue: unknown }
  | { type: "err"; messageId: string; message: string };

// Iframe → page: actions that a worker asks the layer registration page to perform, triggered by
// shortcuts and toolbar buttons. "toggleTransform", "toggleOtherLayer" and "syncOtherView" refer
// to the worker that sent the command.
export type LayerRegistrationCommand =
  | "toggleTransform"
  | "toggleLandmarkPanel"
  | "toggleOtherLayer"
  | "syncOtherView";

export const LAYER_REGISTRATION_COMMAND_MESSAGE_TYPE = "layerRegistrationCommand";
export type WorkerCommandMessage = {
  type: typeof LAYER_REGISTRATION_COMMAND_MESSAGE_TYPE;
  command: LayerRegistrationCommand;
};

// Iframe → page: sent by the store iframe whenever the save state of the layer registration
// annotation changes.
export const LAYER_REGISTRATION_STORE_SAVED_STATE_MESSAGE_TYPE = "layerRegistrationStoreSavedState";
export type SaveState = "saved" | "saving" | "unsaved";
export type StoreSaveStateMessage = {
  type: typeof LAYER_REGISTRATION_STORE_SAVED_STATE_MESSAGE_TYPE;
  saveState: SaveState;
};

// What the layer registration page tells a worker about its view, for the worker's toolbar
// (see setLayerRegistrationViewState).
export type LayerRegistrationViewState = {
  // The layer of the other worker, and whether this worker shows it, too.
  otherLayerName: string;
  isOtherLayerVisible: boolean;
  // Whether the worker shows the other layer transformed onto its own layer or untransformed.
  isTransformShown: boolean;
  // Whether there are enough landmark pairs to estimate a transform.
  isTransformAvailable: boolean;
  // Only needed for the right worker, which has the button that toggles the panel.
  isLandmarkPanelOpen: boolean;
};
