import type { MenuItemType } from "antd/es/menu/interface";
import FastTooltip from "components/fast_tooltip";
import { V3 } from "libs/mjs";
import type { APIDataLayer } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import {
  getActiveCellId,
  getSegmentsForLayer,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  cutAgglomerateFromNeighborsAction,
  minCutAgglomerateWithPositionAction,
  proofreadMergeAction,
} from "viewer/model/actions/proofread_actions";
import { setActiveCellAction } from "viewer/model/actions/volumetracing_actions";
import Store, { type ContextMenuInfo, type VolumeTracing } from "viewer/store";
import { Actions } from "./context_menu_actions";
import { getMultiCutToolOptions } from "./min_cut_item";

export function getMeshItems(
  volumeTracing: VolumeTracing | null | undefined,
  contextInfo: ContextMenuInfo,
  visibleSegmentationLayer: APIDataLayer | null | undefined,
  voxelSizeFactor: Vector3,
  meshFileMappingName: string | null | undefined,
  isRotated: boolean,
): MenuItemType[] {
  const {
    meshId: clickedMeshId,
    meshIntersectionPosition,
    unmappedSegmentId: maybeUnmappedSegmentId,
  } = contextInfo;
  if (
    clickedMeshId == null ||
    meshIntersectionPosition == null ||
    visibleSegmentationLayer == null ||
    volumeTracing == null ||
    isRotated
  ) {
    return [];
  }
  const state = Store.getState();
  const isProofreadingActive = state.uiInformation.activeTool === AnnotationTool.PROOFREAD;
  const activeCellId = getActiveCellId(volumeTracing);
  const { activeUnmappedSegmentId } = volumeTracing;
  const segments = getSegmentsForLayer(state, volumeTracing.tracingId);
  const { isMultiSplitActive } = state.userConfiguration;
  const layerId = volumeTracing.tracingId;
  const minCutPartitions =
    layerId in state.localSegmentationData
      ? state.localSegmentationData[layerId].minCutPartitions
      : undefined;
  // The cut and merge operations depend on the active segment. The volume tracing *always* has an activeCellId.
  // However, the ID be 0 or it could be an unused ID (this is the default when creating a new
  // volume tracing). Therefore, merging/splitting with that ID won't work. We can avoid this
  // by looking the segment id up the segments list and checking against null.
  const activeSegmentMissing = segments.getNullable(activeCellId) == null;

  const getTooltip = (
    actionVerb: "add" | "remove" | "merge" | "split",
    actionNeedsActiveSegment: boolean,
  ) => {
    return !isProofreadingActive
      ? `Cannot ${actionVerb} because the proofreading tool is not active.`
      : maybeUnmappedSegmentId == null
        ? "The mesh wasn't loaded in proofreading mode. Please reload the mesh."
        : meshFileMappingName != null
          ? "This mesh was created for a mapping. Please use a meshfile that is based on unmapped oversegmentation data."
          : actionNeedsActiveSegment && activeSegmentMissing
            ? "Select a segment first."
            : null;
  };

  const shouldAgglomerateSkeletonActionsBeDisabled =
    !isProofreadingActive ||
    activeSegmentMissing ||
    maybeUnmappedSegmentId == null ||
    meshFileMappingName != null;
  const segmentIdLabel =
    isProofreadingActive && maybeUnmappedSegmentId != null
      ? `within Segment ${clickedMeshId}`
      : clickedMeshId;
  const segmentOrSuperVoxel =
    isProofreadingActive && maybeUnmappedSegmentId != null ? "Supervoxel" : "Segment";

  const proofreadingMultiSplitToolActions =
    isProofreadingActive && isMultiSplitActive && minCutPartitions && maybeUnmappedSegmentId != null
      ? getMultiCutToolOptions(
          maybeUnmappedSegmentId,
          clickedMeshId,
          minCutPartitions,
          segmentOrSuperVoxel,
          segmentIdLabel,
        )
      : [];
  const maybeProofreadingItems: MenuItemType[] = isProofreadingActive
    ? [
        ...proofreadingMultiSplitToolActions,
        {
          key: "merge-agglomerate-skeleton",
          disabled: shouldAgglomerateSkeletonActionsBeDisabled || clickedMeshId === activeCellId,
          onClick: () => {
            if (maybeUnmappedSegmentId == null) {
              // Should not happen due to the disabled property.
              return;
            }
            return Store.dispatch(
              proofreadMergeAction(null, maybeUnmappedSegmentId, clickedMeshId),
            );
          },
          label: (
            <FastTooltip title={getTooltip("merge", true)}>Merge with active segment</FastTooltip>
          ),
        },
        {
          key: "min-cut-agglomerate-at-position",
          disabled:
            shouldAgglomerateSkeletonActionsBeDisabled ||
            clickedMeshId !== activeCellId ||
            activeUnmappedSegmentId == null ||
            maybeUnmappedSegmentId === activeUnmappedSegmentId,
          onClick: () => {
            if (maybeUnmappedSegmentId == null) {
              // Should not happen due to the disabled property.
              return;
            }
            Store.dispatch(
              minCutAgglomerateWithPositionAction(null, maybeUnmappedSegmentId, clickedMeshId),
            );
          },
          label: (
            <FastTooltip title={getTooltip("split", true)}>Split from active segment</FastTooltip>
          ),
        },
        {
          key: "split-from-all-neighbors",
          disabled: maybeUnmappedSegmentId == null || meshFileMappingName != null,
          onClick: () => {
            if (maybeUnmappedSegmentId == null) {
              // Should not happen due to the disabled property.
              return;
            }
            Store.dispatch(
              cutAgglomerateFromNeighborsAction(null, null, maybeUnmappedSegmentId, clickedMeshId),
            );
          },
          label: (
            <FastTooltip title={getTooltip("split", false)}>
              Split from all neighboring segments
            </FastTooltip>
          ),
        },
      ]
    : [];

  const isAlreadySelected =
    activeUnmappedSegmentId === maybeUnmappedSegmentId && activeCellId === clickedMeshId;
  return [
    isProofreadingActive && activeUnmappedSegmentId != null && isAlreadySelected
      ? {
          // If a supervoxel is selected (and thus highlighted), allow to select it.
          key: "deactivate-segment",
          onClick: () =>
            Store.dispatch(setActiveCellAction(clickedMeshId, undefined, undefined, undefined)),
          label: `Deselect ${segmentOrSuperVoxel} (${segmentIdLabel})`,
        }
      : {
          key: "activate-segment",
          onClick: () =>
            Store.dispatch(
              setActiveCellAction(clickedMeshId, undefined, undefined, maybeUnmappedSegmentId),
            ),
          disabled: isAlreadySelected,
          label: `Select ${segmentOrSuperVoxel} (${segmentIdLabel})`,
        },
    {
      key: "hide-mesh",
      onClick: () => Actions.hideMesh(Store.dispatch, visibleSegmentationLayer.name, clickedMeshId),
      label: "Hide Mesh",
    },
    {
      key: "reload-mesh",
      onClick: () =>
        Actions.refreshMesh(Store.dispatch, visibleSegmentationLayer.name, clickedMeshId),
      label: "Reload Mesh",
    },
    {
      key: "jump-to-mesh",
      onClick: () => {
        const unscaledPosition = V3.divide3(meshIntersectionPosition, voxelSizeFactor);
        Actions.setPosition(Store.dispatch, unscaledPosition);
      },
      label: "Jump to Position",
    },
    {
      key: "remove-mesh",
      onClick: () =>
        Actions.removeMesh(Store.dispatch, visibleSegmentationLayer.name, clickedMeshId),
      label: "Remove Mesh",
    },
    ...maybeProofreadingItems,
  ];
}
