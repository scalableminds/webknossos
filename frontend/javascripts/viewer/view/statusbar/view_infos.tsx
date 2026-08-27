import Icon, { DownloadOutlined } from "@ant-design/icons";
import IconStatusbarDownsampling from "@images/icons/icon-statusbar-downsampling.svg?react";
import FastTooltip from "components/fast_tooltip";
import { formatCountToDataAmountUnit } from "libs/format_utils";
import { V3 } from "libs/mjs";
import { useInterval } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import messages from "messages";
import React, { useCallback, useState } from "react";
import { useDispatch } from "react-redux";
import type { AdditionalCoordinate } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { MappingStatusEnum } from "viewer/constants";
import {
  getMappingInfoOrNull,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import { getActiveMagInfo } from "viewer/model/accessors/flycam_accessor";
import {
  getGlobalMousePosition,
  isPlaneMode as getIsPlaneMode,
} from "viewer/model/accessors/view_mode_accessor";
import {
  getActiveSegmentationTracing,
  getReadableNameForLayerName,
  getSegmentationLayerForTracing,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  setActiveNodeAction,
  setActiveTreeAction,
} from "viewer/model/actions/skeletontracing_actions";
import { setActiveCellAction } from "viewer/model/actions/volumetracing_actions";
import { getSegmentIdRangeForElementClass } from "viewer/model/bucket_data_handling/data_rendering_logic";
import { getGlobalDataConnectionInfo } from "viewer/model/data_connection_info";
import { Store } from "viewer/singletons";
import { NumberInputPopoverSetting } from "../left_border_tabs/components/number_input_popover_setting";

function getPosString(
  pos: Vector3,
  optAdditionalCoordinates: AdditionalCoordinate[] | null | undefined,
) {
  const additionalCoordinates = (optAdditionalCoordinates || []).map((coord) => coord.value);
  return V3.floor(pos).concat(additionalCoordinates).join(",");
}

function SegmentInfo() {
  const visibleSegmentationLayer = useWkSelector((state) => getVisibleSegmentationLayer(state));
  const hasVisibleSegmentation = visibleSegmentationLayer != null;
  const activeMappingInfo = useWkSelector((state) =>
    getMappingInfoOrNull(
      state.temporaryConfiguration.activeMappingByLayer,
      visibleSegmentationLayer?.name,
    ),
  );
  const hoveredSegmentId = useWkSelector((state) => state.temporaryConfiguration.hoveredSegmentId);

  if (hasVisibleSegmentation == null) {
    return null;
  }

  const idString =
    hoveredSegmentId == null
      ? "-"
      : activeMappingInfo?.mappingStatus === MappingStatusEnum.ENABLED
        ? `${hoveredSegmentId} (mapped)`
        : `${hoveredSegmentId}`;

  return <span className="info-element">Segment {idString}</span>;
}

function DownloadSpeedometer() {
  const [currentBucketDownloadSpeed, setCurrentBucketDownloadSpeed] = useState<number>(0);
  const [totalDownloadedByteCount, setTotalDownloadedByteCount] = useState<number>(0);
  useInterval(() => {
    const { avgDownloadSpeedInBytesPerS, accumulatedDownloadedBytes } =
      getGlobalDataConnectionInfo().getStatistics();
    setCurrentBucketDownloadSpeed(avgDownloadSpeedInBytesPerS);
    setTotalDownloadedByteCount(accumulatedDownloadedBytes);
  }, 1500);

  return (
    <FastTooltip
      title={`Downloaded ${formatCountToDataAmountUnit(
        totalDownloadedByteCount,
      )} of Image Data (after decompression)`}
    >
      <DownloadOutlined className="icon-margin-right" />
      {formatCountToDataAmountUnit(currentBucketDownloadSpeed)}/s
    </FastTooltip>
  );
}

function MagnificationInfo() {
  const { representativeMag, isActiveMagGlobal } = useWkSelector(getActiveMagInfo);

  const renderMagTooltipContent = useCallback(() => {
    const state = Store.getState();
    const { activeMagOfEnabledLayers } = getActiveMagInfo(state);
    const dataset = state.dataset;
    const annotation = state.annotation;

    return (
      <div style={{ width: 200 }}>
        Rendered magnification per layer:
        <ul>
          {Object.entries(activeMagOfEnabledLayers).map(([layerName, mag]) => {
            const readableName = getReadableNameForLayerName(dataset, annotation, layerName);

            return (
              <li key={layerName}>
                {readableName}: {mag ? mag.join("-") : "none"}
              </li>
            );
          })}
        </ul>
        {messages["dataset.mag_explanation"]}
      </div>
    );
  }, []);

  if (representativeMag == null) {
    return null;
  }

  return (
    <span className="info-element">
      <Icon component={IconStatusbarDownsampling} aria-label="Magnification" />{" "}
      <FastTooltip dynamicRenderer={renderMagTooltipContent} placement="top">
        {representativeMag.join("-")}
        {isActiveMagGlobal ? "" : "*"}{" "}
      </FastTooltip>
    </span>
  );
}

function SegmentAndMousePosition() {
  // This component depends on the mouse position which is a fast-changing property.
  // For the sake of performance, it is isolated as a single component.
  const additionalCoordinates = useWkSelector((state) => state.flycam.additionalCoordinates);
  const isPlaneMode = useWkSelector((state) => getIsPlaneMode(state));
  const globalMousePositionRounded = useWkSelector(getGlobalMousePosition);

  return (
    <>
      {isPlaneMode ? <SegmentInfo /> : null}
      {isPlaneMode ? (
        <span className="info-element">
          Pos [
          {globalMousePositionRounded
            ? getPosString(globalMousePositionRounded, additionalCoordinates)
            : "-,-,-"}
          ]
        </span>
      ) : null}
    </>
  );
}

export default function Infos() {
  const isSkeletonAnnotation = useWkSelector((state) => state.annotation.skeleton != null);
  const activeVolumeTracing = useWkSelector((state) => getActiveSegmentationTracing(state));

  const activeCellId = activeVolumeTracing?.activeCellId;
  const activeNodeId = useWkSelector((state) =>
    state.annotation.skeleton ? state.annotation.skeleton.activeNodeId : null,
  );
  const activeTreeId = useWkSelector((state) =>
    state.annotation.skeleton ? state.localSkeletonState.activeTreeId : null,
  );
  const dispatch = useDispatch();

  const onChangeActiveCellId = useCallback(
    (id: bigint) => dispatch(setActiveCellAction(id)),
    [dispatch],
  );
  const onChangeActiveNodeId = useCallback(
    (id: number) => {
      dispatch(setActiveNodeAction(id));
    },
    [dispatch],
  );
  const onChangeActiveTreeId = useCallback(
    (id: number) => dispatch(setActiveTreeAction(id)),
    [dispatch],
  );

  const validSegmentIdRange = useWkSelector((state) => {
    if (!activeVolumeTracing) {
      return null;
    }
    const segmentationLayer = getSegmentationLayerForTracing(state, activeVolumeTracing);
    const elementClass = segmentationLayer.elementClass;
    return getSegmentIdRangeForElementClass(elementClass);
  });

  return (
    <React.Fragment>
      <SegmentAndMousePosition />
      <span className="info-element">
        <DownloadSpeedometer />
      </span>
      {activeVolumeTracing != null && validSegmentIdRange != null ? (
        <span className="info-element">
          <NumberInputPopoverSetting
            value={activeCellId ?? null}
            label="Active Segment"
            min={validSegmentIdRange[0]}
            max={validSegmentIdRange[1]}
            detailedLabel="Change Active Segment ID"
            onChange={onChangeActiveCellId}
          />
        </span>
      ) : null}
      {isSkeletonAnnotation ? (
        <span className="info-element">
          <NumberInputPopoverSetting
            value={activeNodeId}
            label="Active Node"
            detailedLabel="Change Active Node ID"
            onChange={onChangeActiveNodeId}
          />
        </span>
      ) : null}
      {isSkeletonAnnotation ? (
        <span className="info-element">
          <NumberInputPopoverSetting
            value={activeTreeId}
            label="Active Tree"
            detailedLabel="Change Active Tree ID"
            onChange={onChangeActiveTreeId}
          />
        </span>
      ) : null}
      <MagnificationInfo />
    </React.Fragment>
  );
}
