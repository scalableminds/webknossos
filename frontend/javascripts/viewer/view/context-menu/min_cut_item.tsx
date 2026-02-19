import type { MenuItemType, SubMenuType } from "antd/es/menu/interface";
import { CtrlOrCmdKey } from "viewer/constants";
import {
  minCutPartitionsAction,
  toggleSegmentInPartitionAction,
} from "viewer/model/actions/proofread_actions";
import { performMinCutAction } from "viewer/model/actions/volumetracing_actions";
import { isBoundingBoxUsableForMinCut } from "viewer/model/sagas/volume/min_cut_saga";
import type { Tree } from "viewer/model/types/tree_types";
import Store, {
  type MinCutPartitions,
  type UserBoundingBox,
  type VolumeTracing,
} from "viewer/store";
import { shortcutBuilder } from "./helpers";

export function getMaybeMinCutItem(
  clickedTree: Tree,
  volumeTracing: VolumeTracing | null | undefined,
  userBoundingBoxes: Array<UserBoundingBox>,
  isVolumeModificationAllowed: boolean,
): SubMenuType | null {
  const seeds = Array.from(clickedTree.nodes.values());

  if (volumeTracing == null || !isVolumeModificationAllowed || seeds.length !== 2) {
    return null;
  }

  return {
    key: "min-cut",
    label: "Perform Min-Cut (Experimental)",
    // For some reason, antd doesn't pass the ant-dropdown class to the
    // sub menu itself which makes the label of the item group too big.
    // Passing the CSS class here fixes it (font-size is 14px instead of
    // 16px then).
    popupClassName: "ant-dropdown",
    children: [
      {
        key: "choose-bbox-group",
        label: "Choose a bounding box for the min-cut operation:",
        type: "group", // double check if the group is assigned to right item
        children: [
          {
            key: "create-new",
            onClick: () => Store.dispatch(performMinCutAction(clickedTree.treeId)),
            label: "Use default bounding box",
          },
          ...userBoundingBoxes
            .filter((bbox) => isBoundingBoxUsableForMinCut(bbox.boundingBox, seeds))
            .map((bbox) => {
              return {
                key: bbox.id.toString(),
                onClick: () => Store.dispatch(performMinCutAction(clickedTree.treeId, bbox.id)),
                label: bbox.name || "Unnamed bounding box",
              };
            }),
        ],
      },
    ],
  };
}

export function getMultiCutToolOptions(
  unmappedSegmentId: number,
  mappedSegmentId: number,
  minCutPartitions: MinCutPartitions,
  segmentOrSuperVoxel: string,
  segmentIdLabel: string | number,
): MenuItemType[] {
  // Multi split min cut tool options
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
        Store.dispatch(toggleSegmentInPartitionAction(unmappedSegmentId, 1, mappedSegmentId)),
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
        Store.dispatch(toggleSegmentInPartitionAction(unmappedSegmentId, 2, mappedSegmentId)),
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
            onClick: () => Store.dispatch(minCutPartitionsAction()),
            label: "Split partitions",
          },
        ]
      : []),
  ];
}
