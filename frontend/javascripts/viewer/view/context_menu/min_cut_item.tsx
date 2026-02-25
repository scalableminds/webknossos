import type { MenuItemType, SubMenuType } from "antd/es/menu/interface";
import { useWkSelector } from "libs/react_hooks";
import { useDispatch } from "react-redux";
import { CtrlOrCmdKey } from "viewer/constants";
import { isRotated } from "viewer/model/accessors/flycam_accessor";
import { maybeGetSomeTracing } from "viewer/model/accessors/tracing_accessor";
import {
  getActiveSegmentationTracing,
  hasEditableMapping,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  minCutPartitionsAction,
  toggleSegmentInPartitionAction,
} from "viewer/model/actions/proofread_actions";
import { performMinCutAction } from "viewer/model/actions/volumetracing_actions";
import { isBoundingBoxUsableForMinCut } from "viewer/model/sagas/volume/min_cut_saga";
import type { Tree } from "viewer/model/types/tree_types";
import { shortcutBuilder } from "./helpers";

export function useMaybeMinCutItem(clickedTree: Tree | null): SubMenuType | null {
  const isFlycamRotated = useWkSelector((state) => isRotated(state.flycam));
  const hasEditableMap = useWkSelector(hasEditableMapping);
  const isVolumeModificationAllowed = !hasEditableMap && !isFlycamRotated;
  const volumeTracing = useWkSelector(getActiveSegmentationTracing);
  const userBoundingBoxes = useWkSelector((state) => {
    const someTracing = maybeGetSomeTracing(state.annotation);
    return someTracing != null ? someTracing.userBoundingBoxes : [];
  });
  const dispatch = useDispatch();

  if (clickedTree == null) return null;

  const seeds = Array.from(clickedTree.nodes.values());

  if (volumeTracing == null || !isVolumeModificationAllowed || seeds.length !== 2) {
    return null;
  }

  return {
    key: "min-cut",
    label: "Perform Min-Cut (Experimental)",
    children: [
      {
        key: "choose-bbox-group",
        label: "Choose a bounding box for the min-cut operation:",
        type: "group",
        children: [
          {
            key: "create-new",
            onClick: () => dispatch(performMinCutAction(clickedTree.treeId)),
            label: "Use default bounding box",
          },
          ...userBoundingBoxes
            .filter((bbox) => isBoundingBoxUsableForMinCut(bbox.boundingBox, seeds))
            .map((bbox) => {
              return {
                key: bbox.id.toString(),
                onClick: () => dispatch(performMinCutAction(clickedTree.treeId, bbox.id)),
                label: bbox.name || "Unnamed bounding box",
              };
            }),
        ],
      },
    ],
  };
}

export function useMultiCutToolOptions(
  unmappedSegmentId: number,
  mappedSegmentId: number,
  segmentOrSuperVoxel: string,
  segmentIdLabel: string | number,
): MenuItemType[] {
  const volumeTracing = useWkSelector(getActiveSegmentationTracing);
  const minCutPartitions = useWkSelector((state) => {
    if (volumeTracing == null) return undefined;
    const layerId = volumeTracing.tracingId;
    return layerId in state.localSegmentationData
      ? state.localSegmentationData[layerId].minCutPartitions
      : undefined;
  });
  const dispatch = useDispatch();

  if (!minCutPartitions) return [];

  const isSegmentInPartition1 = minCutPartitions[1].includes(unmappedSegmentId);
  const isSegmentInPartition2 = minCutPartitions[2].includes(unmappedSegmentId);
  const togglePartition1Verb = isSegmentInPartition1 ? "Remove" : "Add";
  const togglePartition2Verb = isSegmentInPartition2 ? "Remove" : "Add";
  const doBothPartitionsHaveEntries =
    minCutPartitions[1].length > 0 && minCutPartitions[2].length > 0;

  return [
    {
      key: "mark-as-partition-1",
      onClick: () =>
        dispatch(toggleSegmentInPartitionAction(unmappedSegmentId, 1, mappedSegmentId)),
      label: (
        <>
          {togglePartition1Verb} {segmentOrSuperVoxel} ({segmentIdLabel}) to Partition 1{" "}
          {shortcutBuilder([CtrlOrCmdKey, "leftMouse"])}
        </>
      ),
    },
    {
      key: "mark-as-partition-2",
      onClick: () =>
        dispatch(toggleSegmentInPartitionAction(unmappedSegmentId, 2, mappedSegmentId)),
      label: (
        <>
          {togglePartition2Verb} {segmentOrSuperVoxel} ({segmentIdLabel}) to Partition 2{" "}
          {shortcutBuilder([CtrlOrCmdKey, "Shift", "leftMouse"])}
        </>
      ),
    },
    ...(doBothPartitionsHaveEntries
      ? [
          {
            key: "min-cut-agglomerate-with-partitions",
            onClick: () => dispatch(minCutPartitionsAction()),
            label: "Split partitions",
          },
        ]
      : []),
  ];
}
