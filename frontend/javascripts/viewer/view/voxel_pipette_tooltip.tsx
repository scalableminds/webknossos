import { CopyOutlined } from "@ant-design/icons";
import { copyToClipboad } from "admin/voxelytics/utils";
import { Tooltip } from "antd";
import { useFetch } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import _ from "lodash";
import { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import type { Vector3 } from "viewer/constants";
import {
  getColorLayers,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import { globalToLayerTransformedPosition } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import {
  getCurrentMagIndex,
  getPosition,
  getRotationInRadian,
} from "viewer/model/accessors/flycam_accessor";
import {
  calculateMaybePlaneScreenPos,
  getGlobalMousePositionFloating,
  getInputCatcherRect,
} from "viewer/model/accessors/view_mode_accessor";
import { getReadableNameForLayerName } from "viewer/model/accessors/volumetracing_accessor";
import { hideMeasurementTooltipAction } from "viewer/model/actions/ui_actions";
import { getBaseVoxelFactorsInUnit } from "viewer/model/scaleinfo";
import { Store, api } from "viewer/singletons";
import { getTooltipPosition, isPositionStillInPlane } from "./viewport_tooltip_helpers";

function VoxelValueEntry({
  layerName,
  value,
  category,
}: { layerName: string; value: number[]; category: "color" | "segmentation" }) {
  const valueString = value.join(", ");
  return (
    <div>
      {category === "color" ? "Intensity" : "Segment ID"} in <strong>{layerName}</strong>:{" "}
      {valueString}{" "}
      <Tooltip title="Copy to clipboard">
        <CopyOutlined
          onClick={() => {
            copyToClipboad(valueString);
          }}
        />
      </Tooltip>
    </div>
  );
}

export default function VoxelValueTooltip() {
  const lastMeasuredGlobalPosition = useWkSelector(
    (state) => state.uiInformation.measurementToolInfo.lastMeasuredPosition,
  );
  const dataset = useWkSelector((state) => state.dataset);
  const annotation = useWkSelector((state) => state.annotation);
  const flycamPosition = useWkSelector((state) => getPosition(state.flycam));
  const flycamRotation = useWkSelector((state) => getRotationInRadian(state.flycam));
  const additionalCoordinates = useWkSelector((state) => state.flycam.additionalCoordinates);
  const zoomStep = useWkSelector((state) => state.flycam.zoomStep);
  const globalMousePosition = useWkSelector((state) => getGlobalMousePositionFloating(state));
  const datasetScale = useWkSelector((state) =>
    getBaseVoxelFactorsInUnit(state.dataset.dataSource.scale),
  );
  const tooltipRef = useRef<HTMLDivElement>(null);
  const dispatch = useDispatch();
  const orthoView = useWkSelector((state) => state.viewModeData.plane.activeViewport);

  const positionToPick = lastMeasuredGlobalPosition ?? globalMousePosition;

  const [debouncedPosition, setDebouncedPosition] = useState(positionToPick);

  useEffect(() => {
    const handler = _.debounce(() => {
      setDebouncedPosition(positionToPick);
    }, 50);

    handler();
    return handler.cancel;
  }, [positionToPick]);

  const tooltipPosition = useWkSelector((state) =>
    positionToPick ? calculateMaybePlaneScreenPos(state, positionToPick, orthoView) : null,
  );
  const viewportRect = useWkSelector((state) => getInputCatcherRect(state, orthoView));

  useEffect(() => {
    if (
      lastMeasuredGlobalPosition &&
      !isPositionStillInPlane(
        lastMeasuredGlobalPosition,
        flycamRotation,
        flycamPosition,
        orthoView,
        datasetScale,
        zoomStep,
      )
    ) {
      dispatch(hideMeasurementTooltipAction());
    }
  }, [
    dispatch,
    lastMeasuredGlobalPosition,
    flycamRotation,
    flycamPosition,
    orthoView,
    datasetScale,
    zoomStep,
  ]);

  const colorLayers = useWkSelector((state) => getColorLayers(state.dataset));
  const visibleSegmentationLayer = useWkSelector((state) => getVisibleSegmentationLayer(state));
  const layers = _.compact([visibleSegmentationLayer, ...colorLayers]);

  const layerNamesWithDataValues = useFetch(
    async () => {
      if (positionToPick == null) {
        return null;
      }

      return Promise.all(
        layers.map(async (layer) => {
          // getCurrentMagIndex depends on the current state, but we don't
          // want to refetch these data values here every time the state changes.
          // This is not ideal, but the downsides should be negligible (e.g., when
          // zooming, the data value won't be read again with the changed mag).
          const magIndex = getCurrentMagIndex(Store.getState(), layer.name);
          const positionInLayer = globalToLayerTransformedPosition(
            positionToPick,
            layer.name,
            layer.category,
            Store.getState(),
          );

          const channelCount = api.data.getChannelCount(layer.name);

          const dataValue = await Promise.all(
            _.range(channelCount).map((channelIndex) =>
              api.data.getDataValue(
                layer.name,
                positionInLayer.map((el) => Math.floor(el)) as Vector3,
                magIndex,
                additionalCoordinates,
                true,
                channelIndex,
              ),
            ),
          );

          return [
            getReadableNameForLayerName(dataset, annotation, layer.name),
            [layer.category, dataValue],
          ];
        }),
      );
    },
    [],
    [debouncedPosition],
  );

  if (tooltipPosition == null) {
    return null;
  }

  const voxelValueByLayer: Record<string, ["color" | "segmentation", number[]]> | null =
    layerNamesWithDataValues != null ? Object.fromEntries(layerNamesWithDataValues) : null;

  const { left, top } = getTooltipPosition(
    lastMeasuredGlobalPosition == null,
    tooltipRef,
    viewportRect,
    tooltipPosition,
  );

  return (
    <div
      ref={tooltipRef}
      className="node-context-menu cursor-tooltip"
      style={{
        left,
        top,
        pointerEvents: lastMeasuredGlobalPosition == null ? "none" : "auto",
      }}
    >
      {voxelValueByLayer != null
        ? Object.entries(voxelValueByLayer).map(([layerName, [category, value]]) => (
            <VoxelValueEntry
              key={layerName}
              category={category}
              layerName={layerName}
              value={value}
            />
          ))
        : "Loading..."}
    </div>
  );
}
