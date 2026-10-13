import { App, Button, Flex, Result, Spin, Splitter, Typography } from "antd";
import classnames from "classnames";
import Toast from "libs/toast";
import { pluralize } from "libs/utils";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useBlocker } from "react-router";
import type { APIAnnotation, APIDataset } from "types/api_types";
import { Identity4x4, type Vector3 } from "viewer/constants";
import { getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import {
  getTransformPointUnscaledFn,
  invertTransform,
  type Transform,
} from "viewer/model/helpers/transformation_helpers";
import {
  applyTransformsToDataset,
  type EstimatedTransform,
  estimateMovingToFixedTransform,
  getAppliedState,
  getCompleteLandmarkPairs,
  getLandmarkColor,
  getLandmarkPairInfo,
  getLandmarkTreeName,
  getLayerPairTransformEstimate,
  getLayerTransformsInDataset,
  getOverlayLayerColors,
  type Landmark,
  type LandmarkPair,
  type LayerNames,
  OTHER_SIDE,
  SIDES,
  type Side,
} from "./layer_registration_helpers";
import {
  getBigWarpCsvFileName,
  getLandmarksAsBigWarpCsv,
  getNmlFileName,
  type LandmarkExportFormat,
  saveTextFile,
} from "./layer_registration_landmark_export";
import {
  LayerRegistrationLandmarkPanel,
  rgbColorString,
} from "./layer_registration_landmark_panel";
import type { CopySource, MovingLayerRow } from "./layer_registration_moving_layer_list";
import {
  getLayerRegistrationListUrl,
  getLayerRegistrationStoreUrl,
  getLayerRegistrationWorkerUrl,
  type LayerRegistrationCommand,
  type LayerRegistrationViewState,
  type SaveState,
} from "./layer_registration_protocol";
import { type IframeRole, useIframeBridge } from "./use_layer_registration_iframe_bridge";
import { useInactivePairs } from "./use_layer_registration_inactive_pairs";
import { type LandmarkSyncStatus, useLandmarkSync } from "./use_layer_registration_landmark_sync";

const DEFAULT_LANDMARK_PANEL_WIDTH = 380;
const MIN_LANDMARK_PANEL_WIDTH = 260;
const MAX_LANDMARK_PANEL_WIDTH = "70%";
// Longer than usual, so that there is time to click the link in the toast.
const APPLIED_TOAST_TIMEOUT_MS = 15_000;

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

type OverlayStatus = Exclude<LandmarkSyncStatus, "ready"> | "restarting" | "switching";

export function LayerRegistrationWorkspace({
  dataset,
  layerNames,
  movingLayerNames,
  onSwitchMovingLayer,
  landmarkAnnotation,
  onRestart,
}: Props) {
  const { modal } = App.useApp();
  const [isLandmarkPanelOpen, setIsLandmarkPanelOpen] = useState(true);
  const [landmarkPanelWidth, setLandmarkPanelWidth] = useState(DEFAULT_LANDMARK_PANEL_WIDTH);
  const [annotationName, setAnnotationName] = useState(landmarkAnnotation.name);
  const [annotationDescription, setAnnotationDescription] = useState(
    landmarkAnnotation.description,
  );
  // Whether a worker also shows the layer of the other worker. Each worker initially shows
  // only its own layer (see applyLayerRegistrationWorkerSettings).
  const [isOtherLayerVisible, setIsOtherLayerVisible] = useState<Record<Side, boolean>>({
    fixed: false,
    moving: false,
  });
  // Whether a worker shows the other layer transformed onto its own layer or untransformed.
  const [isTransformShown, setIsTransformShown] = useState<Record<Side, boolean>>({
    fixed: true,
    moving: true,
  });
  // See getOverlayLayerColors.
  const [isColorOverlayEnabled, setIsColorOverlayEnabled] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  // Set while the landmarks are saved before switching to this moving layer.
  const [switchTargetLayerName, setSwitchTargetLayerName] = useState<string | null>(null);
  // Set right before this page navigates on purpose, so that the blocker below doesn't ask.
  const isLeavingRef = useRef(false);
  // Whether the workers showed the other layer for a transform yet, see the effect below.
  const hasShownTransformRef = useRef(false);
  // The effects below depend on the names, not on the object, which is created anew on every
  // render.
  const { fixed: fixedLayerName, moving: movingLayerName } = layerNames;
  const overlayColors = useMemo(
    () => getOverlayLayerColors(dataset, { fixed: fixedLayerName, moving: movingLayerName }),
    [dataset, fixedLayerName, movingLayerName],
  );

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
  const inactiveMovingLayerNames = movingLayerNames.filter((name) => name !== movingLayerName);
  const voxelSizeFactor = dataset.dataSource.scale.factor;
  const inactivePairs = useInactivePairs(
    sendMessage,
    fixedLayerName,
    inactiveMovingLayerNames,
    voxelSizeFactor,
  );
  const overlayStatus: OverlayStatus | null = isRestarting
    ? "restarting"
    : switchTargetLayerName != null
      ? "switching"
      : syncStatus !== "ready"
        ? syncStatus
        : null;
  // Landmarks that changed in a worker but are not in the layer registration annotation yet are
  // unsaved, too.
  const saveState: SaveState =
    storeSaveState === "saved" && hasUnsyncedLandmarks ? "unsaved" : storeSaveState;
  const hasUnsavedChanges = saveState !== "saved";
  // Estimating the transform is cheap, so it always matches the current landmarks.
  // Only the active pair is estimated again, the inactive pairs can't change.
  const activePairEstimate = useMemo(
    () => getLayerPairTransformEstimate(landmarks, voxelSizeFactor),
    [landmarks, voxelSizeFactor],
  );
  const { estimation } = activePairEstimate;
  const estimatedTransform: EstimatedTransform | null =
    "transform" in estimation
      ? {
          movingToFixedTransform: estimation.transform,
          usedCopiesInNextSlice: estimation.usedCopiesInNextSlice,
        }
      : null;
  const movingToFixedTransform = estimatedTransform?.movingToFixedTransform ?? null;
  const isTransformAvailable = movingToFixedTransform != null;
  // The transforms of the layers in the dataset, updated when the estimated transforms are
  // applied.
  const [layerTransformsInDataset, setLayerTransformsInDataset] = useState(() =>
    getLayerTransformsInDataset(dataset.dataSource.dataLayers),
  );
  const getAppliedStateOfLayer = (movingLayer: string, layerEstimation: typeof estimation) =>
    getAppliedState(
      layerEstimation,
      layerTransformsInDataset[fixedLayerName],
      layerTransformsInDataset[movingLayer],
    );
  const isAppliedToDataset = getAppliedStateOfLayer(movingLayerName, estimation) === "applied";
  const movingLayerRows: MovingLayerRow[] = movingLayerNames.map((layerName) => {
    const pairEstimate =
      layerName === movingLayerName ? activePairEstimate : inactivePairs?.get(layerName)?.estimate;
    return pairEstimate != null
      ? {
          layerName,
          completePairCount: pairEstimate.completePairCount,
          meanResidual: pairEstimate.meanResidual,
          appliedState: getAppliedStateOfLayer(layerName, pairEstimate.estimation),
        }
      : // Still loading, or the landmarks could not be read.
        { layerName, isLoading: inactivePairs == null };
  });
  // The inactive pairs whose fixed layer landmarks can be copied to the active pair, the ones
  // with the most landmarks first.
  const copySources: CopySource[] = Array.from(inactivePairs ?? [])
    .flatMap(([layerName, pair]) =>
      pair.fixedSideNmlString != null
        ? [{ layerName, landmarkCount: pair.estimate.landmarks.fixed.length }]
        : [],
    )
    .toSorted((a, b) => b.landmarkCount - a.landmarkCount);
  const getOpenPairIds = (side: Side) =>
    overlayStatus == null ? getLandmarkPairInfo(landmarks, side).openPairIds : [];

  // Asks before leaving the page while the layer registration annotation has unsaved changes.
  // This can't be left to the store iframe, although it has the normal "unsaved changes"
  // check of the viewer: browsers only show this dialog for a frame that the user interacted
  // with, and nobody interacts with the hidden store iframe. The user's clicks in the
  // workers count as interaction with this page, though.
  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need returnValue to be set to show the dialog.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);
  // Navigation within the app (e.g. with the browser's back button) doesn't fire
  // "beforeunload".
  const blocker = useBlocker(
    () =>
      !isLeavingRef.current &&
      hasUnsavedChanges &&
      !confirm("The landmarks have unsaved changes that may be lost. Leave anyway?"),
  );
  useEffect(() => {
    // The user chose to stay, so the next navigation must be checked again.
    if (blocker.state === "blocked") {
      blocker.reset();
    }
  }, [blocker]);

  // Shows layer B transformed in worker A and layer A transformed (inversely) in worker B, in
  // each worker only if the transform is shown there.
  useEffect(() => {
    const otherLayerNames = { fixed: movingLayerName, moving: fixedLayerName };
    const matrices = {
      fixed: movingToFixedTransform?.affineMatrix,
      moving: movingToFixedTransform?.affineMatrixInv,
    };
    for (const side of SIDES) {
      const matrix = isTransformShown[side] ? matrices[side] : null;
      sendMessage(side, "setAffineLayerTransforms", [otherLayerNames[side], matrix ?? Identity4x4]);
    }
  }, [sendMessage, fixedLayerName, movingLayerName, movingToFixedTransform, isTransformShown]);

  // The left worker also gets the transforms of the inactive moving layers. They are hidden
  // there, but the user can show them in the layer settings to see all layers transformed.
  useEffect(() => {
    for (const [layerName, pair] of inactivePairs ?? []) {
      const { estimation: layerEstimation } = pair.estimate;
      const matrix = "transform" in layerEstimation ? layerEstimation.transform.affineMatrix : null;
      sendMessage("fixed", "setAffineLayerTransforms", [layerName, matrix ?? Identity4x4]);
    }
  }, [sendMessage, inactivePairs]);

  // The workers show this state in their navbars.
  useEffect(() => {
    for (const side of SIDES) {
      const viewState: LayerRegistrationViewState = {
        isTransformShown: isTransformShown[side],
        isTransformAvailable,
        isLandmarkPanelOpen,
      };
      sendMessage(side, "setLayerRegistrationViewState", [viewState]);
    }
  }, [sendMessage, isTransformShown, isTransformAvailable, isLandmarkPanelOpen]);

  // While a worker shows both layers and the color overlay is enabled, the layers are colored
  // so that mismatches stand out. Otherwise, the workers keep the original colors.
  useEffect(() => {
    if (overlayColors == null) {
      return;
    }
    for (const side of SIDES) {
      const colors = isColorOverlayEnabled && isOtherLayerVisible[side] ? overlayColors : null;
      sendMessage(side, "setOverlayLayerColors", [colors]);
    }
  }, [sendMessage, overlayColors, isColorOverlayEnabled, isOtherLayerVisible]);

  const setOtherLayerVisibility = (side: Side, isVisible: boolean) => {
    setIsOtherLayerVisible((previous) => ({ ...previous, [side]: isVisible }));
    sendMessage(side, "setLayerVisibility", [layerNames[OTHER_SIDE[side]], isVisible]);
  };

  const toggleOtherLayer = (side: Side) => {
    setOtherLayerVisibility(side, !isOtherLayerVisible[side]);
  };

  // The first transform (e.g. right after loading) shows the other layer in both workers, so
  // that the user sees the result. Afterwards, the visibility is left to the user.
  const showOtherLayersForFirstTransform = useEffectEvent(() => {
    if (!hasShownTransformRef.current) {
      hasShownTransformRef.current = true;
      for (const side of SIDES) {
        setOtherLayerVisibility(side, true);
      }
    }
  });
  useEffect(() => {
    if (isTransformAvailable) {
      showOtherLayersForFirstTransform();
    }
  }, [isTransformAvailable]);

  // Switches a worker between showing the other layer transformed and untransformed. The transform
  // only moves the other layer, so that layer is shown, too.
  const toggleTransform = (side: Side) => {
    if ("errorMessage" in estimation) {
      Toast.info(estimation.errorMessage);
      return;
    }
    const isShown = !isTransformShown[side];
    setIsTransformShown((previous) => ({ ...previous, [side]: isShown }));
    if (isShown && !isOtherLayerVisible[side]) {
      setOtherLayerVisibility(side, true);
    }
  };

  const focusPosition = (side: Side, position: Vector3) => {
    sendMessage(side, "centerPositionAnimated", [position]);
  };

  // Makes the landmarks of the pair the active nodes, which highlights them, and moves both
  // views to them.
  const selectPair = (pair: LandmarkPair) => {
    for (const side of SIDES) {
      const landmark = pair.landmarks[side];
      if (landmark != null) {
        sendMessage(side, "setActiveNode", [landmark.nodeId, false, true]);
        focusPosition(side, landmark.position);
      }
    }
  };

  // Deletes both landmarks of the pair, so that the following pairs keep their partners.
  // Deleting a landmark in one view only would shift them.
  const deletePair = async (pair: LandmarkPair) => {
    try {
      for (const side of SIDES) {
        const landmark = pair.landmarks[side];
        if (landmark == null) {
          continue;
        }
        // Each click creates a tree with one node. Deleting only the node would leave an empty
        // tree behind, which shifts the tree ids that the colors depend on.
        const isOnlyLandmarkOfTree =
          landmarks[side].filter(({ treeId }) => treeId === landmark.treeId).length === 1;
        await (isOnlyLandmarkOfTree
          ? sendMessage(side, "deleteTree", [landmark.treeId])
          : sendMessage(side, "deleteNode", [landmark.nodeId, landmark.treeId]));
      }
    } catch (error) {
      console.error(error);
      Toast.error("Could not delete the landmark pair.");
    }
  };

  // The shortcuts go to the view that has the keyboard focus. Clicking into a view to focus
  // it would place a landmark, so a view gets the focus when the mouse enters it instead.
  const focusWorker = (side: Side) => {
    if (!isTextInputFocused()) {
      iframesRef.current[side]?.contentWindow?.focus();
    }
  };

  // Moves the other worker to the position that corresponds to the position of this one.
  const syncOtherViewTo = async (side: Side) => {
    if ("errorMessage" in estimation) {
      Toast.info(estimation.errorMessage);
      return;
    }
    const position = await sendMessage<Vector3>(side, "getCameraPosition");
    const transformToOtherSide =
      side === "fixed" ? invertTransform(estimation.transform) : estimation.transform;
    focusPosition(OTHER_SIDE[side], getTransformPointUnscaledFn(transformToOtherSide)(position));
  };

  // Downloads the complete landmark pairs of the workers in a format that the dataset
  // composition wizard can import. Landmarks without a partner are left out.
  const downloadLandmarks = async (format: LandmarkExportFormat) => {
    try {
      const currentLandmarks = await fetchLandmarks();
      const pairs = getCompleteLandmarkPairs(currentLandmarks);
      if (format === "csv") {
        saveTextFile(getLandmarksAsBigWarpCsv(pairs), getBigWarpCsvFileName(layerNames));
      } else {
        // Both files are read before saving any, so that a failure doesn't leave only one.
        const [fixedNmlString, movingNmlString] = await Promise.all(
          SIDES.map((side) =>
            sendMessage<string>(side, "exportLandmarkPairsAsNml", [
              pairs.map((pair) => [pair.pairId, pair[side].treeId]),
            ]),
          ),
        );
        saveTextFile(fixedNmlString, getNmlFileName(layerNames, "fixed"));
        saveTextFile(movingNmlString, getNmlFileName(layerNames, "moving"));
      }
      const leftOutCount =
        currentLandmarks.fixed.length + currentLandmarks.moving.length - 2 * pairs.length;
      if (leftOutCount > 0) {
        Toast.info(
          `Only complete pairs were downloaded. ${leftOutCount} ${pluralize("landmark", leftOutCount)} without a partner ${leftOutCount === 1 ? "was" : "were"} left out.`,
        );
      }
    } catch (error) {
      console.error(error);
      Toast.error("Could not download the landmarks.");
    }
  };

  // Saves the landmark annotation right away instead of waiting for its auto-save.
  // Reloading this page closes all iframes at once, which may interrupt the auto-save. The
  // save button in the panel shows when the annotation is saved.
  const forceSave = async () => {
    try {
      await sendMessage("store", "save");
    } catch (error) {
      console.error(error);
      Toast.error("Could not save the landmarks.");
    }
  };

  // Edited here, but saved by the store iframe, which has the layer registration annotation open.
  const updateAnnotation = (
    command: "setAnnotationName" | "setAnnotationDescription",
    value: string,
  ) => {
    sendMessage("store", command, [value]).catch((error) => {
      console.error(error);
      Toast.error("Could not update the layer registration.");
    });
  };

  // Applies the estimated transforms of all moving layers that have enough landmark pairs to the
  // dataset. The synced landmarks may miss a landmark that was placed right before, so the
  // transform of the active pair is estimated again from the current landmarks of the workers.
  const applyTransforms = async () => {
    if (inactivePairs == null) {
      Toast.info("The landmarks of the other layers are still loading. Please try again.");
      return;
    }
    let currentLandmarks: Record<Side, Landmark[]>;
    try {
      currentLandmarks = await fetchLandmarks();
    } catch (error) {
      console.error(error);
      Toast.error("Could not read the landmarks of the views.");
      return;
    }
    const estimations = new Map(
      movingLayerNames.map((layerName) => [
        layerName,
        layerName === movingLayerName
          ? estimateMovingToFixedTransform(currentLandmarks)
          : inactivePairs.get(layerName)?.estimate.estimation,
      ]),
    );
    const transformsByMovingLayer = new Map<string, Transform>();
    for (const [layerName, layerEstimation] of estimations) {
      if (layerEstimation != null && "transform" in layerEstimation) {
        transformsByMovingLayer.set(layerName, layerEstimation.transform);
      }
    }
    if (transformsByMovingLayer.size === 0) {
      Toast.warning("No layer has enough landmark pairs for a transform yet.");
      return;
    }
    const getChangeDescription = (layerName: string) => {
      const layerEstimation = estimations.get(layerName);
      if (layerEstimation == null || !("transform" in layerEstimation)) {
        return "stays unchanged (not enough landmark pairs)";
      }
      return getAppliedStateOfLayer(layerName, layerEstimation) === "applied"
        ? "already uses its transform"
        : "gets its new transform";
    };
    const fixedLayerHasTransforms = (layerTransformsInDataset[fixedLayerName] ?? []).length > 0;
    modal.confirm({
      title: "Apply the estimated transforms to the dataset?",
      okText: "Apply",
      content: (
        <>
          <ul>
            {movingLayerNames.map((layerName) => (
              <li key={layerName}>
                "{layerName}" {getChangeDescription(layerName)}
              </li>
            ))}
          </ul>
          <p>Applying replaces the transforms that a layer currently has in the dataset.</p>
          {fixedLayerHasTransforms ? (
            <p>
              "{fixedLayerName}" has transforms itself. The applied transforms build on them, so
              changing the transforms of "{fixedLayerName}" later makes them outdated.
            </p>
          ) : null}
        </>
      ),
      onOk: async () => {
        try {
          setLayerTransformsInDataset(
            await applyTransformsToDataset(dataset.id, fixedLayerName, transformsByMovingLayer),
          );
          Toast.success(
            <>
              Applied the transforms to the dataset.{" "}
              <a href={getViewDatasetURL(dataset)} target="_blank" rel="noopener noreferrer">
                Open the dataset
              </a>{" "}
              to see the result.
            </>,
            { timeout: APPLIED_TOAST_TIMEOUT_MS },
          );
        } catch (error) {
          console.error(error);
          Toast.error("Could not apply the transforms to the dataset.");
        }
      },
    });
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
      console.error(error);
      Toast.error(
        `Could not save the landmarks, so "${layerName}" is not shown. Please try again.`,
      );
      resumeSync();
      setSwitchTargetLayerName(null);
      return;
    }
    isLeavingRef.current = true;
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
      console.error(error);
      Toast.error("Could not copy the landmarks.");
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
        toggleTransform(side);
        break;
      case "toggleLandmarkPanel":
        setIsLandmarkPanelOpen((isOpen) => !isOpen);
        break;
      case "toggleOtherLayer":
        toggleOtherLayer(side);
        break;
      case "syncOtherView":
        syncOtherViewTo(side);
        break;
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
        <Flex style={{ height: "100%", position: "relative" }}>
          {SIDES.map((side) => (
            <div key={side} className="layer-registration-worker">
              <iframe
                ref={(element) => {
                  iframesRef.current[side] = element;
                }}
                title={`${side === "fixed" ? "Fixed" : "Moving"} layer (${layerNames[side]})`}
                src={getLayerRegistrationWorkerUrl(dataset, layerNames[side], side === "fixed")}
                onLoad={() => handleIframeLoad(side)}
                onMouseEnter={() => focusWorker(side)}
              />
              <NextLandmarkHint openPairIds={getOpenPairIds(side)} />
            </div>
          ))}
          <iframe
            ref={(element) => {
              iframesRef.current.store = element;
            }}
            title="Layer registration annotation"
            style={{ display: "none" }}
            src={getLayerRegistrationStoreUrl(landmarkAnnotation.id)}
            onLoad={() => handleIframeLoad("store")}
          />
          {overlayStatus != null ? (
            <WorkspaceOverlay
              status={overlayStatus}
              switchTargetLayerName={switchTargetLayerName}
            />
          ) : null}
        </Flex>
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
            estimatedTransform={estimatedTransform}
            estimationErrorMessage={"errorMessage" in estimation ? estimation.errorMessage : null}
            isOtherLayerVisible={isOtherLayerVisible}
            onToggleOtherLayer={toggleOtherLayer}
            isTransformShown={isTransformShown}
            onToggleTransform={toggleTransform}
            canColorOverlay={overlayColors != null}
            isColorOverlayEnabled={isColorOverlayEnabled}
            onColorOverlayChange={setIsColorOverlayEnabled}
            canApplyTransformToDataset={dataset.isEditable}
            onApplyTransformToDataset={applyTransforms}
            isAppliedToDataset={isAppliedToDataset}
            movingLayerRows={movingLayerRows}
            onSelectMovingLayer={switchMovingLayer}
            copySources={syncStatus === "ready" ? copySources : []}
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

// The element that has the keyboard focus, also if it is inside one of the iframes.
function getFocusedElement(): Element | null {
  let element = document.activeElement;
  while (element instanceof HTMLIFrameElement && element.contentDocument != null) {
    element = element.contentDocument.activeElement;
  }
  return element;
}

function isTextInputFocused(): boolean {
  const element = getFocusedElement();
  return (
    element != null &&
    (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) ||
      (element as HTMLElement).isContentEditable)
  );
}

// Shown in a view that misses landmarks of the other view, so that the user sees which pair
// the next click completes (see getNextLandmarkPairId).
function NextLandmarkHint({ openPairIds }: { openPairIds: number[] }) {
  if (openPairIds.length === 0) {
    return null;
  }
  const [nextPairId] = openPairIds;
  return (
    <div className="layer-registration-next-landmark-hint">
      <span
        className="landmark-color"
        style={{ background: rgbColorString(getLandmarkColor(nextPairId)) }}
      />
      {getLandmarkTreeName(nextPairId)}: click the matching spot in this view.
      {openPairIds.length > 1
        ? ` ${openPairIds.length} landmarks still need a partner here.`
        : null}
    </div>
  );
}

const OVERLAY_TEXTS: Record<Exclude<OverlayStatus, "failed">, string> = {
  loading: "Loading the landmarks…",
  restarting: "Restarting the layer registration view…",
  switching: "Saving the landmarks…",
};

// Covers the workers until the stored landmarks were imported, while restarting and while
// switching to another moving layer. A landmark placed before the import could get the pair
// id of a stored landmark.
function WorkspaceOverlay({
  status,
  switchTargetLayerName,
}: {
  status: OverlayStatus;
  switchTargetLayerName: string | null;
}) {
  return (
    <Flex className="layer-registration-overlay" vertical justify="center" align="center" gap={8}>
      {status !== "failed" ? (
        <>
          <Spin size="large" />
          <Typography.Text>
            {status === "switching" && switchTargetLayerName != null
              ? `Switching to ${switchTargetLayerName}…`
              : OVERLAY_TEXTS[status]}
          </Typography.Text>
        </>
      ) : (
        <Result
          status="error"
          title="Could not load the stored landmarks"
          subTitle="New landmarks can't be saved. Reload the page to try again."
          extra={
            <Button type="primary" onClick={() => location.reload()}>
              Reload
            </Button>
          }
        />
      )}
    </Flex>
  );
}
