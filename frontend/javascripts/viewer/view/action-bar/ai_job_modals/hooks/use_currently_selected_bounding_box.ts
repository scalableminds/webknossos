import { Form, type FormInstance } from "antd";
import { useEffect, useState } from "react";
import type { APIDataLayer } from "types/api_types";
import type { UserBoundingBox } from "viewer/store";

export function useCurrentlySelectedBoundingBox(
  userBoundingBoxes: UserBoundingBox[],
  defaultBBForLayers: UserBoundingBox[],
  layers: APIDataLayer[],
  form: FormInstance,
  isBoundingBoxConfigurable: boolean,
): UserBoundingBox | undefined {
  const selectedBoundingBoxId = Form.useWatch("boundingBoxId", form);
  const currentlySelectedLayerName = Form.useWatch("layerName", form);
  const [currentlySelectedBoundingBox, setCurrentlySelectedBoundingBox] = useState<
    UserBoundingBox | undefined
  >(undefined);

  useEffect(() => {
    const currentSelectedLayer = layers.find((layer) => layer.name === currentlySelectedLayerName);
    const indexOfLayer = currentSelectedLayer ? layers.indexOf(currentSelectedLayer) : -1;
    const newCurrentlySelectedBoundingBox = isBoundingBoxConfigurable
      ? userBoundingBoxes.find((bbox) => bbox.id === selectedBoundingBoxId)
      : indexOfLayer >= 0
        ? defaultBBForLayers[indexOfLayer]
        : undefined;
    setCurrentlySelectedBoundingBox(newCurrentlySelectedBoundingBox);
  }, [
    selectedBoundingBoxId,
    currentlySelectedLayerName,
    isBoundingBoxConfigurable,
    layers,
    userBoundingBoxes,
    defaultBBForLayers,
  ]);
  return currentlySelectedBoundingBox;
}
