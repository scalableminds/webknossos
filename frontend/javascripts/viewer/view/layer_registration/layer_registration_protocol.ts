import { location } from "libs/window";
import type { Matrix4x4 } from "mjs";
import type { APIDataset } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import type { LandmarkPairInfo, Side } from "./helpers/layer_registration_helpers";

// The layer registration view (layer_registration_view.tsx) embeds three iframes of the normal
// viewer:
// - Two landmark iframes, in which the user places the landmarks: the fixed iframe (left) shows
//   the fixed layer, the moving iframe (right) the moving layer. Each one opens a sandbox of the
//   dataset, so its own annotation only exists while the page is open.
// - The hidden annotation iframe, which opens the layer registration annotation itself. The page
//   reads the landmarks of both sides from it and saves them through it.
// This module defines everything that the layer registration page, the iframes and the rest of
// the app have to agree on. Besides the definitions, it only holds small helpers without state
// that both sides use: reading and building the URLs, and sending a landmark iframe command. The
// rest of the code that sends and receives the messages is in IframeBridge (page side),
// cross_origin_api.ts and layer_registration_landmark_iframe.ts (iframe side). The navbar imports
// this module, so it must not import the viewer (see viewer/viewer_entry.ts):
// 1. The role of each iframe, encoded in its URL params, and the URLs of the pages.
// 2. Page → iframe: the commands of the cross-origin API that the page uses (IframeCommands)
//    and the message envelope.
// 3. Iframe → page: the commands of the landmark iframes and the save state of the annotation
//    iframe.

// The URL params of each iframe:
// - fixed iframe: layerRegistrationIframe=fixed&layerRegistrationLayer=<fixed layer name>
// - moving iframe: layerRegistrationIframe=moving&layerRegistrationLayer=<moving layer name>
// - annotation iframe: layerRegistrationIframe=annotation
const IFRAME_ROLE_URL_PARAM = "layerRegistrationIframe";
const LAYER_URL_PARAM = "layerRegistrationLayer";

export type IframeRole = Side | "annotation";

// Null outside of the iframes of the layer registration page.
function getIframeRole(): IframeRole | null {
  const role = new URLSearchParams(location.search).get(IFRAME_ROLE_URL_PARAM);
  return role === "fixed" || role === "moving" || role === "annotation" ? role : null;
}

export function isLayerRegistrationLandmarkIframe(): boolean {
  const role = getIframeRole();
  return role === "fixed" || role === "moving";
}

// The fixed iframe is the left one. The layer registration page itself has no navbar, so the
// navbar of the fixed iframe shows the link to the dashboard.
export function isLayerRegistrationFixedLandmarkIframe(): boolean {
  return getIframeRole() === "fixed";
}

export function isLayerRegistrationAnnotationIframe(): boolean {
  return getIframeRole() === "annotation";
}

// The layer whose landmarks are placed in this landmark iframe.
// getLayerRegistrationLandmarkIframeUrl encodes the param with URLSearchParams, which writes a
// space as "+", so it is read the same way. getUrlParamValue would keep the "+".
export function getLandmarkIframeLayerName(): string {
  const layerName = new URLSearchParams(location.search).get(LAYER_URL_PARAM);
  if (layerName == null) {
    throw new Error("The URL doesn't name the layer of the layer registration landmark iframe.");
  }
  return layerName;
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

// The annotation iframe must open the layer registration annotation in the normal viewer instead
// of being redirected to the layer registration view again.
export function getLayerRegistrationAnnotationIframeUrl(annotationId: string): string {
  const params = new URLSearchParams({ [IFRAME_ROLE_URL_PARAM]: "annotation" });
  return `/annotations/${annotationId}?${params}`;
}

export function getLayerRegistrationLandmarkIframeUrl(
  dataset: APIDataset,
  side: Side,
  layerName: string,
): string {
  const params = new URLSearchParams({
    [IFRAME_ROLE_URL_PARAM]: side,
    [LAYER_URL_PARAM]: layerName,
  });
  return `/datasets/${getReadableURLPart(dataset)}/sandbox/skeleton?${params}`;
}

// Page → iframe: the commands of the cross-origin API (cross_origin_api.ts) that the layer
// registration page sends, with their arguments and return values.
export type IframeCommands = {
  // Landmark iframes only.
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
  // Landmark iframes and annotation iframe. Without a group id, all trees are exported.
  exportTreesAsNmlString: { args: [filter?: { groupId?: number }]; returns: string };
  // Annotation iframe only.
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

// Iframe → page: actions that a landmark iframe asks the layer registration page to perform,
// triggered by shortcuts and toolbar buttons. "toggleTransform", "toggleOtherLayer" and
// "syncOtherView" refer to the landmark iframe that sent the command.
export type LayerRegistrationCommand =
  | "toggleTransform"
  | "toggleLandmarkPanel"
  | "toggleOtherLayer"
  | "syncOtherView";

export const LAYER_REGISTRATION_COMMAND_MESSAGE_TYPE = "layerRegistrationCommand";
export type LandmarkIframeCommandMessage = {
  type: typeof LAYER_REGISTRATION_COMMAND_MESSAGE_TYPE;
  command: LayerRegistrationCommand;
};

// Sends a command of this landmark iframe to the layer registration page (see IframeBridge).
export function sendCommandToLayerRegistrationPage(command: LayerRegistrationCommand) {
  const message: LandmarkIframeCommandMessage = {
    type: LAYER_REGISTRATION_COMMAND_MESSAGE_TYPE,
    command,
  };
  window.parent.postMessage(message, window.location.origin);
}

// Iframe → page: sent by the annotation iframe whenever the save state of the layer registration
// annotation changes.
export const LAYER_REGISTRATION_ANNOTATION_IFRAME_SAVE_STATE_MESSAGE_TYPE =
  "layerRegistrationAnnotationIframeSaveState";
export type SaveState = "saved" | "saving" | "unsaved";
export type AnnotationIframeSaveStateMessage = {
  type: typeof LAYER_REGISTRATION_ANNOTATION_IFRAME_SAVE_STATE_MESSAGE_TYPE;
  saveState: SaveState;
};

// What the layer registration page tells a landmark iframe about its view, for the toolbar of the
// landmark iframe (see setLayerRegistrationViewState).
export type LayerRegistrationViewState = {
  // The layer of the other landmark iframe, and whether this landmark iframe shows it, too.
  otherLayerName: string;
  isOtherLayerVisible: boolean;
  // Whether the landmark iframe shows the other layer transformed onto its own layer or
  // untransformed.
  isTransformShown: boolean;
  // Whether there are enough landmark pairs to estimate a transform.
  isTransformAvailable: boolean;
  // Only needed for the moving iframe, which has the button that toggles the panel.
  isLandmarkPanelOpen: boolean;
};
