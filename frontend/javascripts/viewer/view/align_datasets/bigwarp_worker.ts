import { findDataPositionForLayer } from "admin/rest_api";
import { isNoEditableElementFocused } from "libs/utils";
import { useEffect } from "react";
import type { BlockerFunction } from "react-router";
import UrlManager from "viewer/controller/url_manager";
import { getMaxZoomValueForMag } from "viewer/model/accessors/flycam_accessor";
import { Toolkit } from "viewer/model/accessors/tool_accessor";
import { setPositionAction, setZoomStepAction } from "viewer/model/actions/flycam_actions";
import {
  updateDatasetSettingAction,
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

// Navigating within a worker iframe (e.g. via a link in its navbar) breaks the alignment view,
// so it is always blocked. The worker's own annotation is a sandbox and never counts as
// unsaved, so the regular "unsaved changes" blocker would not fire here.
// The browser's own "leave page?" dialog is not used: it would also appear whenever the
// alignment view itself is left. The alignment view shows that dialog only if the alignment
// annotation has unsaved changes (see alignment_workspace.tsx).
export function blockBigWarpWorkerNavigation(
  args: BeforeUnloadEvent | BlockerFunction,
): boolean | undefined {
  if ("preventDefault" in args) {
    // The native event requires an empty return value to not show a dialog.
    return;
  }
  const shouldLeave = confirm(
    "Leaving this view is not allowed while aligning layers. Leave anyway?",
  );
  if (shouldLeave) {
    // Same reason as in the regular blocker in controller.tsx: don't overwrite the target
    // history entry with the annotation URL.
    UrlManager.stopUrlUpdater();
  }
  return !shouldLeave;
}

// Configures the worker right after the annotation was loaded: render the worker's own
// layer natively (so landmark positions are in that layer's coordinates), create a new
// tree per node, restrict the tools to landmark clicking and move to a position that
// contains data. These settings are not persisted (see settings_saga.ts).
export async function applyBigWarpWorkerSettings() {
  const layerName = getBigWarpWorkerLayerName();
  Store.dispatch(updateDatasetSettingAction("nativelyRenderedLayerName", layerName));
  Store.dispatch(updateUserSettingAction("newNodeNewTree", true));
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
