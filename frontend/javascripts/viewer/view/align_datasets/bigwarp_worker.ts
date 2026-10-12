import { findDataPositionForLayer } from "admin/rest_api";
import Toast from "libs/toast";
import { isNoEditableElementFocused } from "libs/utils";
import { useEffect } from "react";
import type { BlockerFunction } from "react-router";
import { getDataLayers } from "viewer/model/accessors/dataset_accessor";
import { getMaxZoomValueForMag } from "viewer/model/accessors/flycam_accessor";
import { Toolkit } from "viewer/model/accessors/tool_accessor";
import { setPositionAction, setZoomStepAction } from "viewer/model/actions/flycam_actions";
import {
  updateDatasetSettingAction,
  updateLayerSettingAction,
  updateUserSettingAction,
} from "viewer/model/actions/settings_actions";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import { Model } from "viewer/singletons";
import Store from "viewer/store";
import {
  BIG_WARP_STORE_SAVED_STATE_MESSAGE_TYPE,
  type BigWarpCommand,
  getBigWarpWorkerLayerName,
  isBigWarpWorker,
  sendCommandToAlignmentPage,
} from "./bigwarp_protocol";

// Code that runs inside the iframes of the alignment view.

// These letters are not bound in WEBKNOSSOS' plane mode. The listener below does not stop
// propagation, so a bound key would trigger both actions.
const SHORTCUT_COMMANDS: Record<string, BigWarpCommand> = {
  t: "align",
  x: "toggleOtherLayer",
  y: "syncOtherView",
};

// Key events don't bubble out of an iframe, so the worker forwards the alignment
// shortcuts to the alignment page.
export function useBigWarpShortcutRelay() {
  useEffect(() => {
    if (!isBigWarpWorker()) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const command = SHORTCUT_COMMANDS[event.key.toLowerCase()];
      if (
        command == null ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        !isNoEditableElementFocused()
      ) {
        return;
      }
      event.preventDefault();
      sendCommandToAlignmentPage(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

// Navigating within a worker iframe breaks the alignment view, so navigation within the app
// is always blocked. The worker's own annotation is a sandbox and never counts as unsaved,
// so the regular "unsaved changes" blocker would not fire here.
// Full page loads (e.g. a reload) can't be blocked without the browser's own "leave page?"
// dialog, which would also appear whenever the alignment view itself is left. Instead, the
// alignment view restarts when a worker loads a new page (see useIframeBridge).
export function blockBigWarpWorkerNavigation(
  args: BeforeUnloadEvent | BlockerFunction,
): boolean | undefined {
  if ("preventDefault" in args) {
    // The native event requires an empty return value to not show a dialog.
    return;
  }
  Toast.warning(
    "This view can't be left while aligning layers. To leave the alignment, click the WEBKNOSSOS logo in the left view.",
  );
  return true;
}

// Configures the worker right after the annotation was loaded: show and natively render only
// the worker's own layer (so landmark positions are in that layer's coordinates), create a
// new tree per node, don't move the camera to new nodes, restrict the tools to landmark
// clicking and move to a position that contains data. These settings are not persisted
// (see settings_saga.ts).
export async function applyBigWarpWorkerSettings() {
  const layerName = getBigWarpWorkerLayerName();
  for (const layer of getDataLayers(Store.getState().dataset)) {
    Store.dispatch(updateLayerSettingAction(layer.name, "isDisabled", layer.name !== layerName));
  }
  Store.dispatch(updateDatasetSettingAction("nativelyRenderedLayerName", layerName));
  Store.dispatch(updateUserSettingAction("newNodeNewTree", true));
  Store.dispatch(updateUserSettingAction("centerNewNode", false));
  Store.dispatch(updateUserSettingAction("activeToolkit", Toolkit.BIGWARP_LANDMARKS));

  try {
    const { dataset } = Store.getState();
    const { position, mag } = await findDataPositionForLayer(
      dataset.dataStore.url,
      dataset,
      layerName,
    );
    if (position != null && mag != null) {
      Store.dispatch(setPositionAction(position));
      Store.dispatch(setZoomStepAction(getMaxZoomValueForMag(Store.getState(), layerName, mag)));
    }
  } catch (error) {
    console.error("Could not find a data position for layer", layerName, error);
  }
}

// Tells the alignment view whether the alignment annotation has unsaved changes. Runs in the
// store iframe.
export function reportBigWarpStoreSavedState() {
  listenToStoreProperty(
    () => Model.stateSaved(),
    (isSaved) =>
      window.parent.postMessage(
        { type: BIG_WARP_STORE_SAVED_STATE_MESSAGE_TYPE, isSaved },
        window.location.origin,
      ),
    true,
  );
}
