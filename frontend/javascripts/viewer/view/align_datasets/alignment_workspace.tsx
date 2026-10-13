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
  type Alignment,
  applyAlignmentToDataset,
  estimateTransformBtoA,
  getCompleteLandmarkPairs,
  getLandmarkColor,
  getLandmarkPairInfo,
  getLandmarkTreeName,
  getOverlayLayerColors,
  isAlignmentAppliedToDataset,
  type Landmark,
  type LandmarkPair,
  type LayerNames,
  OTHER_SIDE,
  SIDES,
  type Side,
} from "./alignment_helpers";
import {
  type AlignmentViewState,
  type BigWarpCommand,
  getAlignmentSelectionUrl,
  getBigWarpStoreUrl,
  getBigWarpWorkerUrl,
  type SaveState,
} from "./bigwarp_protocol";
import {
  getBigWarpCsvFileName,
  getLandmarksAsBigWarpCsv,
  getNmlFileName,
  type LandmarkExportFormat,
  saveTextFile,
} from "./landmark_export";
import { LandmarkPanel, rgbColorString } from "./landmark_panel";
import { type IframeRole, useIframeBridge } from "./use_iframe_bridge";
import { type LandmarkSyncStatus, useLandmarkSync } from "./use_landmark_sync";

const DEFAULT_LANDMARK_PANEL_WIDTH = 380;
const MIN_LANDMARK_PANEL_WIDTH = 260;
const MAX_LANDMARK_PANEL_WIDTH = "70%";
// Longer than usual, so that there is time to click the link in the toast.
const APPLIED_TOAST_TIMEOUT_MS = 15_000;

type Props = {
  dataset: APIDataset;
  layerNames: LayerNames;
  landmarkAnnotation: APIAnnotation;
  // Called after one of the iframes loaded a new page, e.g. because it was reloaded (see
  // restartAfterReload). The parent must then mount the workspace anew, with fresh iframes.
  onRestart: () => void;
};

type OverlayStatus = Exclude<LandmarkSyncStatus, "ready"> | "restarting";

export function AlignmentWorkspace({ dataset, layerNames, landmarkAnnotation, onRestart }: Props) {
  const { modal } = App.useApp();
  const [isLandmarkPanelOpen, setIsLandmarkPanelOpen] = useState(true);
  const [landmarkPanelWidth, setLandmarkPanelWidth] = useState(DEFAULT_LANDMARK_PANEL_WIDTH);
  const [annotationName, setAnnotationName] = useState(landmarkAnnotation.name);
  const [annotationDescription, setAnnotationDescription] = useState(
    landmarkAnnotation.description,
  );
  // Whether a worker also shows the layer of the other worker. Each worker initially shows
  // only its own layer (see applyBigWarpWorkerSettings).
  const [isOtherLayerVisible, setIsOtherLayerVisible] = useState<Record<Side, boolean>>({
    A: false,
    B: false,
  });
  // Whether a worker shows the other layer aligned to its own layer or untransformed.
  const [isTransformShown, setIsTransformShown] = useState<Record<Side, boolean>>({
    A: true,
    B: true,
  });
  // See getOverlayLayerColors.
  const [isColorOverlayEnabled, setIsColorOverlayEnabled] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  // Whether the workers showed the other layer for an alignment yet, see the effect below.
  const hasShownAlignmentRef = useRef(false);
  // The effects below depend on the names, not on the object, which is created anew on every
  // render.
  const { A: fixedLayerName, B: movingLayerName } = layerNames;
  const overlayColors = useMemo(
    () => getOverlayLayerColors(dataset, { A: fixedLayerName, B: movingLayerName }),
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
  } = useLandmarkSync(sendMessage, layerNames);
  const overlayStatus: OverlayStatus | null = isRestarting
    ? "restarting"
    : syncStatus !== "ready"
      ? syncStatus
      : null;
  // Landmarks that changed in a worker but are not in the alignment annotation yet are unsaved,
  // too.
  const saveState: SaveState =
    storeSaveState === "saved" && hasUnsyncedLandmarks ? "unsaved" : storeSaveState;
  const hasUnsavedChanges = saveState !== "saved";
  // Estimating the transform is cheap, so the alignment always matches the current landmarks.
  const estimation = useMemo(() => estimateTransformBtoA(landmarks), [landmarks]);
  const alignment: Alignment | null =
    "transform" in estimation
      ? {
          transformBtoA: estimation.transform,
          usedCopiesInNextSlice: estimation.usedCopiesInNextSlice,
        }
      : null;
  const transformBtoA = alignment?.transformBtoA ?? null;
  const isAlignmentAvailable = transformBtoA != null;
  const getDatasetLayerTransforms = (layerName: string) =>
    dataset.dataSource.dataLayers.find((layer) => layer.name === layerName)
      ?.coordinateTransformations;
  // The transforms of the moving layer in the dataset, updated when the alignment is applied.
  const [movingLayerTransformsInDataset, setMovingLayerTransformsInDataset] = useState(() =>
    getDatasetLayerTransforms(movingLayerName),
  );
  const isAppliedToDataset =
    transformBtoA != null &&
    isAlignmentAppliedToDataset(
      transformBtoA,
      getDatasetLayerTransforms(fixedLayerName),
      movingLayerTransformsInDataset,
    );
  const getOpenPairIds = (side: Side) =>
    overlayStatus == null ? getLandmarkPairInfo(landmarks, side).openPairIds : [];

  // Asks before leaving the page while the alignment annotation has unsaved changes.
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
      hasUnsavedChanges &&
      !confirm("The landmark annotation has unsaved changes that may be lost. Leave anyway?"),
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
    const otherLayerNames = { A: movingLayerName, B: fixedLayerName };
    const matrices = { A: transformBtoA?.affineMatrix, B: transformBtoA?.affineMatrixInv };
    for (const side of SIDES) {
      const matrix = isTransformShown[side] ? matrices[side] : null;
      sendMessage(side, "setAffineLayerTransforms", [otherLayerNames[side], matrix ?? Identity4x4]);
    }
  }, [sendMessage, fixedLayerName, movingLayerName, transformBtoA, isTransformShown]);

  // The workers show this state in their navbars.
  useEffect(() => {
    for (const side of SIDES) {
      const viewState: AlignmentViewState = {
        isTransformShown: isTransformShown[side],
        isAlignmentAvailable,
        isLandmarkPanelOpen,
      };
      sendMessage(side, "setAlignmentViewState", [viewState]);
    }
  }, [sendMessage, isTransformShown, isAlignmentAvailable, isLandmarkPanelOpen]);

  // While a worker shows both layers and the color overlay is enabled, the layers are colored
  // so that misalignments stand out. Otherwise, the workers keep the original colors.
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

  // The first alignment (e.g. right after loading) shows the other layer in both workers, so
  // that the user sees the result. Afterwards, the visibility is left to the user.
  const showOtherLayersForFirstAlignment = useEffectEvent(() => {
    if (!hasShownAlignmentRef.current) {
      hasShownAlignmentRef.current = true;
      for (const side of SIDES) {
        setOtherLayerVisibility(side, true);
      }
    }
  });
  useEffect(() => {
    if (isAlignmentAvailable) {
      showOtherLayersForFirstAlignment();
    }
  }, [isAlignmentAvailable]);

  // Switches a worker between showing the other layer aligned and untransformed. The transform
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
    if (transformBtoA == null) {
      Toast.info('Align the layers first (press "t") before syncing positions between views.');
      return;
    }
    const position = await sendMessage<Vector3>(side, "getCameraPosition");
    const transformToOtherSide = side === "A" ? invertTransform(transformBtoA) : transformBtoA;
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
        const [nmlStringA, nmlStringB] = await Promise.all(
          SIDES.map((side) =>
            sendMessage<string>(side, "exportLandmarkPairsAsNml", [
              pairs.map((pair) => [pair.pairId, pair[side].treeId]),
            ]),
          ),
        );
        saveTextFile(nmlStringA, getNmlFileName(layerNames, "A"));
        saveTextFile(nmlStringB, getNmlFileName(layerNames, "B"));
      }
      const leftOutCount = currentLandmarks.A.length + currentLandmarks.B.length - 2 * pairs.length;
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
      Toast.error("Could not save the landmark annotation.");
    }
  };

  // Edited here, but saved by the store iframe, which has the alignment annotation open.
  const updateAnnotation = (
    command: "setAnnotationName" | "setAnnotationDescription",
    value: string,
  ) => {
    sendMessage("store", command, [value]).catch((error) => {
      console.error(error);
      Toast.error("Could not update the landmark annotation.");
    });
  };

  // The synced landmarks may miss a landmark that was placed right before, so the transform is
  // estimated again from the current landmarks of the workers.
  const applyCurrentAlignment = async () => {
    let currentLandmarks: Record<Side, Landmark[]>;
    try {
      currentLandmarks = await fetchLandmarks();
    } catch (error) {
      console.error(error);
      Toast.error("Could not read the landmarks of the views.");
      return;
    }
    const result = estimateTransformBtoA(currentLandmarks);
    if ("errorMessage" in result) {
      Toast.warning(result.errorMessage);
      return;
    }
    applyAlignment(result.transform);
  };

  const applyAlignment = (transform: Transform) => {
    const { A: fixedLayerName, B: movingLayerName } = layerNames;
    const fixedLayer = dataset.dataSource.dataLayers.find((layer) => layer.name === fixedLayerName);
    const fixedLayerHasTransforms = (fixedLayer?.coordinateTransformations ?? []).length > 0;
    modal.confirm({
      title: `Apply the alignment to "${movingLayerName}" in the dataset?`,
      okText: "Apply",
      content: (
        <>
          <p>This replaces the transforms that "{movingLayerName}" currently has in the dataset.</p>
          {fixedLayerHasTransforms ? (
            <p>
              "{fixedLayerName}" has transforms itself. The stored alignment builds on them, so
              changing the transforms of "{fixedLayerName}" later makes this alignment outdated.
            </p>
          ) : null}
        </>
      ),
      onOk: async () => {
        try {
          setMovingLayerTransformsInDataset(
            await applyAlignmentToDataset(dataset.id, layerNames, transform),
          );
          Toast.success(
            <>
              Applied the alignment to "{movingLayerName}" in the dataset.{" "}
              <a href={getViewDatasetURL(dataset)} target="_blank" rel="noopener noreferrer">
                Open the dataset
              </a>{" "}
              to see the result.
            </>,
            { timeout: APPLIED_TOAST_TIMEOUT_MS },
          );
        } catch (error) {
          console.error(error);
          Toast.error("Could not apply the alignment to the dataset.");
        }
      },
    });
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
      "A view was reloaded or left, so the alignment view is restarted. The stored landmarks are kept.",
    );
    if (reloadedRole !== "store") {
      // Saves the landmarks that were synced before the reload.
      await sendMessage("store", "save").catch((error) => console.error(error));
    }
    onRestart();
  }

  function handleWorkerCommand(side: Side, command: BigWarpCommand) {
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
      className={classnames("align-datasets-workspace", {
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
            <div key={side} className="align-datasets-worker">
              <iframe
                ref={(element) => {
                  iframesRef.current[side] = element;
                }}
                title={`${side === "A" ? "Fixed" : "Moving"} layer (${layerNames[side]})`}
                src={getBigWarpWorkerUrl(dataset, layerNames[side], side === "A")}
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
            title="Landmark annotation"
            style={{ display: "none" }}
            src={getBigWarpStoreUrl(landmarkAnnotation.id)}
            onLoad={() => handleIframeLoad("store")}
          />
          {overlayStatus != null ? <WorkspaceOverlay status={overlayStatus} /> : null}
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
          <LandmarkPanel
            alignmentListUrl={getAlignmentSelectionUrl(dataset)}
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
            alignment={alignment}
            alignmentErrorMessage={"errorMessage" in estimation ? estimation.errorMessage : null}
            isOtherLayerVisible={isOtherLayerVisible}
            onToggleOtherLayer={toggleOtherLayer}
            isTransformShown={isTransformShown}
            onToggleTransform={toggleTransform}
            canColorOverlay={overlayColors != null}
            isColorOverlayEnabled={isColorOverlayEnabled}
            onColorOverlayChange={setIsColorOverlayEnabled}
            canApplyAlignmentToDataset={dataset.isEditable}
            onApplyAlignmentToDataset={applyCurrentAlignment}
            isAppliedToDataset={isAppliedToDataset}
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
    <div className="align-datasets-next-landmark-hint">
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

// Covers the workers until the stored landmarks were imported, and while restarting. A
// landmark placed before the import could get the pair id of a stored landmark.
function WorkspaceOverlay({ status }: { status: OverlayStatus }) {
  return (
    <Flex className="align-datasets-overlay" vertical justify="center" align="center" gap={8}>
      {status !== "failed" ? (
        <>
          <Spin size="large" />
          <Typography.Text>
            {status === "loading" ? "Loading the landmarks…" : "Restarting the alignment view…"}
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
