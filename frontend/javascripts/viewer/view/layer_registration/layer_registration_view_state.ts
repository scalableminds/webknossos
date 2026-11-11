import { useSyncExternalStore } from "react";
import {
  LAYER_REGISTRATION_COMMAND_MESSAGE_TYPE,
  type LayerRegistrationCommand,
  type LayerRegistrationViewState,
  type WorkerCommandMessage,
} from "./layer_registration_protocol";

// The parts of the worker code (see layer_registration_worker.ts) that the toolbar and the navbar
// need. The navbar is part of every page, so this module must not import the viewer.
// See viewer/viewer_entry.ts.

// Sends a command of this worker to the layer registration page (see IframeBridge).
export function sendCommandToLayerRegistrationPage(command: LayerRegistrationCommand) {
  const message: WorkerCommandMessage = { type: LAYER_REGISTRATION_COMMAND_MESSAGE_TYPE, command };
  window.parent.postMessage(message, window.location.origin);
}

// Set by the layer registration page whenever it changes. Unlike the pair info (see
// layer_registration_worker.ts), the toolbar renders it, so components subscribe to it with
// useLayerRegistrationViewState.
let layerRegistrationViewState: LayerRegistrationViewState = {
  otherLayerName: "",
  isOtherLayerVisible: false,
  isTransformShown: true,
  isTransformAvailable: false,
  isLandmarkPanelOpen: true,
};
const layerRegistrationViewStateListeners = new Set<() => void>();

export function setLayerRegistrationViewState(viewState: LayerRegistrationViewState) {
  layerRegistrationViewState = viewState;
  for (const listener of layerRegistrationViewStateListeners) {
    listener();
  }
}

function subscribeToLayerRegistrationViewState(onChange: () => void) {
  layerRegistrationViewStateListeners.add(onChange);
  return () => {
    layerRegistrationViewStateListeners.delete(onChange);
  };
}

export function useLayerRegistrationViewState(): LayerRegistrationViewState {
  return useSyncExternalStore(
    subscribeToLayerRegistrationViewState,
    () => layerRegistrationViewState,
  );
}
