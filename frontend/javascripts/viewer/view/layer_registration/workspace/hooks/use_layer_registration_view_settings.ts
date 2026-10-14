import Toast from "libs/toast";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { APIDataset } from "types/api_types";
import { Identity4x4 } from "viewer/constants";
import {
  getOverlayLayerColors,
  type LayerNames,
  OTHER_SIDE,
  SIDES,
  type Side,
} from "../../helpers/layer_registration_helpers";
import type { InactivePairs } from "../../helpers/layer_registration_moving_layers";
import type { TransformEstimation } from "../../helpers/layer_registration_transform_estimation";
import type { LayerRegistrationViewState } from "../../layer_registration_protocol";
import type { SendMessage } from "./use_layer_registration_iframe_bridge";

// What the workers show besides their own layer. The panel footer and the toolbars of the
// workers offer the same switches.
export type ViewSettings = {
  // Whether a worker also shows the layer of the other worker. Each worker initially shows
  // only its own layer (see applyLayerRegistrationWorkerSettings).
  isOtherLayerVisible: Record<Side, boolean>;
  // Whether a worker shows the other layer transformed onto its own layer or untransformed.
  isTransformShown: Record<Side, boolean>;
  // False if the layers can't be colored, see getOverlayLayerColors.
  canColorOverlay: boolean;
  isColorOverlayEnabled: boolean;
  toggleOtherLayer: (side: Side) => void;
  // The transform only moves the other layer, so showing it also shows that layer.
  toggleTransform: (side: Side) => void;
  setIsColorOverlayEnabled: (isEnabled: boolean) => void;
};

/** Holds the view settings of the two workers and sends them to the workers, together with the
 * transforms that the workers apply to the other layers.
 */
export function useViewSettings({
  dataset,
  layerNames,
  sendMessage,
  estimation,
  inactivePairs,
  isLandmarkPanelOpen,
}: {
  dataset: APIDataset;
  layerNames: LayerNames;
  sendMessage: SendMessage;
  // The transform estimation of the active moving layer.
  estimation: TransformEstimation;
  inactivePairs: InactivePairs;
  // Sent to the workers, too, because the right worker has the button that toggles the panel.
  isLandmarkPanelOpen: boolean;
}): ViewSettings {
  const [isOtherLayerVisible, setIsOtherLayerVisible] = useState<Record<Side, boolean>>({
    fixed: false,
    moving: false,
  });
  const [isTransformShown, setIsTransformShown] = useState<Record<Side, boolean>>({
    fixed: true,
    moving: true,
  });
  const [isColorOverlayEnabled, setIsColorOverlayEnabled] = useState(false);
  // Whether the workers showed the other layer for a transform yet, see the effect below.
  const hasShownTransformRef = useRef(false);
  // The effects below depend on the names, not on the object, which is created anew on every
  // render.
  const { fixed: fixedLayerName, moving: movingLayerName } = layerNames;
  const overlayColors = useMemo(
    () => getOverlayLayerColors(dataset, { fixed: fixedLayerName, moving: movingLayerName }),
    [dataset, fixedLayerName, movingLayerName],
  );
  const movingToFixedTransform =
    "errorMessage" in estimation ? null : estimation.movingToFixedTransform;
  const isTransformAvailable = movingToFixedTransform != null;

  // Shows the moving layer transformed in the left worker and the fixed layer transformed
  // (inversely) in the right worker, in each worker only if the transform is shown there.
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
      const matrix =
        "errorMessage" in layerEstimation
          ? null
          : layerEstimation.movingToFixedTransform.affineMatrix;
      sendMessage("fixed", "setAffineLayerTransforms", [layerName, matrix ?? Identity4x4]);
    }
  }, [sendMessage, inactivePairs]);

  // The workers show this state in their toolbars and navbars.
  useEffect(() => {
    for (const side of SIDES) {
      const viewState: LayerRegistrationViewState = {
        otherLayerName: side === "fixed" ? movingLayerName : fixedLayerName,
        isOtherLayerVisible: isOtherLayerVisible[side],
        isTransformShown: isTransformShown[side],
        isTransformAvailable,
        isLandmarkPanelOpen,
      };
      sendMessage(side, "setLayerRegistrationViewState", [viewState]);
    }
  }, [
    sendMessage,
    fixedLayerName,
    movingLayerName,
    isOtherLayerVisible,
    isTransformShown,
    isTransformAvailable,
    isLandmarkPanelOpen,
  ]);

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

  return {
    isOtherLayerVisible,
    isTransformShown,
    canColorOverlay: overlayColors != null,
    isColorOverlayEnabled,
    toggleOtherLayer: (side) => setOtherLayerVisibility(side, !isOtherLayerVisible[side]),
    toggleTransform,
    setIsColorOverlayEnabled,
  };
}
