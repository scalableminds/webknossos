import { findDataPositionForLayer, getBuildInfo } from "admin/rest_api";
import Toast from "libs/toast";
import { isNoEditableElementFocused } from "libs/utils";
import { useEffect, useSyncExternalStore } from "react";
import type { BlockerFunction } from "react-router";
import type { Vector3 } from "viewer/constants";
import { isSaving } from "viewer/model/accessors/annotation_accessor";
import { getDataLayers } from "viewer/model/accessors/dataset_accessor";
import { getMaxZoomValueForMag } from "viewer/model/accessors/flycam_accessor";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { Toolkit } from "viewer/model/accessors/tool_accessor";
import { setLayerTransformsAction } from "viewer/model/actions/dataset_actions";
import { setPositionAction, setZoomStepAction } from "viewer/model/actions/flycam_actions";
import {
  updateDatasetSettingAction,
  updateLayerSettingAction,
  updateUserSettingAction,
} from "viewer/model/actions/settings_actions";
import { addTreesAndGroupsAction } from "viewer/model/actions/skeletontracing_actions";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import { parseNml, serializeToNml } from "viewer/model/helpers/nml_helpers";
import { type Tree, TreeMap } from "viewer/model/types/tree_types";
import { Model } from "viewer/singletons";
import Store from "viewer/store";
import {
  getLandmarkColor,
  getLandmarkPairId,
  getLandmarkTreeName,
  getNextLandmarkPairId,
  type LandmarkPairInfo,
  prepareLandmarkTreesForImport,
} from "./layer_registration_helpers";
import {
  getLayerRegistrationWorkerLayerName,
  isLayerRegistrationWorker,
  LAYER_REGISTRATION_STORE_SAVED_STATE_MESSAGE_TYPE,
  type LayerRegistrationCommand,
  type LayerRegistrationViewState,
  type SaveState,
  sendCommandToLayerRegistrationPage,
} from "./layer_registration_protocol";

// Code that runs inside the iframes of the layer registration view.

// These letters are not bound in WEBKNOSSOS' plane mode. The listener below does not stop
// propagation, so a bound key would trigger both actions.
const SHORTCUT_COMMANDS: Record<string, LayerRegistrationCommand> = {
  t: "toggleTransform",
  x: "toggleOtherLayer",
  y: "syncOtherView",
};

// Key events don't bubble out of an iframe, so the worker forwards the layer registration
// shortcuts to the layer registration page.
export function useLayerRegistrationShortcutRelay() {
  useEffect(() => {
    if (!isLayerRegistrationWorker()) {
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
      sendCommandToLayerRegistrationPage(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

// Navigating within a worker iframe breaks the layer registration view, so navigation within the
// app is always blocked. The worker's own annotation is a sandbox and never counts as unsaved, so
// the regular "unsaved changes" blocker would not fire here.
// Full page loads (e.g. a reload) can't be blocked without the browser's own "leave page?" dialog,
// which would also appear whenever the layer registration view itself is left. Instead, the layer
// registration view restarts when a worker loads a new page (see useIframeBridge).
export function blockLayerRegistrationWorkerNavigation(
  args: BeforeUnloadEvent | BlockerFunction,
): boolean | undefined {
  if ("preventDefault" in args) {
    // The native event requires an empty return value to not show a dialog.
    return;
  }
  Toast.warning(
    'This view can\'t be left while registering layers. To leave, use "Back to all layer registrations" in the side panel or the WEBKNOSSOS logo in the left view.',
  );
  return true;
}

// Configures the worker right after the annotation was loaded: show and natively render only the
// worker's own layer (so landmark positions are in that layer's coordinates), create a new tree per
// node, don't move the camera to new nodes, restrict the tools to landmark clicking and move to a
// position that contains data. These settings are not persisted (see settings_saga.ts).
// The transforms that the dataset stores for its layers are removed in the worker. The layer
// registration page sets the preview transforms of the other layers, and WEBKNOSSOS would chain
// them with the inverse of the stored transforms of the natively rendered layer.
export async function applyLayerRegistrationWorkerSettings() {
  const layerName = getLayerRegistrationWorkerLayerName();
  for (const layer of getDataLayers(Store.getState().dataset)) {
    Store.dispatch(setLayerTransformsAction(layer.name, null));
    Store.dispatch(updateLayerSettingAction(layer.name, "isDisabled", layer.name !== layerName));
  }
  Store.dispatch(updateDatasetSettingAction("nativelyRenderedLayerName", layerName));
  Store.dispatch(updateUserSettingAction("newNodeNewTree", true));
  Store.dispatch(updateUserSettingAction("centerNewNode", false));
  Store.dispatch(updateUserSettingAction("activeToolkit", Toolkit.LANDMARKS));

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

// Imports the stored landmarks of this worker's side (see prepareLandmarkTreesForImport).
export async function importLandmarks(nmlString: string) {
  const { trees, treeGroups } = await parseNml(nmlString);
  Store.dispatch(addTreesAndGroupsAction(prepareLandmarkTreesForImport(trees), treeGroups));
}

// Set by the layer registration page after each sync. It is a module variable and not Redux
// state, because only the click handler of the workers reads it and nothing is rendered from it.
let landmarkPairInfo: LandmarkPairInfo = { openPairIds: [], otherMaxPairId: 0 };

export function setLandmarkPairInfo(pairInfo: LandmarkPairInfo) {
  landmarkPairInfo = pairInfo;
}

// The name and color of the tree that a click in a worker creates: the name holds the pair id of
// the new landmark (see getNextLandmarkPairId). They are part of the action that creates the tree.
// If the layer registration page renamed the tree afterwards, undo would revert the renaming, the
// page would rename the tree again, and the user could never undo the click itself.
export function getNewLandmarkTreeProperties(): { name: string; color: Vector3 } {
  const ownPairIds = new Set(
    enforceSkeletonTracing(Store.getState().annotation)
      .trees.values()
      .filter((tree) => tree.nodes.size() > 0)
      .map((tree) => getLandmarkPairId(tree.name))
      .filter((pairId) => pairId != null),
  );
  const pairId = getNextLandmarkPairId(ownPairIds, landmarkPairInfo);
  return { name: getLandmarkTreeName(pairId), color: getLandmarkColor(pairId) };
}

// Serializes the given landmark trees for the dataset composition wizard. The wizard pairs
// the trees of its two NML files by their sorted tree ids, so each tree gets its pair id as
// tree id.
export async function exportLandmarkPairsAsNml(
  treeIdsByPairId: Array<[pairId: number, treeId: number]>,
): Promise<string> {
  const state = Store.getState();
  const skeletonTracing = enforceSkeletonTracing(state.annotation);
  const exportedTrees = treeIdsByPairId.map(([pairId, treeId]): [number, Tree] => [
    pairId,
    { ...skeletonTracing.trees.getOrThrow(treeId), treeId: pairId, isVisible: true, groupId: null },
  ]);
  const exportedTracing = { ...skeletonTracing, trees: new TreeMap(exportedTrees), treeGroups: [] };
  return serializeToNml(state, state.annotation, exportedTracing, await getBuildInfo(), false);
}

// Set by the layer registration page whenever it changes. Unlike the pair info, the toolbar renders
// it, so components subscribe to it with useLayerRegistrationViewState.
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

// The layer colors from before setOverlayLayerColors changed them.
const originalLayerColors = new Map<string, Vector3>();

// Shows the given layers in the given colors, or restores their original colors if colors is
// null. Like other worker settings, the colors are not persisted (see settings_saga.ts).
export function setOverlayLayerColors(colors: Record<string, Vector3> | null) {
  if (colors == null) {
    for (const [layerName, color] of originalLayerColors) {
      Store.dispatch(updateLayerSettingAction(layerName, "color", color));
    }
    originalLayerColors.clear();
    return;
  }
  const { layers } = Store.getState().datasetConfiguration;
  for (const [layerName, color] of Object.entries(colors)) {
    const layerConfiguration = layers[layerName];
    if (layerConfiguration == null) {
      continue;
    }
    if (!originalLayerColors.has(layerName)) {
      originalLayerColors.set(layerName, layerConfiguration.color);
    }
    Store.dispatch(updateLayerSettingAction(layerName, "color", color));
  }
}

// Tells the layer registration view whether the layer registration annotation is saved, being saved
// or has unsaved changes. Runs in the store iframe.
export function reportLayerRegistrationStoreSavedState() {
  listenToStoreProperty(
    (state): SaveState => (isSaving(state) ? "saving" : Model.stateSaved() ? "saved" : "unsaved"),
    (saveState) =>
      window.parent.postMessage(
        { type: LAYER_REGISTRATION_STORE_SAVED_STATE_MESSAGE_TYPE, saveState },
        window.location.origin,
      ),
    true,
  );
}
