import Toast from "libs/toast";
import { useEffect, useState } from "react";
import type { APIDataset } from "types/api_types";
import { Identity4x4, type Vector3 } from "viewer/constants";
import {
  getTransformPointUnscaledFn,
  invertTransform,
  type Transform,
} from "viewer/model/helpers/transformation_helpers";
import {
  estimateTransformBtoA,
  type LayerNames,
  OTHER_SIDE,
  SIDES,
  type Side,
  storeAlignmentInDataset,
} from "./alignment_helpers";
import { type BigWarpCommand, getBigWarpWorkerUrl } from "./bigwarp_protocol";
import { LandmarkPanel } from "./landmark_panel";
import { ResizableSidePanel } from "./resizable_side_panel";
import { useIframeBridge, useWorkerCommands } from "./use_iframe_bridge";
import { useLandmarkSync } from "./use_landmark_sync";

type Props = {
  dataset: APIDataset;
  fixedLayerName: string;
  movingLayerName: string;
  landmarkAnnotationId: string;
};

export function AlignmentWorkspace({
  dataset,
  fixedLayerName,
  movingLayerName,
  landmarkAnnotationId,
}: Props) {
  const layerNames: LayerNames = { A: fixedLayerName, B: movingLayerName };
  const [isLandmarkPanelOpen, setIsLandmarkPanelOpen] = useState(false);
  const [transformBtoA, setTransformBtoA] = useState<Transform | null>(null);
  // Whether a worker also shows the layer of the other worker.
  const [isOtherLayerVisible, setIsOtherLayerVisible] = useState<Record<Side, boolean>>({
    A: false,
    B: false,
  });

  const { iframesRef, whenReady, sendMessage } = useIframeBridge();
  const landmarks = useLandmarkSync({ whenReady, sendMessage }, fixedLayerName, movingLayerName);

  // Each worker initially shows only its own layer.
  useEffect(() => {
    whenReady("A").then(() => sendMessage("A", "setLayerVisibility", [movingLayerName, false]));
    whenReady("B").then(() => sendMessage("B", "setLayerVisibility", [fixedLayerName, false]));
  }, [whenReady, sendMessage, fixedLayerName, movingLayerName]);

  // Shows layer B transformed in worker A and layer A transformed (inversely) in worker B.
  const showTransformInWorkers = async (transform: Transform | null) => {
    await sendMessage("A", "setAffineLayerTransforms", [
      movingLayerName,
      transform?.affineMatrix ?? Identity4x4,
    ]);
    await sendMessage("B", "setAffineLayerTransforms", [
      fixedLayerName,
      transform?.affineMatrixInv ?? Identity4x4,
    ]);
  };

  const align = async () => {
    const result = estimateTransformBtoA(landmarks);
    if ("errorMessage" in result) {
      Toast.warning(result.errorMessage);
      return;
    }
    if (result.usedCopiesInNextSlice) {
      Toast.info(
        "The landmarks lie in one plane. The alignment assumes that both layers are only shifted against each other along z.",
      );
    }
    setTransformBtoA(result.transform);
    await showTransformInWorkers(result.transform);
  };

  const resetAlignment = async () => {
    setTransformBtoA(null);
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

  const storeAlignment = async () => {
    if (transformBtoA == null) {
      return;
    }
    try {
      await storeAlignmentInDataset(dataset.id, layerNames, transformBtoA);
      Toast.success(`Stored the current alignment as the default transform for "${layerNames.B}".`);
    } catch (error) {
      console.error(error);
      Toast.error("Could not store the alignment as the dataset's default transform.");
    }
  };

  const handleWorkerCommand = (side: Side, command: BigWarpCommand) => {
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
  };

  useWorkerCommands(iframesRef, handleWorkerCommand);

  return (
    <div className="align-datasets-workspace">
      {isLandmarkPanelOpen ? (
        <ResizableSidePanel>
          <LandmarkPanel
            layerNames={layerNames}
            landmarks={landmarks}
            transformBtoA={transformBtoA}
            isOtherLayerVisible={isOtherLayerVisible}
            canStoreAlignment={dataset.isEditable}
            onToggleOtherLayer={toggleOtherLayer}
            onResetAlignment={resetAlignment}
            onStoreAlignment={storeAlignment}
            onFocusLandmark={focusPosition}
          />
        </ResizableSidePanel>
      ) : null}
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
        src={`/annotations/${landmarkAnnotationId}`}
      />
    </div>
  );
}
