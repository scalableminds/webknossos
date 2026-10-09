import { App, Button, Flex, Result, Spin, Splitter, Typography } from "antd";
import classnames from "classnames";
import Toast from "libs/toast";
import { useEffect, useEffectEvent, useState } from "react";
import { useBlocker } from "react-router";
import type { APIAnnotation, APIDataset } from "types/api_types";
import { Identity4x4, type Vector3 } from "viewer/constants";
import {
  getTransformPointUnscaledFn,
  invertTransform,
  type Transform,
} from "viewer/model/helpers/transformation_helpers";
import {
  type Alignment,
  estimateTransformBtoA,
  type LandmarkPair,
  type LayerNames,
  OTHER_SIDE,
  SIDES,
  SINGLE_PLANE_ALIGNMENT_HINT,
  type Side,
  storeAlignmentInDataset,
} from "./alignment_helpers";
import { type BigWarpCommand, getBigWarpStoreUrl, getBigWarpWorkerUrl } from "./bigwarp_protocol";
import { LandmarkPanel } from "./landmark_panel";
import { useIframeBridge } from "./use_iframe_bridge";
import { type LandmarkSyncStatus, useLandmarkSync } from "./use_landmark_sync";

const DEFAULT_LANDMARK_PANEL_WIDTH = 380;
const MIN_LANDMARK_PANEL_WIDTH = 260;
const MAX_LANDMARK_PANEL_WIDTH = "70%";

type Props = {
  dataset: APIDataset;
  layerNames: LayerNames;
  landmarkAnnotation: APIAnnotation;
};

export function AlignmentWorkspace({ dataset, layerNames, landmarkAnnotation }: Props) {
  const { modal } = App.useApp();
  const [isLandmarkPanelOpen, setIsLandmarkPanelOpen] = useState(false);
  const [landmarkPanelWidth, setLandmarkPanelWidth] = useState(DEFAULT_LANDMARK_PANEL_WIDTH);
  const [alignment, setAlignment] = useState<Alignment | null>(null);
  const transformBtoA = alignment?.transformBtoA ?? null;
  const [annotationName, setAnnotationName] = useState(landmarkAnnotation.name);
  const [annotationDescription, setAnnotationDescription] = useState(
    landmarkAnnotation.description,
  );
  // If enabled, the transform is computed again whenever the landmarks change.
  const [isAutoAlignEnabled, setIsAutoAlignEnabled] = useState(false);
  // Whether a worker also shows the layer of the other worker.
  const [isOtherLayerVisible, setIsOtherLayerVisible] = useState<Record<Side, boolean>>({
    A: false,
    B: false,
  });

  // handleWorkerCommand is a function declaration further below, so it can be used here.
  const { iframesRef, sendMessage, isStoreSaved } = useIframeBridge(handleWorkerCommand);
  const {
    landmarks,
    status: syncStatus,
    hasUnsyncedLandmarks,
    fetchLandmarks,
  } = useLandmarkSync(sendMessage, layerNames);
  const isSyncReady = syncStatus === "ready";
  const hasUnsavedChanges = hasUnsyncedLandmarks || !isStoreSaved;

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

  // Each worker initially shows only its own layer.
  useEffect(() => {
    sendMessage("A", "setLayerVisibility", [layerNames.B, false]);
    sendMessage("B", "setLayerVisibility", [layerNames.A, false]);
  }, [sendMessage, layerNames.A, layerNames.B]);

  // Shows layer B transformed in worker A and layer A transformed (inversely) in worker B.
  const showTransformInWorkers = async (transform: Transform | null) => {
    await sendMessage("A", "setAffineLayerTransforms", [
      layerNames.B,
      transform?.affineMatrix ?? Identity4x4,
    ]);
    await sendMessage("B", "setAffineLayerTransforms", [
      layerNames.A,
      transform?.affineMatrixInv ?? Identity4x4,
    ]);
  };

  // When aligning automatically, problems are not reported to the user.
  const align = async ({ isAutomatic }: { isAutomatic: boolean } = { isAutomatic: false }) => {
    // The synced landmarks may miss a landmark that was placed right before.
    const currentLandmarks = await fetchLandmarks().catch((error) => {
      console.error(error);
      return null;
    });
    if (currentLandmarks == null) {
      if (!isAutomatic) {
        Toast.error("Could not read the landmarks of the views.");
      }
      return;
    }
    const result = estimateTransformBtoA(currentLandmarks);
    if ("errorMessage" in result) {
      if (!isAutomatic) {
        Toast.warning(result.errorMessage);
      }
      return;
    }
    setAlignment({
      transformBtoA: result.transform,
      landmarks: currentLandmarks,
      usedCopiesInNextSlice: result.usedCopiesInNextSlice,
    });
    if (!isAutomatic && result.usedCopiesInNextSlice) {
      Toast.info(SINGLE_PLANE_ALIGNMENT_HINT);
    }
    await showTransformInWorkers(result.transform);
  };

  // Aligns right after the stored landmarks were loaded, and after every change of the
  // landmarks if auto-align is enabled.
  const alignAutomatically = useEffectEvent(() => align({ isAutomatic: true }));
  useEffect(() => {
    if (isSyncReady) {
      alignAutomatically();
    }
  }, [isSyncReady]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Runs again whenever the landmarks change.
  useEffect(() => {
    if (isAutoAlignEnabled && isSyncReady) {
      alignAutomatically();
    }
  }, [isAutoAlignEnabled, isSyncReady, landmarks]);

  const resetAlignment = async () => {
    setAlignment(null);
    await showTransformInWorkers(null);
  };

  const toggleOtherLayer = (side: Side) => {
    const isVisible = !isOtherLayerVisible[side];
    setIsOtherLayerVisible((previous) => ({ ...previous, [side]: isVisible }));
    sendMessage(side, "setLayerVisibility", [layerNames[OTHER_SIDE[side]], isVisible]);
  };

  const focusPosition = (side: Side, position: Vector3) => {
    sendMessage(side, "centerPositionAnimated", [position]);
  };

  const focusPair = (pair: LandmarkPair) => {
    for (const side of SIDES) {
      const landmark = pair.landmarks[side];
      if (landmark != null) {
        focusPosition(side, landmark.position);
      }
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

  // Saves the landmark annotation right away instead of waiting for its auto-save.
  // Reloading this page closes all iframes at once, which may interrupt the auto-save.
  const forceSave = async () => {
    try {
      await sendMessage("store", "save");
      Toast.success("Saved the landmark annotation.");
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

  const storeAlignment = (transform: Transform) => {
    const { A: fixedLayerName, B: movingLayerName } = layerNames;
    const fixedLayer = dataset.dataSource.dataLayers.find((layer) => layer.name === fixedLayerName);
    const fixedLayerHasTransforms = (fixedLayer?.coordinateTransformations ?? []).length > 0;
    modal.confirm({
      title: `Store the alignment as the default transform of "${movingLayerName}"?`,
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
          await storeAlignmentInDataset(dataset.id, layerNames, transform);
          Toast.success(
            `Stored the current alignment as the default transform of "${movingLayerName}".`,
          );
        } catch (error) {
          console.error(error);
          Toast.error("Could not store the alignment as the dataset's default transform.");
        }
      },
    });
  };

  function handleWorkerCommand(side: Side, command: BigWarpCommand) {
    switch (command) {
      case "align":
        align();
        break;
      case "forceSave":
        forceSave();
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
      onResize={([panelWidth]) => {
        if (isLandmarkPanelOpen) {
          setLandmarkPanelWidth(panelWidth);
        }
      }}
    >
      {/* Both panels are always rendered, because the iframes would reload if their position
      in the tree changed. A closed landmark panel has a width of 0. */}
      <Splitter.Panel
        className="landmark-panel"
        size={isLandmarkPanelOpen ? landmarkPanelWidth : 0}
        min={isLandmarkPanelOpen ? MIN_LANDMARK_PANEL_WIDTH : 0}
        max={MAX_LANDMARK_PANEL_WIDTH}
        resizable={isLandmarkPanelOpen}
      >
        {isLandmarkPanelOpen ? (
          <LandmarkPanel
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
            isAutoAlignEnabled={isAutoAlignEnabled}
            onAutoAlignChange={setIsAutoAlignEnabled}
            isOtherLayerVisible={isOtherLayerVisible}
            canStoreAlignment={dataset.isEditable}
            onAlign={() => align()}
            onToggleOtherLayer={toggleOtherLayer}
            onResetAlignment={resetAlignment}
            onStoreAlignment={() => transformBtoA != null && storeAlignment(transformBtoA)}
            onFocusPair={focusPair}
          />
        ) : null}
      </Splitter.Panel>
      <Splitter.Panel>
        <Flex style={{ height: "100%", position: "relative" }}>
          {SIDES.map((side) => (
            <iframe
              key={side}
              ref={(element) => {
                iframesRef.current[side] = element;
              }}
              className="align-datasets-worker"
              title={`${side === "A" ? "Fixed" : "Moving"} layer (${layerNames[side]})`}
              src={getBigWarpWorkerUrl(dataset, layerNames[side], side === "A")}
            />
          ))}
          <iframe
            ref={(element) => {
              iframesRef.current.store = element;
            }}
            title="Landmark annotation"
            style={{ display: "none" }}
            src={getBigWarpStoreUrl(landmarkAnnotation.id)}
          />
          {syncStatus !== "ready" ? <LandmarkSyncOverlay status={syncStatus} /> : null}
        </Flex>
      </Splitter.Panel>
    </Splitter>
  );
}

// Covers the workers until the stored landmarks were imported. Pairs are matched by tree id,
// so a landmark placed before the import would shift all pairs by one.
function LandmarkSyncOverlay({ status }: { status: Exclude<LandmarkSyncStatus, "ready"> }) {
  return (
    <Flex className="align-datasets-overlay" vertical justify="center" align="center" gap={8}>
      {status === "loading" ? (
        <>
          <Spin size="large" />
          <Typography.Text>Loading the landmarks…</Typography.Text>
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
