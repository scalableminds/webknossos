import { WarningOutlined } from "@ant-design/icons";
import { Empty, Modal } from "antd";
import type { ItemType, MenuItemType } from "antd/es/menu/interface";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import React from "react";
import { useDispatch } from "react-redux";
import { CtrlOrCmdKey } from "viewer/constants";
import {
  loadAgglomerateSkeletonAtPosition,
  loadSynapsesOfAgglomerateAtPosition,
} from "viewer/controller/combinations/segmentation_handlers";
import { handleCreateNodeFromGlobalPosition } from "viewer/controller/combinations/skeleton_handlers";
import {
  getSegmentIdForPosition,
  getSegmentIdForPositionAsync,
  getUnmappedSegmentIdForPosition,
  handleFloodFillFromGlobalPosition,
} from "viewer/controller/combinations/volume_handlers";
import {
  getMappingInfo,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import { globalToLayerTransformedPosition } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { getDisabledInfoForTools } from "viewer/model/accessors/disabled_tool_accessor";
import { areGeometriesTransformed } from "viewer/model/accessors/skeletontracing_accessor";
import { AnnotationTool, VolumeTools } from "viewer/model/accessors/tool_accessor";
import {
  getActiveCellId,
  getActiveSegmentationTracing,
  hasAgglomerateMapping,
  hasConnectomeFile,
} from "viewer/model/accessors/volumetracing_accessor";
import { maybeFetchMeshFilesAction } from "viewer/model/actions/annotation_actions";
import { ensureLayerMappingsAreLoadedAction } from "viewer/model/actions/dataset_actions";
import {
  cutAgglomerateFromNeighborsAction,
  minCutAgglomerateWithPositionAction,
  proofreadMergeAction,
} from "viewer/model/actions/proofread_actions";
import {
  loadAdHocMeshAction,
  loadPrecomputedMeshAction,
} from "viewer/model/actions/segmentation_actions";
import { createTreeAction } from "viewer/model/actions/skeletontracing_actions";
import { getUpdateSegmentActionToToggleVisibility } from "viewer/model/actions/volumetracing_action_helpers";
import {
  clickSegmentAction,
  setActiveCellAction,
  setHideUnregisteredSegmentsAction,
  toggleAllSegmentsAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import type { ContextMenuInfo } from "viewer/store";
import Store from "viewer/store";
import { withMappingActivationConfirmation } from "viewer/view/right_border_tabs/segments_tab/segments_view_helper";
import { LayoutEvents, layoutEmitter } from "../layouting/layout_persistence";
import { LoadMeshMenuItemLabel } from "../right_border_tabs/segments_tab/load_mesh_menu_item_label";
import { useBoundingBoxMenuOptions } from "./bounding_box_menu_options";
import { shortcutBuilder } from "./helpers";
import { useMeshItems } from "./mesh_items";
import { useMultiCutToolOptions } from "./min_cut_item";

export function useNoNodeContextMenuOptions(
  contextInfo: ContextMenuInfo,
  segmentIdAtPosition: number,
  infoRows: ItemType[],
): ItemType[] {
  const { globalPosition } = contextInfo;

  const skeletonTracing = useWkSelector((state) => state.annotation.skeleton);
  const volumeTracing = useWkSelector(getActiveSegmentationTracing);
  const activeTool = useWkSelector((state) => state.uiInformation.activeTool);
  const additionalCoordinates = useWkSelector(
    (state) => state.flycam.additionalCoordinates || undefined,
  );
  const viewport = contextInfo.viewport;
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const dataset = useWkSelector((state) => state.dataset);

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

  const activeMappingByLayer = useWkSelector(
    (state) => state.temporaryConfiguration.activeMappingByLayer,
  );
  const mappingInfo = getMappingInfo(
    activeMappingByLayer,
    visibleSegmentationLayer != null ? visibleSegmentationLayer.name : null,
  );

  const allowUpdate = useWkSelector((state) => state.annotation.isUpdatingCurrentlyAllowed);

  const maybeUnmappedSegmentId =
    globalPosition != null ? getUnmappedSegmentIdForPosition(globalPosition) : null;

  const boundingBoxActions = useBoundingBoxMenuOptions(contextInfo);
  const meshRelatedItems = useMeshItems(contextInfo);

  const isProofreadingActive = useWkSelector(
    (state) => state.uiInformation.activeTool === AnnotationTool.PROOFREAD,
  );

  const segmentIdLabel =
    isProofreadingActive && maybeUnmappedSegmentId != null
      ? `within Segment ${maybeUnmappedSegmentId}`
      : segmentIdAtPosition;
  const segmentOrSuperVoxel =
    isProofreadingActive && maybeUnmappedSegmentId != null ? "Supervoxel" : "Segment";

  const proofreadingMultiSplitToolActions = useMultiCutToolOptions(
    maybeUnmappedSegmentId ?? 0,
    segmentIdAtPosition,
    segmentOrSuperVoxel,
    segmentIdLabel,
  );

  // Remaining hook logic needs full state inspection for dispatch
  const state = Store.getState();
  const disabledVolumeInfo = getDisabledInfoForTools(state);
  const isAgglomerateMappingEnabled = hasAgglomerateMapping(state);
  const isConnectomeMappingEnabled = hasConnectomeFile(state);
  const { isMultiSplitActive } = state.userConfiguration;
  const maybeMinCutPartitions = volumeTracing
    ? state.localSegmentationData[volumeTracing.tracingId]?.minCutPartitions
    : null;

  const dispatch = useDispatch();

  React.useEffect(() => {
    dispatch(maybeFetchMeshFilesAction(visibleSegmentationLayer, dataset, false));
  }, [dispatch, visibleSegmentationLayer, dataset]);

  const positionInLayerSpace =
    globalPosition != null && visibleSegmentationLayer != null
      ? globalToLayerTransformedPosition(
          globalPosition,
          visibleSegmentationLayer.name,
          "segmentation",
          Store.getState(),
        )
      : null;

  const loadPrecomputedMesh = async () => {
    if (
      !currentMeshFile ||
      !visibleSegmentationLayer ||
      globalPosition == null ||
      positionInLayerSpace == null
    )
      return;
    const segmentId = await getSegmentIdForPositionAsync(globalPosition);

    if (segmentId === 0) {
      Toast.info("No segment found at the clicked position");
      return;
    }

    dispatch(
      loadPrecomputedMeshAction(
        segmentId,
        positionInLayerSpace,
        additionalCoordinates,
        currentMeshFile.name,
        undefined,
        undefined,
      ),
    );
  };

  const maybeFocusSegment = () => {
    if (!visibleSegmentationLayer || globalPosition == null) {
      return;
    }
    const clickedSegmentId = getSegmentIdForPosition(globalPosition);
    const layerName = visibleSegmentationLayer.name;
    if (clickedSegmentId === 0) {
      Toast.info("No segment found at the clicked position");
      return;
    }
    dispatch(
      clickSegmentAction(clickedSegmentId, globalPosition, additionalCoordinates, layerName),
    );
    layoutEmitter.emit(LayoutEvents.showSegmentsTab);
  };

  const onlyShowSegment = () => {
    if (!visibleSegmentationLayer || globalPosition == null) {
      return;
    }
    const clickedSegmentId = getSegmentIdForPosition(globalPosition);
    if (clickedSegmentId === 0) {
      Toast.info("No segment found at the clicked position");
      return;
    }

    dispatch(setHideUnregisteredSegmentsAction(true, visibleSegmentationLayer.name));
    dispatch(toggleAllSegmentsAction(visibleSegmentationLayer.name, false));
    dispatch(
      updateSegmentAction(
        clickedSegmentId,
        {
          isVisible: true,
          somePosition: globalPosition,
          someAdditionalCoordinates: additionalCoordinates,
        },
        visibleSegmentationLayer.name,
        undefined,
        true,
      ),
    );
  };

  const showAllSegments = () => {
    if (!visibleSegmentationLayer) {
      return;
    }

    dispatch(setHideUnregisteredSegmentsAction(false, visibleSegmentationLayer.name));
    dispatch(toggleAllSegmentsAction(visibleSegmentationLayer.name, true));
  };

  const toggleSegmentVisibility = () => {
    if (!visibleSegmentationLayer || globalPosition == null) {
      return;
    }
    const clickedSegmentId = getSegmentIdForPosition(globalPosition);
    if (clickedSegmentId === 0) {
      Toast.info("No segment found at the clicked position");
      return;
    }

    const action = getUpdateSegmentActionToToggleVisibility(
      Store.getState(),
      clickedSegmentId,
      globalPosition,
      additionalCoordinates,
    );
    if (action != null) {
      dispatch(action);
    }
  };

  const computeMeshAdHoc = () => {
    if (!visibleSegmentationLayer || globalPosition == null || positionInLayerSpace == null) {
      return;
    }

    const segmentId = getSegmentIdForPosition(globalPosition);

    if (segmentId === 0) {
      Toast.info("No segment found at the clicked position");
      return;
    }

    dispatch(loadAdHocMeshAction(segmentId, positionInLayerSpace, additionalCoordinates));
  };

  const showAutomatedSegmentationServicesModal = (errorMessage: string, entity: string) =>
    Modal.info({
      title: "Get More out of WEBKNOSSOS",
      content: (
        <>
          {errorMessage} {entity} are created as part of our automated segmentation services.{" "}
          <a
            target="_blank"
            href="https://webknossos.org/services/automated-segmentation"
            rel="noreferrer noopener"
          >
            Learn more.
          </a>
        </>
      ),
      onOk() {},
    });

  const isVolumeBasedToolActive = VolumeTools.includes(activeTool);
  const isBoundingBoxToolActive = activeTool === AnnotationTool.BOUNDING_BOX;
  const globalPositionForNode = globalPosition
    ? { rounded: globalPosition, floating: globalPosition }
    : undefined;

  const skeletonActions: ItemType[] =
    skeletonTracing != null &&
    globalPosition != null &&
    globalPositionForNode != null &&
    allowUpdate
      ? [
          {
            key: "create-node",
            onClick: () =>
              handleCreateNodeFromGlobalPosition(globalPositionForNode, viewport!, false),
            label: "Create Node here",
            disabled: areGeometriesTransformed(state),
          },
          {
            key: "create-node-with-tree",
            onClick: () => {
              dispatch(createTreeAction());
              handleCreateNodeFromGlobalPosition(globalPositionForNode, viewport!, false);
            },
            label: (
              <>
                Create new Tree here{" "}
                {!isVolumeBasedToolActive && !isBoundingBoxToolActive
                  ? shortcutBuilder(["C"])
                  : null}
              </>
            ),
            disabled: areGeometriesTransformed(state),
          },
          {
            key: "load-agglomerate-skeleton",
            onClick: () =>
              isAgglomerateMappingEnabled.value
                ? loadAgglomerateSkeletonAtPosition(globalPosition)
                : showAutomatedSegmentationServicesModal(
                    isAgglomerateMappingEnabled.reason,
                    "Agglomerate files",
                  ),
            label: (
              <FastTooltip
                title={
                  isAgglomerateMappingEnabled.value ? undefined : isAgglomerateMappingEnabled.reason
                }
                onMouseEnter={() => {
                  dispatch(ensureLayerMappingsAreLoadedAction());
                }}
              >
                <span>
                  Import Agglomerate Skeleton{" "}
                  {!isAgglomerateMappingEnabled.value ? (
                    <WarningOutlined style={{ color: "var(--ant-color-text-disabled)" }} />
                  ) : null}{" "}
                  {shortcutBuilder(["Shift", "middleMouse"])}
                </span>
              </FastTooltip>
            ),
          },

          ...(isProofreadingActive &&
          isMultiSplitActive &&
          maybeMinCutPartitions &&
          maybeUnmappedSegmentId
            ? proofreadingMultiSplitToolActions
            : []),
          isAgglomerateMappingEnabled.value
            ? {
                key: "merge-agglomerate-skeleton",
                disabled: !isProofreadingActive,
                onClick: () => dispatch(proofreadMergeAction(globalPosition)),
                label: (
                  <FastTooltip
                    title={
                      isProofreadingActive
                        ? undefined
                        : "Cannot merge because the proofreading tool is not active."
                    }
                  >
                    <span>
                      Merge with active segment{" "}
                      {isMultiSplitActive ? "" : shortcutBuilder(["Shift", "leftMouse"])}
                    </span>
                  </FastTooltip>
                ),
              }
            : null,
          isAgglomerateMappingEnabled.value
            ? {
                key: "min-cut-agglomerate-at-position",
                disabled: !isProofreadingActive,
                onClick: () => dispatch(minCutAgglomerateWithPositionAction(globalPosition)),
                label: (
                  <FastTooltip
                    title={
                      isProofreadingActive
                        ? undefined
                        : "Cannot split because the proofreading tool is not active."
                    }
                  >
                    <span>
                      Split from active segment{" "}
                      {isMultiSplitActive ? "" : shortcutBuilder([CtrlOrCmdKey, "leftMouse"])}
                    </span>
                  </FastTooltip>
                ),
              }
            : null,
          isAgglomerateMappingEnabled.value
            ? {
                key: "cut-agglomerate-from-neighbors",
                disabled: !isProofreadingActive,
                onClick: () => dispatch(cutAgglomerateFromNeighborsAction(globalPosition)),
                label: (
                  <FastTooltip
                    title={
                      isProofreadingActive
                        ? undefined
                        : "Cannot cut because the proofreading tool is not active."
                    }
                  >
                    Split from all neighboring segments
                  </FastTooltip>
                ),
              }
            : null,
        ]
      : [];
  const segmentationLayerName =
    visibleSegmentationLayer != null ? visibleSegmentationLayer.name : null;

  if (visibleSegmentationLayer != null && globalPosition != null) {
    const connectomeFileMappingName =
      currentConnectomeFile != null ? currentConnectomeFile.mappingName : undefined;
    const loadSynapsesItem: MenuItemType = {
      className: "node-context-menu-item",
      key: "load-synapses",
      onClick: isConnectomeMappingEnabled.value
        ? withMappingActivationConfirmation(
            () => loadSynapsesOfAgglomerateAtPosition(globalPosition),
            connectomeFileMappingName,
            "connectome file",
            segmentationLayerName,
            mappingInfo,
          )
        : () =>
            showAutomatedSegmentationServicesModal(
              isConnectomeMappingEnabled.reason,
              "Connectome files",
            ),
      label: isConnectomeMappingEnabled.value ? (
        "Import Synapses"
      ) : (
        <FastTooltip title={isConnectomeMappingEnabled.reason}>
          Import Synapses{" "}
          {!isConnectomeMappingEnabled.value ? (
            <WarningOutlined style={{ color: "var(--ant-color-text-disabled)" }} />
          ) : null}{" "}
        </FastTooltip>
      ),
    };
    skeletonActions.push(loadSynapsesItem);
  }

  const meshFileMappingName = currentMeshFile != null ? currentMeshFile.mappingName : undefined;
  const focusInSegmentListItem: MenuItemType = {
    key: "focus-in-segment-list",
    onClick: maybeFocusSegment,
    label: "Focus in Segment List",
  };
  const onlyShowThisSegmentItem: MenuItemType = {
    key: "only-show-this-segment",
    onClick: onlyShowSegment,
    label: "Only show this Segment",
  };
  const toggleSegmentVisibilityItem: MenuItemType = {
    key: "toggle-segment-visibility",
    onClick: toggleSegmentVisibility,
    label: "Toggle visibility of this Segment",
  };
  const showAllSegmentsItem: MenuItemType = {
    key: "show-all-segments",
    onClick: showAllSegments,
    label: "Show all Segments",
  };
  const loadPrecomputedMeshItem: MenuItemType = {
    key: "load-precomputed-mesh",
    disabled: !currentMeshFile,
    onClick: withMappingActivationConfirmation(
      loadPrecomputedMesh,
      meshFileMappingName,
      "mesh file",
      segmentationLayerName,
      mappingInfo,
    ),
    label: (
      <LoadMeshMenuItemLabel currentMeshFile={currentMeshFile} volumeTracing={volumeTracing} />
    ),
  };
  const computeMeshAdHocItem = {
    key: "compute-mesh-adhc",
    onClick: computeMeshAdHoc,
    label: "Compute Mesh (ad-hoc)",
  };
  const nonSkeletonActions: ItemType[] =
    globalPosition != null && visibleSegmentationLayer != null
      ? [
          segmentIdAtPosition !== 0 && !disabledVolumeInfo.VOXEL_PIPETTE.isDisabled
            ? {
                key: "select-cell",
                onClick: () => {
                  dispatch(
                    setActiveCellAction(
                      segmentIdAtPosition,
                      positionInLayerSpace || globalPosition,
                      additionalCoordinates,
                    ),
                  );
                },
                disabled:
                  volumeTracing == null || segmentIdAtPosition === getActiveCellId(volumeTracing),
                label: (
                  <>
                    Activate Segment ({segmentIdAtPosition}){" "}
                    {isVolumeBasedToolActive ? shortcutBuilder(["Shift", "leftMouse"]) : null}
                  </>
                ),
              }
            : null,
          segmentIdAtPosition !== 0 ? onlyShowThisSegmentItem : null,
          segmentIdAtPosition !== 0 ? toggleSegmentVisibilityItem : null,
          segmentIdAtPosition !== 0 ? showAllSegmentsItem : null,
          focusInSegmentListItem,
          loadPrecomputedMeshItem,
          computeMeshAdHocItem,
          allowUpdate && !disabledVolumeInfo.FILL_CELL.isDisabled
            ? {
                key: "fill-cell",
                onClick: () =>
                  handleFloodFillFromGlobalPosition(Store.getState(), globalPosition, viewport!),
                label: "Fill Segment (flood-fill region)",
              }
            : null,
        ]
      : [];

  const isSkeletonToolActive = activeTool === AnnotationTool.SKELETON;
  let allActions: ItemType[] = [];

  if (isSkeletonToolActive) {
    allActions = [...skeletonActions, ...nonSkeletonActions, ...boundingBoxActions];
  } else if (isBoundingBoxToolActive) {
    allActions = [...boundingBoxActions, ...nonSkeletonActions, ...skeletonActions];
  } else {
    allActions = [...nonSkeletonActions, ...skeletonActions, ...boundingBoxActions];
  }
  if (meshRelatedItems) {
    allActions = allActions.concat(meshRelatedItems);
  }

  const empty: ItemType = {
    key: "empty",
    label: <Empty description="No actions available" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
  };

  const menuItems =
    allActions.length + infoRows.length > 0 ? [...allActions, ...infoRows] : [empty];

  return menuItems;
}
