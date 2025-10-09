import { CopyOutlined } from "@ant-design/icons";
import { copyToClipboad } from "admin/voxelytics/utils";
import { Tooltip } from "antd";
import { useFetch } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import { clamp } from "libs/utils";
import _ from "lodash";
import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import type { OrthoView, Vector3 } from "viewer/constants";
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
  calculateInViewportPos,
  calculateMaybePlaneScreenPos,
  getGlobalMousePosition,
  getInputCatcherRect,
} from "viewer/model/accessors/view_mode_accessor";
import { getReadableNameForLayerName } from "viewer/model/accessors/volumetracing_accessor";
import { hideMeasurementTooltipAction } from "viewer/model/actions/ui_actions";
import Dimensions from "viewer/model/dimensions";
import { getBaseVoxelFactorsInUnit } from "viewer/model/scaleinfo";
import { Store, api } from "viewer/singletons";

function VoxelValueEntry({ layerName, value }: { layerName: string; value: string }) {
  return (
    <div>
      <strong>{layerName}: </strong>
      {value}{" "}
      <Tooltip title="Copy to clipboard">
        <CopyOutlined
          onClick={() => {
            copyToClipboad(value);
          }}
        />
      </Tooltip>
    </div>
  );
}

function isPositionStillInPlane(
  positionXYZ: Vector3,
  flycamRotation: Vector3,
  flycamPosition: Vector3,
  planeId: OrthoView,
  baseVoxelFactors: Vector3,
  zoomStep: number,
) {
  const posInViewport = calculateInViewportPos(
    positionXYZ,
    flycamPosition,
    flycamRotation,
    baseVoxelFactors,
    zoomStep,
  ).toArray();
  const thirdDim = Dimensions.thirdDimensionForPlane(planeId);
  return Math.abs(posInViewport[thirdDim]) < 1;
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
  const globalMousePosition = useWkSelector((state) => getGlobalMousePosition(state));
  const datasetScale = useWkSelector((state) =>
    getBaseVoxelFactorsInUnit(state.dataset.dataSource.scale),
  );
  const tooltipRef = useRef<HTMLDivElement>(null);
  const dispatch = useDispatch();
  const orthoView = useWkSelector((state) => state.viewModeData.plane.activeViewport);

  const positionToPick = lastMeasuredGlobalPosition ?? globalMousePosition;

  const tooltipPosition = useWkSelector((state) =>
    positionToPick ? calculateMaybePlaneScreenPos(state, positionToPick, orthoView) : null,
  );
  const {
    left: viewportLeft,
    top: viewportTop,
    width: viewportWidth,
    height: viewportHeight,
  } = useWkSelector((state) => getInputCatcherRect(state, orthoView));

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

  const layerNamesWithDataValue = useFetch(
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

          const dataValue = await api.data.getDataValue(
            layer.name,
            positionInLayer.map((el) => Math.floor(el)) as Vector3,
            magIndex,
            additionalCoordinates,
          );
          return [getReadableNameForLayerName(dataset, annotation, layer.name), dataValue];
        }),
      );
    },
    [],
    [positionToPick],
  );

  if (tooltipPosition == null) {
    return null;
  }

  const voxelValuesByLayer: Record<string, string> | null =
    layerNamesWithDataValue != null ? Object.fromEntries(layerNamesWithDataValue) : null;
  // todop: integrate
  // state.temporaryConfiguration.hoveredSegmentId

  const tooltipWidth = tooltipRef.current?.offsetWidth ?? 0;
  const tooltipHeight = tooltipRef.current?.offsetHeight ?? 0;

  const OFFSET = 2;

  // Position tooltip just below and to the left of the cursor
  const left = clamp(
    viewportLeft - tooltipWidth - OFFSET, // min
    tooltipPosition[0] - tooltipWidth - OFFSET, // desired position (left of cursor, small offset)
    viewportLeft + viewportWidth + tooltipWidth - OFFSET, // max (stay in viewport)
  );

  const top = clamp(
    viewportTop + OFFSET, // min
    tooltipPosition[1] + OFFSET, // just below cursor
    viewportTop + viewportHeight + tooltipHeight - OFFSET, // max
  );

  return (
    <div
      ref={tooltipRef}
      className="node-context-menu voxel-picker-tooltip"
      style={{
        left,
        top,
        pointerEvents: lastMeasuredGlobalPosition == null ? "none" : "auto",
      }}
    >
      Data values per layer:
      {voxelValuesByLayer != null
        ? Object.entries(voxelValuesByLayer).map(([layerName, value]) => (
            <VoxelValueEntry key={layerName} layerName={layerName} value={value} />
          ))
        : "Loading..."}
    </div>
  );
}
