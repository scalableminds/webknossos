import type { MenuItemType } from "antd/es/menu/interface";
import FastTooltip from "components/fast_tooltip";
import { V3 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import { useDispatch } from "react-redux";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { isRotated } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import {
  getActiveCellId,
  getActiveSegmentationTracing,
  getSegmentsForLayer,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  cutAgglomerateFromNeighborsAction,
  minCutAgglomerateWithPositionAction,
  proofreadMergeAction,
} from "viewer/model/actions/proofread_actions";
import type { ContextMenuInfo } from "viewer/store";
import { useMultiCutToolOptions } from "./min_cut_item";
import { useContextMenuActions } from "./use_context_menu_actions";

export function useMeshItems(contextInfo: ContextMenuInfo): MenuItemType[] {
  const {
    meshId: clickedMeshId,
    meshIntersectionPosition,
    unmappedSegmentId: maybeUnmappedSegmentId,
  } = contextInfo;

  const volumeTracing = useWkSelector(getActiveSegmentationTracing);
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const voxelSizeFactor = useWkSelector((state) => state.dataset.dataSource.scale.factor);
  const isFlycamRotated = useWkSelector((state) => isRotated(state.flycam));

  const currentMeshFile = useWkSelector((state) =>
    visibleSegmentationLayer != null
      ? state.localSegmentationData[visibleSegmentationLayer.name].currentMeshFile
      : null,
  );
  const meshFileMappingName = currentMeshFile?.mappingName;

  const actions = useContextMenuActions();
  const dispatch = useDispatch();

  const isProofreadingActive = useWkSelector(
    (state) => state.uiInformation.activeTool === AnnotationTool.PROOFREAD,
  );
  const isMultiSplitActive = useWkSelector((state) => state.userConfiguration.isMultiSplitActive);

  const activeUnmappedSegmentId = volumeTracing?.activeUnmappedSegmentId;
  const activeCellId = volumeTracing ? getActiveCellId(volumeTracing) : 0;

  const segments = useWkSelector((state) =>
    volumeTracing != null ? getSegmentsForLayer(state, volumeTracing.tracingId) : null,
  );
  const minCutPartitions = useWkSelector((state) => {
    if (volumeTracing == null) return undefined;
    const layerId = volumeTracing.tracingId;
    return layerId in state.localSegmentationData
      ? state.localSegmentationData[layerId].minCutPartitions
      : undefined;
  });

  const segmentIdLabel =
    isProofreadingActive && maybeUnmappedSegmentId != null
      ? `within Segment ${clickedMeshId ?? 0}`
      : (clickedMeshId ?? 0);
  const segmentOrSuperVoxel =
    isProofreadingActive && maybeUnmappedSegmentId != null ? "Supervoxel" : "Segment";

  const proofreadingMultiSplitToolActions = useMultiCutToolOptions(
    maybeUnmappedSegmentId ?? 0,
    clickedMeshId ?? 0,
    segmentOrSuperVoxel,
    segmentIdLabel,
  );

  if (
    clickedMeshId == null ||
    meshIntersectionPosition == null ||
    visibleSegmentationLayer == null ||
    volumeTracing == null ||
    isFlycamRotated
  ) {
    return [];
  }

  const activeSegmentMissing = segments && segments.getNullable(activeCellId) == null;

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

  const maybeProofreadingItems: MenuItemType[] = isProofreadingActive
    ? [
        ...(isMultiSplitActive && minCutPartitions && maybeUnmappedSegmentId != null
          ? proofreadingMultiSplitToolActions
          : []),
        {
          key: "merge-agglomerate-skeleton",
          disabled: shouldAgglomerateSkeletonActionsBeDisabled || clickedMeshId === activeCellId,
          onClick: () => {
            if (maybeUnmappedSegmentId == null) {
              return;
            }
            return dispatch(proofreadMergeAction(null, maybeUnmappedSegmentId, clickedMeshId));
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
              return;
            }
            dispatch(
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
              return;
            }
            dispatch(
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
          key: "deactivate-segment",
          onClick: () => actions.setActiveCell(clickedMeshId, undefined, undefined, undefined),
          label: `Deselect ${segmentOrSuperVoxel} (${segmentIdLabel})`,
        }
      : {
          key: "activate-segment",
          onClick: () =>
            actions.setActiveCell(
              clickedMeshId,
              undefined,
              undefined,
              maybeUnmappedSegmentId ?? undefined,
            ),
          disabled: isAlreadySelected,
          label: `Select ${segmentOrSuperVoxel} (${segmentIdLabel})`,
        },
    {
      key: "hide-mesh",
      onClick: () => actions.hideMesh(visibleSegmentationLayer.name, clickedMeshId),
      label: "Hide Mesh",
    },
    {
      key: "reload-mesh",
      onClick: () => actions.refreshMesh(visibleSegmentationLayer.name, clickedMeshId),
      label: "Reload Mesh",
    },
    {
      key: "jump-to-mesh",
      onClick: () => {
        const unscaledPosition = V3.divide3(meshIntersectionPosition, voxelSizeFactor);
        actions.setPosition(unscaledPosition);
      },
      label: "Jump to Position",
    },
    {
      key: "remove-mesh",
      onClick: () => actions.removeMesh(visibleSegmentationLayer.name, clickedMeshId),
      label: "Remove Mesh",
    },
    ...maybeProofreadingItems,
  ];
}
