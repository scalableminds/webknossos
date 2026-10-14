import { Splitter } from "antd";
import classnames from "classnames";
import { handleGenericError } from "libs/error_handling";
import Toast from "libs/toast";
import { useMemo, useState } from "react";
import type { APIAnnotation, APIDataset } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import {
  getTransformPointUnscaledFn,
  invertTransform,
} from "viewer/model/helpers/transformation_helpers";
import { useApplyTransforms } from "./hooks/use_layer_registration_apply_transforms";
import { type IframeRole, useIframeBridge } from "./hooks/use_layer_registration_iframe_bridge";
import { useInactivePairs } from "./hooks/use_layer_registration_inactive_pairs";
import { useLandmarkSync } from "./hooks/use_layer_registration_landmark_sync";
import { useLeavePrompt } from "./hooks/use_layer_registration_leave_prompt";
import { useViewSettings } from "./hooks/use_layer_registration_view_settings";
import {
  getLandmarkPairInfo,
  type LandmarkPair,
  type LayerNames,
  OTHER_SIDE,
  SIDES,
  type Side,
} from "./layer_registration_helpers";
import {
  downloadLandmarkPairs,
  type LandmarkExportFormat,
} from "./layer_registration_landmark_export";
import { LayerRegistrationLandmarkPanel } from "./layer_registration_landmark_panel";
import { getCopySources, getMovingLayerRows } from "./layer_registration_moving_layers";
import {
  getLayerRegistrationListUrl,
  type LayerRegistrationCommand,
  type SaveState,
} from "./layer_registration_protocol";
import { getLayerPairTransformEstimate } from "./layer_registration_transform_estimation";
import {
  getOverlayStatus,
  LayerRegistrationWorkerFrames,
} from "./layer_registration_worker_frames";

const DEFAULT_LANDMARK_PANEL_WIDTH = 380;
const MIN_LANDMARK_PANEL_WIDTH = 260;
const MAX_LANDMARK_PANEL_WIDTH = "70%";

type Props = {
  dataset: APIDataset;
  // The fixed layer and the moving layer shown in the right view ("active" moving layer).
  layerNames: LayerNames;
  // All layers that can be registered to the fixed layer.
  movingLayerNames: string[];
  // Called after the landmarks were saved, to show another moving layer. The parent must then
  // mount the workspace anew, with fresh iframes: the workers' undo history can't be cleared,
  // so undo would bring back the landmarks of the previous layer.
  onSwitchMovingLayer: (movingLayerName: string) => void;
  landmarkAnnotation: APIAnnotation;
  // Called after one of the iframes loaded a new page, e.g. because it was reloaded (see
  // restartAfterReload). The parent must then mount the workspace anew, with fresh iframes.
  onRestart: () => void;
};

export function LayerRegistrationWorkspace({
  dataset,
  layerNames,
  movingLayerNames,
  onSwitchMovingLayer,
  landmarkAnnotation,
  onRestart,
}: Props) {
  const [isLandmarkPanelOpen, setIsLandmarkPanelOpen] = useState(true);
  const [landmarkPanelWidth, setLandmarkPanelWidth] = useState(DEFAULT_LANDMARK_PANEL_WIDTH);
  const [annotationName, setAnnotationName] = useState(landmarkAnnotation.name);
  const [annotationDescription, setAnnotationDescription] = useState(
    landmarkAnnotation.description,
  );
  const [isRestarting, setIsRestarting] = useState(false);
  // Set while the landmarks are saved before switching to this moving layer.
  const [switchTargetLayerName, setSwitchTargetLayerName] = useState<string | null>(null);
  const { fixed: fixedLayerName, moving: movingLayerName } = layerNames;
  const voxelSizeFactor = dataset.dataSource.scale.factor;

  // handleWorkerCommand and restartAfterReload are function declarations further below, so
  // they can be used here.
  const { iframesRef, sendMessage, handleIframeLoad, storeSaveState } = useIframeBridge(
    handleWorkerCommand,
    restartAfterReload,
  );
  const {
    landmarks,
    status: syncStatus,
    hasUnsyncedLandmarks,
    fetchLandmarks,
    stopSync,
    flushAndStopSync,
    resumeSync,
  } = useLandmarkSync(sendMessage, layerNames);
  const inactivePairs = useInactivePairs(
    sendMessage,
    fixedLayerName,
    movingLayerNames.filter((name) => name !== movingLayerName),
    voxelSizeFactor,
  );
  // Estimating the transform is cheap, so it always matches the current landmarks.
  // Only the active pair is estimated again, the inactive pairs can't change.
  const activePairEstimate = useMemo(
    () => getLayerPairTransformEstimate(landmarks, voxelSizeFactor),
    [landmarks, voxelSizeFactor],
  );
  const { estimation } = activePairEstimate;
  const viewSettings = useViewSettings({
    dataset,
    layerNames,
    sendMessage,
    estimation,
    inactivePairs,
    isLandmarkPanelOpen,
  });
  const { layerTransformsInDataset, applyTransforms } = useApplyTransforms({
    dataset,
    fixedLayerName,
    movingLayerNames,
    activeLayerName: movingLayerName,
    inactivePairs,
    fetchLandmarks,
  });

  // Landmarks that changed in a worker but are not in the layer registration annotation yet are
  // unsaved, too.
  const saveState: SaveState =
    storeSaveState === "saved" && hasUnsyncedLandmarks ? "unsaved" : storeSaveState;
  const allowLeaving = useLeavePrompt(saveState !== "saved");
  const overlayStatus = getOverlayStatus(syncStatus, isRestarting, switchTargetLayerName != null);
  const movingLayerRows = getMovingLayerRows({
    movingLayerNames,
    activeLayerName: movingLayerName,
    activePairEstimate,
    inactivePairs,
    fixedLayerName,
    layerTransformsInDataset,
  });
  const getOpenPairIds = (side: Side) =>
    overlayStatus == null ? getLandmarkPairInfo(landmarks, side).openPairIds : [];
  const openPairIds = { fixed: getOpenPairIds("fixed"), moving: getOpenPairIds("moving") };

  // Makes the landmarks of the pair the active nodes, which highlights them, and moves both
  // views to them.
  const selectPair = (pair: LandmarkPair) => {
    for (const side of SIDES) {
      const landmark = pair.landmarks[side];
      if (landmark != null) {
        sendMessage(side, "setActiveNode", [landmark.nodeId, false, true]);
        sendMessage(side, "centerPositionAnimated", [landmark.position]);
      }
    }
  };

  const deletePair = async (pair: LandmarkPair) => {
    try {
      for (const side of SIDES) {
        const landmark = pair.landmarks[side];
        if (landmark == null) {
          continue;
        }
        // Each click creates a tree with one node. Deleting only the node would leave an empty
        // tree behind.
        const isOnlyLandmarkOfTree =
          landmarks[side].filter(({ treeId }) => treeId === landmark.treeId).length === 1;
        await (isOnlyLandmarkOfTree
          ? sendMessage(side, "deleteTree", [landmark.treeId])
          : sendMessage(side, "deleteNode", [landmark.nodeId, landmark.treeId]));
      }
    } catch (error) {
      handleGenericError(error as Error, "Could not delete the landmark pair.");
    }
  };

  // Moves the other worker to the position that corresponds to the position of this one.
  const syncOtherViewTo = async (side: Side) => {
    if ("errorMessage" in estimation) {
      Toast.info(estimation.errorMessage);
      return;
    }
    const { movingToFixedTransform } = estimation;
    const position = await sendMessage<Vector3>(side, "getCameraPosition");
    const transformToOtherSide =
      side === "fixed" ? invertTransform(movingToFixedTransform) : movingToFixedTransform;
    sendMessage(OTHER_SIDE[side], "centerPositionAnimated", [
      getTransformPointUnscaledFn(transformToOtherSide)(position),
    ]);
  };

  const downloadLandmarks = async (format: LandmarkExportFormat) => {
    try {
      await downloadLandmarkPairs(format, await fetchLandmarks(), layerNames, sendMessage);
    } catch (error) {
      handleGenericError(error as Error, "Could not download the landmarks.");
    }
  };

  // Saves the landmark annotation right away instead of waiting for its auto-save.
  // Reloading this page closes all iframes at once, which may interrupt the auto-save.
  const forceSave = async () => {
    try {
      await sendMessage("store", "save");
    } catch (error) {
      handleGenericError(error as Error, "Could not save the landmarks.");
    }
  };

  // Edited here, but saved by the store iframe, which has the layer registration annotation open.
  const updateAnnotation = (
    command: "setAnnotationName" | "setAnnotationDescription",
    value: string,
  ) => {
    sendMessage("store", command, [value]).catch((error) =>
      handleGenericError(error as Error, "Could not update the layer registration."),
    );
  };

  // Saves the landmarks and shows another moving layer in the right view. If saving fails,
  // the current layer stays.
  const switchMovingLayer = async (layerName: string) => {
    if (layerName === movingLayerName || overlayStatus != null) {
      return;
    }
    setSwitchTargetLayerName(layerName);
    try {
      await flushAndStopSync();
      await sendMessage("store", "save");
    } catch (error) {
      handleGenericError(
        error as Error,
        `Could not save the landmarks, so "${layerName}" is not shown. Please try again.`,
      );
      resumeSync();
      setSwitchTargetLayerName(null);
      return;
    }
    allowLeaving();
    onSwitchMovingLayer(layerName);
  };

  // Copies the fixed layer landmarks of another moving layer into the left view, as a start
  // for the active moving layer. They keep their pair ids, so the right view asks for their
  // partners one by one.
  const copyLandmarksOf = async (sourceLayerName: string) => {
    const nmlString = inactivePairs?.get(sourceLayerName)?.fixedSideNmlString;
    if (nmlString == null) {
      return;
    }
    try {
      await sendMessage("fixed", "importLandmarks", [nmlString]);
    } catch (error) {
      handleGenericError(error as Error, "Could not copy the landmarks.");
    }
  };

  // A reloaded iframe has lost its state: a worker its landmarks, the store iframe its
  // unsaved changes. Restarting loads all iframes again and imports the stored landmarks.
  async function restartAfterReload(reloadedRole: IframeRole) {
    if (isRestarting) {
      return;
    }
    setIsRestarting(true);
    stopSync();
    Toast.warning(
      "A view was reloaded or left, so the layer registration view is restarted. The stored landmarks are kept.",
    );
    if (reloadedRole !== "store") {
      // Saves the landmarks that were synced before the reload.
      await sendMessage("store", "save").catch((error) => console.error(error));
    }
    onRestart();
  }

  function handleWorkerCommand(side: Side, command: LayerRegistrationCommand) {
    switch (command) {
      case "toggleTransform":
        viewSettings.toggleTransform(side);
        break;
      case "toggleLandmarkPanel":
        setIsLandmarkPanelOpen((isOpen) => !isOpen);
        break;
      case "toggleOtherLayer":
        viewSettings.toggleOtherLayer(side);
        break;
      case "syncOtherView":
        syncOtherViewTo(side);
        break;
      default:
        command satisfies never;
    }
  }

  return (
    <Splitter
      className={classnames("layer-registration-workspace", {
        "is-landmark-panel-closed": !isLandmarkPanelOpen,
      })}
      onResize={([, panelWidth]) => {
        if (isLandmarkPanelOpen) {
          setLandmarkPanelWidth(panelWidth);
        }
      }}
    >
      {/* Both panels are always rendered, because the iframes would reload if their position
      in the tree changed. A closed landmark panel has a width of 0. The landmark panel is on
      the right, where the viewer normally shows the skeleton tab (it's hidden in workers). */}
      <Splitter.Panel>
        <LayerRegistrationWorkerFrames
          dataset={dataset}
          layerNames={layerNames}
          landmarkAnnotationId={landmarkAnnotation.id}
          iframesRef={iframesRef}
          onIframeLoad={handleIframeLoad}
          openPairIds={openPairIds}
          overlayStatus={overlayStatus}
          switchTargetLayerName={switchTargetLayerName}
        />
      </Splitter.Panel>
      <Splitter.Panel
        className="landmark-panel"
        size={isLandmarkPanelOpen ? landmarkPanelWidth : 0}
        min={isLandmarkPanelOpen ? MIN_LANDMARK_PANEL_WIDTH : 0}
        max={MAX_LANDMARK_PANEL_WIDTH}
        resizable={isLandmarkPanelOpen}
      >
        {isLandmarkPanelOpen ? (
          <LayerRegistrationLandmarkPanel
            layerRegistrationListUrl={getLayerRegistrationListUrl(dataset)}
            voxelSize={dataset.dataSource.scale}
            layerNames={layerNames}
            landmarks={landmarks}
            annotationName={annotationName}
            annotationDescription={annotationDescription}
            onChangeAnnotationName={(name) => {
              setAnnotationName(name);
              updateAnnotation("setAnnotationName", name);
            }}
            onChangeAnnotationDescription={(description) => {
              setAnnotationDescription(description);
              updateAnnotation("setAnnotationDescription", description);
            }}
            estimation={estimation}
            viewSettings={viewSettings}
            canApplyTransformToDataset={dataset.isEditable}
            onApplyTransformToDataset={applyTransforms}
            movingLayerRows={movingLayerRows}
            onSelectMovingLayer={switchMovingLayer}
            copySources={syncStatus === "ready" ? getCopySources(inactivePairs) : []}
            onCopyLandmarks={copyLandmarksOf}
            onSelectPair={selectPair}
            onDeletePair={deletePair}
            onDownloadLandmarks={downloadLandmarks}
            saveState={saveState}
            onSave={forceSave}
          />
        ) : null}
      </Splitter.Panel>
    </Splitter>
  );
}
