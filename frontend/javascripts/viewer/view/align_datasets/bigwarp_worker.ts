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
} from "./alignment_helpers";
import {
  type AlignmentViewState,
  BIG_WARP_STORE_SAVED_STATE_MESSAGE_TYPE,
  type BigWarpCommand,
  getBigWarpWorkerLayerName,
  isBigWarpWorker,
  type SaveState,
  sendCommandToAlignmentPage,
} from "./bigwarp_protocol";

// Code that runs inside the iframes of the alignment view.

// These letters are not bound in WEBKNOSSOS' plane mode. The listener below does not stop
// propagation, so a bound key would trigger both actions.
const SHORTCUT_COMMANDS: Record<string, BigWarpCommand> = {
  t: "toggleTransform",
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

// Imports the stored landmarks of this worker's side (see prepareLandmarkTreesForImport).
export async function importLandmarks(nmlString: string) {
  const { trees, treeGroups } = await parseNml(nmlString);
  Store.dispatch(addTreesAndGroupsAction(prepareLandmarkTreesForImport(trees), treeGroups));
}

// Set by the alignment page after each sync. Not put into store as nothing rendering wise depends on this.
// Moreover, this is only needed in the bigwarp context. Therefore, we keep it locally by putting it into the module level.
let landmarkPairInfo: LandmarkPairInfo = { openPairIds: [], otherMaxPairId: 0 };

export function setLandmarkPairInfo(pairInfo: LandmarkPairInfo) {
  landmarkPairInfo = pairInfo;
}

// The name and color of the tree that a click in a worker creates: the name holds the pair id
// of the new landmark (see getNextLandmarkPairId). They are part of the action that creates the
// tree. If the alignment page renamed the tree afterwards, undo would revert the renaming, the
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

// Set by the alignment page whenever it changes. Unlike the pair info, the toolbar renders it,
// so components subscribe to it with useAlignmentViewState.
let alignmentViewState: AlignmentViewState = {
  isTransformShown: true,
  isAlignmentAvailable: false,
  isLandmarkPanelOpen: true,
};
const alignmentViewStateListeners = new Set<() => void>();

export function setAlignmentViewState(viewState: AlignmentViewState) {
  alignmentViewState = viewState;
  for (const listener of alignmentViewStateListeners) {
    listener();
  }
}

function subscribeToAlignmentViewState(onChange: () => void) {
  alignmentViewStateListeners.add(onChange);
  return () => {
    alignmentViewStateListeners.delete(onChange);
  };
}

export function useAlignmentViewState(): AlignmentViewState {
  return useSyncExternalStore(subscribeToAlignmentViewState, () => alignmentViewState);
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

// Tells the alignment view whether the alignment annotation is saved, being saved or has
// unsaved changes. Runs in the store iframe.
export function reportBigWarpStoreSavedState() {
  listenToStoreProperty(
    (state): SaveState => (isSaving(state) ? "saving" : Model.stateSaved() ? "saved" : "unsaved"),
    (saveState) =>
      window.parent.postMessage(
        { type: BIG_WARP_STORE_SAVED_STATE_MESSAGE_TYPE, saveState },
        window.location.origin,
      ),
    true,
  );
}
