import Icon, {
  ArrowRightOutlined,
  BarChartOutlined,
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExpandAltOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  ShrinkOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import LoadMeshesIcon from "@images/icons/icon-load-meshes.svg?react";
import PipetteIcon from "@images/icons/icon-pipette.svg?react";
import { App, Divider, type MenuProps } from "antd";
import type { ItemType } from "antd/es/menu/interface";
import {
  ChangeColorMenuItemContent,
  ChangeRGBAColorMenuItemContent,
} from "components/color_picker";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { pluralize, take3 } from "libs/utils";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import Constants, { type Vector3 } from "viewer/constants";
import {
  getMappingInfo,
  getMaybeSegmentIndexAvailability,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  getActiveSegmentationTracing,
  getSegmentColorAsRGBA,
  getSegmentName,
  getVisibleSegments,
} from "viewer/model/accessors/volumetracing_accessor";
import { updateMeshOpacityAction } from "viewer/model/actions/annotation_actions";
import {
  deleteSegmentDataAction,
  removeSegmentAction,
  setActiveCellAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import type { Segment } from "viewer/store";
import Store from "viewer/store";
import { getDescendantGroupIds } from "../shared/tree_hierarchy_view_helpers";
import {
  getGroupUiNodeKey,
  type SegmentGroupUiNode,
  type SegmentsHierarchy,
  type SegmentUiNode,
} from "./hierarchy";
import type { MeshFiles } from "./hooks/use_mesh_files";
import type { MeshOperations } from "./hooks/use_mesh_operations";
import type { SegmentGroupOperations } from "./hooks/use_segment_group_operations";
import type { SegmentSelection } from "./hooks/use_segment_selection";
import { useSegmentStatisticsFile } from "./hooks/use_segment_statistics_file";
import { LoadMeshMenuItemLabel } from "./load_mesh_menu_item_label";
import {
  mayEditVisibleSegmentation,
  withMappingActivationConfirmation,
} from "./segments_view_helper";

const ALSO_DELETE_SEGMENT_FROM_LIST_KEY = "also-delete-segment-from-list";

export type SegmentContextMenuBuilder = (node: SegmentUiNode) => MenuProps;
export type GroupContextMenuBuilder = (node: SegmentGroupUiNode) => MenuProps;

/*
 * What the segment statistics modal was opened for. A group is passed by id so that the modal
 * always reflects the group's current contents, whereas an explicit selection is passed as-is.
 */
export type SegmentStatisticsTarget =
  | { kind: "group"; groupId: number }
  | { kind: "segments"; segments: Segment[] };

export type ContextMenuDependencies = {
  hierarchy: SegmentsHierarchy;
  selection: SegmentSelection;
  groupOperations: SegmentGroupOperations;
  meshOperations: MeshOperations;
  meshFiles: MeshFiles;
  openStatisticsModal: (target: SegmentStatisticsTarget) => void;
  hideContextMenu: () => void;
};

function getColorOfFirstSegmentOrGrey(segments: Segment[]): Vector3 {
  return segments[0]?.color ?? [0.5, 0.5, 0.5];
}

/*
 * Menu items that operate on a list of segments (a single segment, the current multi-selection, or
 * all segments of a group). Used by all three segment context menus, so that an entry offered in
 * more than one of them is defined and gated in exactly one place.
 */
function useSegmentListMenuItems({
  groupOperations,
  meshOperations,
  meshFiles,
  openStatisticsModal,
  hideContextMenu,
}: Pick<
  ContextMenuDependencies,
  "groupOperations" | "meshOperations" | "meshFiles" | "openStatisticsModal" | "hideContextMenu"
>) {
  const dispatch = useDispatch();
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const isSegmentIndexAvailable = useWkSelector((state) =>
    getMaybeSegmentIndexAvailability(state.dataset, visibleSegmentationLayer?.name),
  );
  // A segment statistics file can serve volume and surface area on its own, so the modal is also
  // worth offering on datasets that have no segment index.
  const { fileInfo: segmentStatisticsFileInfo } =
    useSegmentStatisticsFile(visibleSegmentationLayer);
  const areSegmentStatisticsAvailable =
    isSegmentIndexAvailable || segmentStatisticsFileInfo != null;

  return useCallback(
    (
      segments: Segment[],
      // A group passes itself so that the modal tracks its live contents and the CSV is named after
      // it; a plain selection is reported as the segments it consists of.
      statisticsTarget: SegmentStatisticsTarget = { kind: "segments", segments },
    ) => {
      const runAndHide = (action: () => void) => () => {
        action();
        hideContextMenu();
      };

      // Defined here so that the group, multi-select and single-segment menus all offer the exact
      // same entry, gated the same way.
      const segmentStatisticsItem: ItemType = areSegmentStatisticsAvailable
        ? {
            key: "segmentStatistics",
            icon: <BarChartOutlined />,
            label: "Show Segment Statistics",
            onClick: runAndHide(() => openStatisticsModal(statisticsTarget)),
          }
        : null;

      const loadPrecomputedItem: ItemType = {
        key: "loadByFile",
        disabled: meshFiles.currentMeshFile == null,
        icon: <Icon component={LoadMeshesIcon} />,
        label: "Load Meshes (precomputed)",
        onClick: runAndHide(() => meshOperations.loadPrecomputedMeshes(segments)),
      };

      const computeAdHocItem: ItemType = {
        key: "computeAdHoc",
        icon: <Icon component={LoadMeshesIcon} />,
        label: "Compute Meshes (ad-hoc)",
        onClick: runAndHide(() => meshOperations.loadAdHocMeshes(segments)),
      };

      const hasMeshes = meshOperations.hasAnyMeshes(segments);
      const { areSomeMeshesVisible, areSomeMeshesInvisible } =
        meshOperations.getMeshVisibilityState(segments);

      const meshManagementItems: ItemType[] = hasMeshes
        ? [
            areSomeMeshesInvisible
              ? {
                  key: "showMeshes",
                  icon: <EyeOutlined />,
                  label: "Show Meshes",
                  onClick: runAndHide(() => meshOperations.setMeshVisibility(segments, true)),
                }
              : null,
            areSomeMeshesVisible
              ? {
                  key: "hideMeshes",
                  icon: <EyeInvisibleOutlined />,
                  label: "Hide Meshes",
                  onClick: runAndHide(() => meshOperations.setMeshVisibility(segments, false)),
                }
              : null,
            {
              key: "reloadMeshes",
              icon: <ReloadOutlined />,
              label: "Refresh Meshes",
              onClick: runAndHide(() => meshOperations.refreshMeshes(segments)),
            },
            {
              key: "removeMeshes",
              icon: <DeleteOutlined />,
              label: "Remove Meshes",
              onClick: runAndHide(() => meshOperations.removeMeshes(segments)),
            },
            {
              key: "downloadAllMeshes",
              icon: <DownloadOutlined />,
              label: "Download Meshes",
              onClick: runAndHide(() => meshOperations.downloadMeshes(segments)),
            },
          ]
        : [];

      const setColorItem: ItemType = {
        key: "changeGroupColor",
        icon: <Icon component={PipetteIcon} />,
        label: (
          <ChangeColorMenuItemContent
            title="Change Segment Color"
            isDisabled={false}
            onSetColor={(color) => groupOperations.setSegmentColor(segments, color)}
            rgb={getColorOfFirstSegmentOrGrey(segments)}
          />
        ),
      };

      const resetColorItem: ItemType = {
        key: "resetGroupColor",
        icon: <UndoOutlined />,
        label: "Reset Segment Colors",
        onClick: runAndHide(() => groupOperations.setSegmentColor(segments, null)),
      };

      const removeFromListItem: ItemType = {
        key: "removeSegments",
        icon: <CloseOutlined />,
        label: "Remove Segments From List",
        onClick: runAndHide(() => {
          if (visibleSegmentationLayer == null) {
            return;
          }
          for (const segment of segments) {
            dispatch(removeSegmentAction(segment.id, visibleSegmentationLayer.name));
          }
        }),
      };

      return {
        loadPrecomputedItem,
        computeAdHocItem,
        meshManagementItems,
        setColorItem,
        resetColorItem,
        removeFromListItem,
        segmentStatisticsItem,
      };
    },
    [
      dispatch,
      visibleSegmentationLayer,
      groupOperations,
      meshOperations,
      meshFiles,
      areSegmentStatisticsAvailable,
      openStatisticsModal,
      hideContextMenu,
    ],
  );
}

/*
 * Builds the context menu for a single segment. If the right-clicked segment is part
 * of a multi-selection, a menu that operates on all selected segments is built instead.
 */
export function useSegmentContextMenuBuilder(
  dependencies: ContextMenuDependencies,
): SegmentContextMenuBuilder {
  const { selection, meshOperations, meshFiles, hideContextMenu } = dependencies;
  const dispatch = useDispatch();
  const { modal } = App.useApp();
  const allowUpdate = useWkSelector(mayEditVisibleSegmentation);
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const activeVolumeTracing = useWkSelector(getActiveSegmentationTracing);
  const mappingInfo = useWkSelector((state) =>
    getMappingInfo(
      state.temporaryConfiguration.activeMappingByLayer,
      visibleSegmentationLayer?.name,
    ),
  );
  const getSegmentListMenuItems = useSegmentListMenuItems(dependencies);

  const buildMultiSelectMenu = useCallback((): MenuProps => {
    const items = getSegmentListMenuItems(selection.selectedSegments);
    return {
      items: [
        items.loadPrecomputedItem,
        items.computeAdHocItem,
        ...items.meshManagementItems,
        items.setColorItem,
        items.resetColorItem,
        items.removeFromListItem,
        items.segmentStatisticsItem,
      ],
    };
  }, [getSegmentListMenuItems, selection.selectedSegments]);

  const buildSingleSegmentMenu = useCallback(
    (segment: Segment): MenuProps => {
      const layerName = visibleSegmentationLayer?.name;
      const { currentMeshFile } = meshFiles;
      const mesh = meshOperations.meshes[segment.id.toString()];
      const segmentColorRGBA = getSegmentColorAsRGBA(Store.getState(), segment.id);
      const isActiveSegment = segment.id === activeVolumeTracing?.activeCellId;

      const runAndHide = (action: () => void) => () => {
        action();
        hideContextMenu();
      };

      const withKnownPosition = (action: () => void) => () => {
        if (segment.anchorPosition == null) {
          Toast.info("Cannot load a mesh for this segment, because its position is unknown.");
          hideContextMenu();
          return;
        }
        action();
        hideContextMenu();
      };

      const updateThisSegment = (updates: Partial<Segment>, createsNewUndoState: boolean) => {
        if (layerName != null) {
          dispatch(
            updateSegmentAction(segment.id, updates, layerName, undefined, createsNewUndoState),
          );
        }
      };

      const confirmDeleteSegmentData = () => {
        if (layerName == null) {
          return;
        }
        modal.confirm({
          content: `Are you sure you want to delete the data of segment ${getSegmentName(
            segment,
            true,
          )}? This operation will set all voxels with id ${segment.id} to 0.`,
          okText: "Yes, delete",
          okType: "danger",
          onOk: async () => {
            await new Promise<void>((resolve) =>
              dispatch(deleteSegmentDataAction(segment.id, layerName, resolve)),
            );
            Toast.info(
              <span>
                The data of segment {getSegmentName(segment, true)} was deleted.{" "}
                <a
                  href="#"
                  onClick={() => {
                    dispatch(removeSegmentAction(segment.id, layerName));
                    Toast.close(ALSO_DELETE_SEGMENT_FROM_LIST_KEY);
                  }}
                >
                  Also remove from list.
                </a>
              </span>,
              { key: ALSO_DELETE_SEGMENT_FROM_LIST_KEY },
            );
          },
        });
        hideContextMenu();
      };

      return {
        items: [
          {
            key: "loadPrecomputedMesh",
            disabled: currentMeshFile == null,
            onClick: withMappingActivationConfirmation(
              withKnownPosition(() => meshOperations.loadPrecomputedMeshes([segment])),
              currentMeshFile?.mappingName,
              "mesh file",
              layerName,
              mappingInfo,
            ),
            label: (
              <LoadMeshMenuItemLabel
                currentMeshFile={currentMeshFile}
                volumeTracing={activeVolumeTracing}
              />
            ),
          },
          {
            key: "loadAdHocMesh",
            onClick: withKnownPosition(() => meshOperations.loadAdHocMeshes([segment])),
            label: (
              <FastTooltip title="Compute mesh for this segment.">
                Compute Mesh (ad-hoc)
              </FastTooltip>
            ),
          },
          {
            key: "setActiveCell",
            disabled: isActiveSegment || !allowUpdate,
            onClick: runAndHide(() =>
              dispatch(
                setActiveCellAction(
                  segment.id,
                  segment.anchorPosition,
                  segment.additionalCoordinates,
                ),
              ),
            ),
            label: (
              <FastTooltip
                title={
                  isActiveSegment
                    ? "This segment ID is already active."
                    : "Make this the active segment ID."
                }
                disabled={!allowUpdate}
              >
                Activate Segment ID
              </FastTooltip>
            ),
          },
          {
            key: `changeSegmentColor-${segment.id}`,
            label: mesh?.isVisible ? (
              <ChangeRGBAColorMenuItemContent
                title="Change Segment Color"
                onSetColor={(color, createsNewUndoState) => {
                  updateThisSegment({ color: take3(color) }, createsNewUndoState);
                  if (layerName != null) {
                    dispatch(updateMeshOpacityAction(layerName, segment.id, color[3]));
                  }
                }}
                rgba={[...take3(segmentColorRGBA), mesh?.opacity ?? Constants.DEFAULT_MESH_OPACITY]}
              />
            ) : (
              <ChangeColorMenuItemContent
                isDisabled={false}
                title="Change Segment Color"
                onSetColor={(color, createsNewUndoState) => {
                  updateThisSegment({ color }, createsNewUndoState);
                }}
                rgb={take3(segmentColorRGBA)}
              />
            ),
          },
          {
            key: "resetSegmentColor",
            disabled: segment.color == null,
            onClick: runAndHide(() => updateThisSegment({ color: null }, true)),
            label: "Reset Segment Color",
          },
          {
            key: "removeSegmentFromList",
            onClick: runAndHide(() => {
              if (layerName != null) {
                dispatch(removeSegmentAction(segment.id, layerName));
              }
            }),
            label: "Remove Segment From List",
          },
          {
            key: "deleteSegmentData",
            onClick: confirmDeleteSegmentData,
            disabled:
              activeVolumeTracing == null ||
              !activeVolumeTracing.hasSegmentIndex ||
              // Not supported for fallback layers, yet.
              activeVolumeTracing.fallbackLayer != null,
            label: "Delete Segment's Data",
          },
          getSegmentListMenuItems([segment]).segmentStatisticsItem,
        ],
      };
    },
    [
      getSegmentListMenuItems,
      dispatch,
      modal,
      allowUpdate,
      visibleSegmentationLayer,
      activeVolumeTracing,
      mappingInfo,
      meshOperations,
      meshFiles,
      hideContextMenu,
    ],
  );

  return useCallback(
    (node: SegmentUiNode): MenuProps => {
      const isPartOfMultiSelection =
        selection.selectedSegmentIds.length > 1 &&
        selection.selectedSegmentIds.includes(node.segment.id);
      return isPartOfMultiSelection ? buildMultiSelectMenu() : buildSingleSegmentMenu(node.segment);
    },
    [selection.selectedSegmentIds, buildMultiSelectMenu, buildSingleSegmentMenu],
  );
}

/*
 * Builds the context menu for a (possibly virtual root) segment group.
 */
export function useGroupContextMenuBuilder(
  dependencies: ContextMenuDependencies,
): GroupContextMenuBuilder {
  const { hierarchy, selection, groupOperations, hideContextMenu } = dependencies;
  const allowUpdate = useWkSelector(mayEditVisibleSegmentation);
  const segmentGroups = useWkSelector((state) => getVisibleSegments(state).segmentGroups);
  const getSegmentListMenuItems = useSegmentListMenuItems(dependencies);

  return useCallback(
    (node: SegmentGroupUiNode): MenuProps => {
      const groupId = node.group.groupId;
      const isEditingDisabled = !allowUpdate;
      const groupSegments = groupOperations.getSegmentsOfGroupRecursively(groupId);
      const listItems = getSegmentListMenuItems(groupSegments, { kind: "group", groupId });

      // Expand/collapse are only offered when they would actually change something.
      const expandedKeySet = new Set(hierarchy.expandedKeys);
      const subgroupKeys = getDescendantGroupIds(segmentGroups, groupId).map(getGroupUiNodeKey);
      const isGroupItselfExpanded = expandedKeySet.has(getGroupUiNodeKey(groupId));
      const areAllSubgroupsExpanded = subgroupKeys.every((key) => expandedKeySet.has(key));
      const areAllSubgroupsCollapsed = subgroupKeys.every((key) => !expandedKeySet.has(key));

      return {
        items: [
          {
            key: "create",
            onClick: () => {
              groupOperations.createGroup(groupId);
              hideContextMenu();
            },
            disabled: isEditingDisabled,
            icon: <PlusOutlined />,
            label: "Create new group",
          },
          {
            key: "delete",
            disabled: isEditingDisabled,
            onClick: () => {
              groupOperations.requestGroupDeletion(groupId);
              hideContextMenu();
            },
            icon: <DeleteOutlined />,
            label: "Delete group",
          },
          !(areAllSubgroupsExpanded && isGroupItselfExpanded)
            ? {
                key: "expandAll",
                onClick: () => {
                  groupOperations.setSubgroupsExpansion(groupId, true);
                  hideContextMenu();
                },
                icon: <ExpandAltOutlined />,
                label: "Expand all subgroups",
              }
            : null,
          !(areAllSubgroupsCollapsed || !isGroupItselfExpanded)
            ? {
                key: "collapseAll",
                onClick: () => {
                  groupOperations.setSubgroupsExpansion(groupId, false);
                  hideContextMenu();
                },
                icon: <ShrinkOutlined />,
                label: "Collapse all subgroups",
              }
            : null,
          {
            key: "moveHere",
            onClick: () => {
              groupOperations.moveSegmentsToGroup(selection.selectedSegmentIds, groupId);
              hideContextMenu();
            },
            disabled: isEditingDisabled || selection.selectedSegmentIds.length === 0,
            icon: <ArrowRightOutlined />,
            label: `Move active ${pluralize("segment", selection.selectedSegmentIds.length)} here`,
          },
          {
            key: "groupAndMeshActionDivider",
            label: <Divider style={{ marginBottom: 0, marginTop: 0 }} />,
            disabled: true,
          },
          listItems.setColorItem,
          listItems.resetColorItem,
          listItems.segmentStatisticsItem,
          listItems.loadPrecomputedItem,
          listItems.computeAdHocItem,
          ...listItems.meshManagementItems,
        ],
      };
    },
    [
      allowUpdate,
      segmentGroups,
      hierarchy.expandedKeys,
      selection.selectedSegmentIds,
      groupOperations,
      getSegmentListMenuItems,
      hideContextMenu,
    ],
  );
}
