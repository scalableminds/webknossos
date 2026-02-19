import { BarChartOutlined, PushpinOutlined, TagOutlined } from "@ant-design/icons";
import { getSegmentBoundingBoxes, getSegmentSurfaceArea, getSegmentVolumes } from "admin/rest_api";
import { Dropdown, type MenuProps, Space } from "antd";
import type { ItemType } from "antd/es/menu/interface";
import {
  formatLengthAsVx,
  formatNumberToArea,
  formatNumberToLength,
  formatNumberToVolume,
} from "libs/format_utils";
import { V3 } from "libs/mjs";
import { useFetch } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import Shortcut from "libs/shortcut_component";
import { truncateStringToLength } from "libs/utils";
import React, { useContext, useEffect, useState } from "react";
import { LongUnitToShortUnitMap } from "viewer/constants";
import {
  getSegmentIdForPosition,
  getUnmappedSegmentIdForPosition,
} from "viewer/controller/combinations/volume_handlers";
import {
  getMagInfo,
  getMappingInfo,
  getMaybeSegmentIndexAvailability,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import { isRotated } from "viewer/model/accessors/flycam_accessor";
import {
  getActiveNode,
  getNodePosition,
  getTreeAndNode,
} from "viewer/model/accessors/skeletontracing_accessor";
import { maybeGetSomeTracing } from "viewer/model/accessors/tracing_accessor";
import {
  getActiveSegmentationTracing,
  getCurrentMappingName,
  getSegmentsForLayer,
} from "viewer/model/accessors/volumetracing_accessor";
import { ensureSegmentIndexIsLoadedAction } from "viewer/model/actions/dataset_actions";
import { getBoundingBoxInMag1 } from "viewer/model/sagas/volume/helpers";
import { voxelToVolumeInUnit } from "viewer/model/scaleinfo";
import type { MutableNode, Tree } from "viewer/model/types/tree_types";
import { api } from "viewer/singletons";
import Store from "viewer/store";
import { ContextMenuContext } from "./context_menu";
import { hideContextMenu } from "./context_menu_actions";
import { CopyIconWithTooltip } from "./copy_icon_with_tooltip";
import { getInfoMenuItem, positionToString } from "./helpers";
import { getNoNodeContextMenuOptions } from "./no_node_context_menu_options";
import { getNodeContextMenuOptions } from "./node_context_menu_options";
import type { Props } from "./types";
import FastTooltip from "components/fast_tooltip";

export function ContextMenuInner() {
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const activeMappingByLayer = useWkSelector(
    (state) => state.temporaryConfiguration.activeMappingByLayer,
  );
  const mappingInfo = getMappingInfo(
    activeMappingByLayer,
    visibleSegmentationLayer != null ? visibleSegmentationLayer.name : null,
  );
  const skeletonTracing = useWkSelector((state) => state.annotation.skeleton);
  const volumeTracing = useWkSelector(getActiveSegmentationTracing);
  const voxelSize = useWkSelector((state) => state.dataset.dataSource.scale);
  const activeTool = useWkSelector((state) => state.uiInformation.activeTool);
  const dataset = useWkSelector((state) => state.dataset);
  const allowUpdate = useWkSelector((state) => state.annotation.isUpdatingCurrentlyAllowed);
  const isFlycamRotated = useWkSelector((state) => isRotated(state.flycam));

  const currentMeshFile = useWkSelector((state) =>
    visibleSegmentationLayer != null
      ? state.localSegmentationData[visibleSegmentationLayer.name].currentMeshFile
      : null,
  );
  const currentConnectomeFile = useWkSelector((state) =>
    visibleSegmentationLayer != null
      ? state.localSegmentationData[visibleSegmentationLayer.name].connectomeData
          .currentConnectomeFile
      : null,
  );

  const userBoundingBoxes = useWkSelector((state) => {
    const someTracing = maybeGetSomeTracing(state.annotation);
    return someTracing != null ? someTracing.userBoundingBoxes : [];
  });
  const segments = useWkSelector((state) =>
    visibleSegmentationLayer != null
      ? getSegmentsForLayer(state, visibleSegmentationLayer.name)
      : null,
  );
  const useLegacyBindings = useWkSelector((state) => state.userConfiguration.useLegacyBindings);
  const additionalCoordinates = useWkSelector(
    (state) => state.flycam.additionalCoordinates || undefined,
  );
  const contextInfo = useWkSelector((state) => state.uiInformation.contextInfo);
  const maybeUnmappedSegmentId =
    contextInfo.globalPosition != null
      ? getUnmappedSegmentIdForPosition(contextInfo.globalPosition)
      : null;

  const props: Props = {
    isRotated: isFlycamRotated,
    skeletonTracing,
    visibleSegmentationLayer,
    volumeTracing,
    voxelSize,
    activeTool,
    dataset,
    allowUpdate,
    currentMeshFile,
    currentConnectomeFile,
    useLegacyBindings,
    userBoundingBoxes,
    segments,
    mappingInfo,
    additionalCoordinates,
    contextInfo,
    maybeUnmappedSegmentId,
  };

  const {
    globalPosition,
    contextMenuPosition,
    meshId: maybeClickedMeshId,
    clickedNodeId: maybeClickedNodeId,
    viewport: maybeViewport,
  } = contextInfo;

  const [segmentStatsTriggerDate, setSegmentStatsTriggerDate] = useState<Date | null>(null);

  const handleRefreshSegmentStatistics = async () => {
    await api.tracing.save();
    setSegmentStatsTriggerDate(new Date());
  };

  const inputRef = useContext(ContextMenuContext);

  const segmentIdAtPosition = globalPosition != null ? getSegmentIdForPosition(globalPosition) : 0;

  // Currently either segmentIdAtPosition or maybeClickedMeshId is set, but not both.
  // segmentIdAtPosition is only set if a segment is hovered in one of the xy, xz, or yz viewports.
  // maybeClickedMeshId is only set, when a mesh is hovered in the 3d viewport.
  // Thus the segment id is always unambiguous / clearly defined.
  const clickedSegmentOrMeshId =
    maybeClickedMeshId != null ? maybeClickedMeshId : segmentIdAtPosition;
  const wasSegmentOrMeshClicked = clickedSegmentOrMeshId !== 0;

  useEffect(() => {
    Store.dispatch(ensureSegmentIndexIsLoadedAction(visibleSegmentationLayer?.name));
  }, [visibleSegmentationLayer]);
  const isSegmentIndexAvailable = getMaybeSegmentIndexAvailability(
    dataset,
    visibleSegmentationLayer?.name,
  );
  const mappingName: string | null | undefined = useWkSelector(getCurrentMappingName);
  const isLoadingMessage = "loading";
  const isLoadingLabelTuple = [isLoadingMessage, isLoadingMessage, isLoadingMessage] as const;
  const [segmentVolumeLabel, boundingBoxInfoLabel, segmentSurfaceAreaLabel] = useFetch(
    async (): Promise<readonly [string, string, string]> => {
      if (segmentStatsTriggerDate == null) {
        // Should never be rendered because segmentStatsTriggerDate is null.
        return isLoadingLabelTuple;
      }
      const { annotation, flycam } = Store.getState();
      // The value that is returned if the context menu is closed is shown if it's still loading
      if (contextMenuPosition == null || !wasSegmentOrMeshClicked) return isLoadingLabelTuple;
      if (visibleSegmentationLayer == null || !isSegmentIndexAvailable) return isLoadingLabelTuple;
      const tracingId = volumeTracing?.tracingId;
      const additionalCoordinates = flycam.additionalCoordinates;
      const layerSourceInfo = {
        dataset,
        annotation,
        tracingId,
        segmentationLayerName: visibleSegmentationLayer.name,
      };
      const magInfo = getMagInfo(visibleSegmentationLayer.mags);
      const layersFinestMag = magInfo.getFinestMag();
      const voxelSize = dataset.dataSource.scale;

      try {
        const [segmentSize] = await getSegmentVolumes(
          layerSourceInfo,
          layersFinestMag,
          [clickedSegmentOrMeshId],
          additionalCoordinates,
          mappingName,
        );
        const [boundingBoxInRequestedMag] = await getSegmentBoundingBoxes(
          layerSourceInfo,
          layersFinestMag,
          [clickedSegmentOrMeshId],
          additionalCoordinates,
          mappingName,
        );
        const [surfaceArea] = await getSegmentSurfaceArea(
          layerSourceInfo,
          layersFinestMag,
          currentMeshFile?.name,
          [clickedSegmentOrMeshId],
          additionalCoordinates,
          mappingName,
        );
        const boundingBoxInMag1 = getBoundingBoxInMag1(boundingBoxInRequestedMag, layersFinestMag);
        const boundingBoxTopLeftString = `(${boundingBoxInMag1.topLeft[0]}, ${boundingBoxInMag1.topLeft[1]}, ${boundingBoxInMag1.topLeft[2]})`;
        const boundingBoxSizeString = `(${boundingBoxInMag1.width}, ${boundingBoxInMag1.height}, ${boundingBoxInMag1.depth})`;
        const volumeInUnit3 = voxelToVolumeInUnit(voxelSize, layersFinestMag, segmentSize);
        return [
          formatNumberToVolume(volumeInUnit3, LongUnitToShortUnitMap[voxelSize.unit]),
          `${boundingBoxTopLeftString}, ${boundingBoxSizeString}`,
          formatNumberToArea(surfaceArea, LongUnitToShortUnitMap[voxelSize.unit]),
        ];
      } catch (_error) {
        const notFetchedMessage = "Could not be fetched.";
        return [notFetchedMessage, notFetchedMessage, notFetchedMessage];
      }
    },
    isLoadingLabelTuple,
    // Update segment infos when opening the context menu, in case the annotation was saved since the context menu was last opened.
    // Of course the info should also be updated when the menu is opened for another segment, or after the refresh button was pressed.
    [contextMenuPosition, isSegmentIndexAvailable, clickedSegmentOrMeshId, segmentStatsTriggerDate],
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
  // TS doesn't understand the above initialization and assumes the values
  // are always null. The following NOOP helps TS with the correct typing.
  nodeContextMenuTree = nodeContextMenuTree as Tree | null;
  nodeContextMenuNode = nodeContextMenuNode as MutableNode | null;

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
      onClick: (event) => {
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
    const positionAsString = positionToString(globalPosition, props.additionalCoordinates);

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
          <div className="cell-context-icon" />
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

  const menu: MenuProps = {
    onClick: hideContextMenu,
    style: {
      borderRadius: 6,
    },
    mode: "vertical",
    items:
      maybeViewport == null
        ? []
        : maybeClickedNodeId != null
          ? getNodeContextMenuOptions({
              clickedNodeId: maybeClickedNodeId,
              infoRows,
              viewport: maybeViewport,
              ...props,
            })
          : getNoNodeContextMenuOptions({
              segmentIdAtPosition,
              infoRows,
              viewport: maybeViewport,
              ...props,
            }),
  };

  if (inputRef == null || inputRef.current == null) return null;
  const refContent = inputRef.current;

  return (
    <React.Fragment>
      <Shortcut supportInputElements keys="escape" onTrigger={hideContextMenu} />

      <Dropdown
        menu={menu}
        classNames={{ root: "dropdown-overlay-container-for-context-menu" }}
        open={contextMenuPosition != null}
        getPopupContainer={() => refContent}
        destroyOnHidden
      >
        <div />
      </Dropdown>
    </React.Fragment>
  );
}
