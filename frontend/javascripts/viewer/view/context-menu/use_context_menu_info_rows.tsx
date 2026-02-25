import Icon, { BarChartOutlined, PushpinOutlined, TagOutlined } from "@ant-design/icons";
import IconCell from "@images/icons/icon-cell.svg?react";
import { Space } from "antd";
import type { ItemType } from "antd/es/menu/interface";
import FastTooltip from "components/fast_tooltip";
import { formatLengthAsVx, formatNumberToLength } from "libs/format_utils";
import { V3 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import { truncateStringToLength } from "libs/utils";
import { useState } from "react";
import { LongUnitToShortUnitMap } from "viewer/constants";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import {
  getActiveNode,
  getNodePosition,
  getTreeAndNode,
} from "viewer/model/accessors/skeletontracing_accessor";
import { getSegmentsForLayer } from "viewer/model/accessors/volumetracing_accessor";
import type { MutableNode, Tree } from "viewer/model/types/tree_types";
import { api } from "viewer/singletons";
import type { ContextMenuInfo } from "viewer/store";
import Store from "viewer/store";
import { CopyIconWithTooltip } from "./copy_icon_with_tooltip";
import { getInfoMenuItem, positionToString } from "./helpers";
import { useSegmentStatistics } from "./use_segment_statistics";

export function useContextMenuInfoRows(contextInfo: ContextMenuInfo, segmentIdAtPosition: number) {
  const {
    globalPosition,
    contextMenuPosition,
    meshId: maybeClickedMeshId,
    clickedNodeId: maybeClickedNodeId,
  } = contextInfo;

  const [segmentStatsTriggerDate, setSegmentStatsTriggerDate] = useState<Date | null>(null);

  const handleRefreshSegmentStatistics = async () => {
    await api.tracing.save();
    setSegmentStatsTriggerDate(new Date());
  };

  const clickedSegmentOrMeshId =
    maybeClickedMeshId != null ? maybeClickedMeshId : segmentIdAtPosition;
  const wasSegmentOrMeshClicked = clickedSegmentOrMeshId !== 0;

  const skeletonTracing = useWkSelector((state) => state.annotation.skeleton);
  const voxelSize = useWkSelector((state) => state.dataset.dataSource.scale);
  const additionalCoordinates = useWkSelector(
    (state) => state.flycam.additionalCoordinates || undefined,
  );
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const segments = useWkSelector((state) =>
    visibleSegmentationLayer != null
      ? getSegmentsForLayer(state, visibleSegmentationLayer.name)
      : null,
  );

  const {
    segmentVolumeLabel,
    boundingBoxInfoLabel,
    segmentSurfaceAreaLabel,
    isSegmentIndexAvailable,
  } = useSegmentStatistics(
    clickedSegmentOrMeshId,
    segmentStatsTriggerDate,
    contextMenuPosition,
    wasSegmentOrMeshClicked,
  );

  let nodeContextMenuTree: Tree | null = null;
  let nodeContextMenuNode: MutableNode | null = null;

  if (skeletonTracing != null && maybeClickedNodeId != null) {
    const treeAndNode = getTreeAndNode(skeletonTracing, maybeClickedNodeId);
    if (treeAndNode) {
      nodeContextMenuTree = treeAndNode[0];
      nodeContextMenuNode = treeAndNode[1];
    }
  }

  const clickedNodesPosition =
    nodeContextMenuNode != null ? getNodePosition(nodeContextMenuNode, Store.getState()) : null;

  const positionToMeasureDistanceTo =
    nodeContextMenuNode != null ? clickedNodesPosition : globalPosition;
  const activeNode = skeletonTracing != null ? getActiveNode(skeletonTracing) : null;

  const getActiveNodePosition = () => {
    if (activeNode == null) {
      throw new Error("getActiveNodePosition was called even though activeNode is null.");
    }
    return getNodePosition(activeNode, Store.getState());
  };

  const distanceToSelection =
    activeNode != null && positionToMeasureDistanceTo != null
      ? [
          formatNumberToLength(
            V3.scaledDist(getActiveNodePosition(), positionToMeasureDistanceTo, voxelSize.factor),
            LongUnitToShortUnitMap[voxelSize.unit],
          ),
          formatLengthAsVx(V3.length(V3.sub(getActiveNodePosition(), positionToMeasureDistanceTo))),
        ]
      : null;

  const nodePositionAsString =
    nodeContextMenuNode != null && clickedNodesPosition != null
      ? positionToString(clickedNodesPosition, nodeContextMenuNode.additionalCoordinates)
      : "";

  const infoRows: ItemType[] = [];

  const areSegmentStatisticsAvailable = wasSegmentOrMeshClicked && isSegmentIndexAvailable;
  if (areSegmentStatisticsAvailable) {
    infoRows.push({
      key: "load-stats",
      icon: <BarChartOutlined />,
      label: `${segmentStatsTriggerDate != null ? "Reload" : "Load"} segment statistics`,
      onClick: (event: any) => {
        event.domEvent.preventDefault();
        handleRefreshSegmentStatistics();
      },
    });
  }

  if (maybeClickedNodeId != null && nodeContextMenuTree != null) {
    infoRows.push(
      getInfoMenuItem(
        "nodeInfo",
        `Node with Id ${maybeClickedNodeId} in Tree ${nodeContextMenuTree.treeId}`,
      ),
    );
  }

  if (nodeContextMenuNode != null) {
    infoRows.push(
      getInfoMenuItem(
        "positionInfo",
        <Space size="small">
          <PushpinOutlined rotate={-45} />
          {`Position: ${nodePositionAsString}`}
          <CopyIconWithTooltip value={nodePositionAsString} title="Copy node position" />
        </Space>,
      ),
    );
  } else if (globalPosition != null) {
    const positionAsString = positionToString(globalPosition, additionalCoordinates);
    infoRows.push(
      getInfoMenuItem(
        "positionInfo",
        <Space size="small">
          <PushpinOutlined rotate={-45} />
          {`Position: ${positionAsString}`}
          <CopyIconWithTooltip value={positionAsString} title="Copy position" />
        </Space>,
      ),
    );
  }

  if (distanceToSelection != null) {
    infoRows.push(
      getInfoMenuItem(
        "distanceInfo",
        <Space size="small">
          <i className="fas fa-ruler" />
          <FastTooltip title="Distance to the active Node of the active Tree">
            {`${distanceToSelection[0]} (${distanceToSelection[1]}) to this
            ${maybeClickedNodeId != null ? "Node" : "Position"}`}
          </FastTooltip>
          <CopyIconWithTooltip value={distanceToSelection[0]} title="Copy the distance" />
        </Space>,
      ),
    );
  }

  if (wasSegmentOrMeshClicked) {
    infoRows.push(
      getInfoMenuItem(
        "copy-cell",
        <Space size="small">
          <Icon component={IconCell} />
          {`Segment ID: ${clickedSegmentOrMeshId}`}
          <CopyIconWithTooltip value={clickedSegmentOrMeshId} title="Copy Segment ID" />
        </Space>,
      ),
    );
  }

  if (segments != null && wasSegmentOrMeshClicked) {
    const segmentName = segments.getNullable(clickedSegmentOrMeshId)?.name;
    if (segmentName != null) {
      const maxNameLength = 20;
      const segmentNameLabel =
        segmentName.length > maxNameLength
          ? truncateStringToLength(segmentName, maxNameLength)
          : segmentName;
      infoRows.push(
        getInfoMenuItem(
          "copy-cell",
          <Space size="small">
            <TagOutlined />
            {`Segment Name: ${segmentNameLabel}`}
            <CopyIconWithTooltip value={segmentName} title="Copy Segment Name" />
          </Space>,
        ),
      );
    }
  }

  if (areSegmentStatisticsAvailable && segmentStatsTriggerDate != null) {
    infoRows.push(
      getInfoMenuItem(
        "surfaceInfo",
        <Space size="small">
          <i>m²</i>
          {`Surface Area: ${segmentSurfaceAreaLabel}`}
          <CopyIconWithTooltip value={segmentSurfaceAreaLabel} title="Copy surface area" />
        </Space>,
      ),
    );

    infoRows.push(
      getInfoMenuItem(
        "volumeInfo",
        <Space size="small">
          <i>m³</i>
          {`Volume: ${segmentVolumeLabel}`}
          <CopyIconWithTooltip value={segmentVolumeLabel} title="Copy volume" />
        </Space>,
      ),
    );

    infoRows.push(
      getInfoMenuItem(
        "boundingBoxPositionInfo",
        <Space size="small">
          <i className="fas fa-dice-d6 " />
          {`Bounding Box: ${boundingBoxInfoLabel}`}
          <CopyIconWithTooltip
            value={boundingBoxInfoLabel}
            title="Copy BBox top left point and extent"
          />
        </Space>,
      ),
    );
  }

  if (infoRows.length > 0) {
    infoRows.unshift({
      key: "divider",
      type: "divider",
      className: "hide-if-first hide-if-last",
      style: {
        margin: "4px 0px",
      },
    });
  }

  return {
    infoRows,
  };
}
