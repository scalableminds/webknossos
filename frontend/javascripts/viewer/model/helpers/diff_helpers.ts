import * as Utils from "libs/utils";
import { diffSets } from "libs/utils";
import _ from "lodash";
import { AnnotationLayerEnum } from "types/api_types";
import {
  addUserBoundingBoxInSkeletonTracing,
  addUserBoundingBoxInVolumeTracing,
  deleteUserBoundingBoxInSkeletonTracing,
  deleteUserBoundingBoxInVolumeTracing,
  updateUserBoundingBoxInSkeletonTracing,
  updateUserBoundingBoxInVolumeTracing,
  updateUserBoundingBoxVisibilityInSkeletonTracing,
  updateUserBoundingBoxVisibilityInVolumeTracing,
} from "viewer/model/sagas/update_actions";
import type { UserBoundingBox } from "viewer/store";
import type { TreeGroup } from "../types/tree_types";

function stripIsExpanded(groups: TreeGroup[]): TreeGroup[] {
  return groups.map((group) => ({
    name: group.name,
    groupId: group.groupId,
    children: stripIsExpanded(group.children),
  }));
}

function gatherIdToExpandedState(
  groups: TreeGroup[],
  outputMap: { expanded: Set<number>; notExpanded: Set<number> } = {
    expanded: new Set(),
    notExpanded: new Set(),
  },
) {
  for (const group of groups) {
    if (group.isExpanded) {
      outputMap.expanded.add(group.groupId);
    } else {
      outputMap.notExpanded.add(group.groupId);
    }
    gatherIdToExpandedState(group.children, outputMap);
  }
  return outputMap;
}

export function diffGroups(prevGroups: TreeGroup[], groups: TreeGroup[]) {
  if (prevGroups === groups) {
    return {
      didContentChange: false,
      newlyExpandedIds: [],
      newlyNotExpandedIds: [],
    };
  }
  const didContentChange = !_.isEqual(stripIsExpanded(prevGroups), stripIsExpanded(groups));

  const prevExpandedState = gatherIdToExpandedState(prevGroups);
  const expandedState = gatherIdToExpandedState(groups);

  const expandedDiff = diffSets(prevExpandedState.expanded, expandedState.expanded);
  const notExpandedDiff = diffSets(prevExpandedState.notExpanded, expandedState.notExpanded);

  const newlyExpandedIds = Array.from(expandedDiff.bWithoutA);
  const newlyNotExpandedIds = Array.from(notExpandedDiff.bWithoutA);

  return { didContentChange, newlyExpandedIds, newlyNotExpandedIds };
}

function stripIsVisible(boxes: UserBoundingBox[]): Omit<UserBoundingBox, "isVisible">[] {
  return boxes.map((box) => {
    const { isVisible: _isVisible, ...rest } = box;
    return rest;
  });
}

function gatherSetsForVisibility(boxes: UserBoundingBox[]) {
  const visible = new Set<number>();
  const invisible = new Set<number>();
  for (const box of boxes) {
    if (box.isVisible) {
      visible.add(box.id);
    } else {
      invisible.add(box.id);
    }
  }
  return { visible, invisible };
}

function* diffBoundingBoxesContents(
  prevBoundingBoxes: UserBoundingBox[],
  currentBoundingBoxes: UserBoundingBox[],
  tracingId: string,
  tracingType: AnnotationLayerEnum,
) {
  const [addBBoxAction, deleteBBoxAction, updateBBoxAction] =
    tracingType === AnnotationLayerEnum.Skeleton
      ? [
          addUserBoundingBoxInSkeletonTracing,
          deleteUserBoundingBoxInSkeletonTracing,
          updateUserBoundingBoxInSkeletonTracing,
        ]
      : [
          addUserBoundingBoxInVolumeTracing,
          deleteUserBoundingBoxInVolumeTracing,
          updateUserBoundingBoxInVolumeTracing,
        ];

  const prevBoundingBoxesWithoutIsVisible = stripIsVisible(prevBoundingBoxes);
  const currentBoundingBoxesWithoutIsVisible = stripIsVisible(currentBoundingBoxes);
  const didContentChange = !_.isEqual(
    prevBoundingBoxesWithoutIsVisible,
    currentBoundingBoxesWithoutIsVisible,
  );

  if (!didContentChange) {
    return;
  }
  const prevBBoxById = _.keyBy(prevBoundingBoxesWithoutIsVisible, (bbox) => bbox.id);
  const currentBBoxById = _.keyBy(currentBoundingBoxesWithoutIsVisible, (bbox) => bbox.id);

  const {
    onlyA: deletedBBoxIds,
    onlyB: addedBBoxIds,
    both: maybeChangedBBoxIds,
  } = Utils.diffArrays(
    prevBoundingBoxesWithoutIsVisible.map((bbox) => bbox.id),
    currentBoundingBoxesWithoutIsVisible.map((bbox) => bbox.id),
  );

  const getErrorMessage = (id: number) =>
    `User bounding box with id ${id} not found in ${tracingType} tracing.`;
  for (const id of deletedBBoxIds) {
    yield deleteBBoxAction(id, tracingId);
  }

  for (const id of addedBBoxIds) {
    const bbox = currentBBoxById[id];
    if (bbox) {
      yield addBBoxAction(bbox, tracingId);
    } else {
      throw new Error(getErrorMessage(id));
    }
  }
  for (const id of maybeChangedBBoxIds) {
    const currentBbox = currentBBoxById[id];
    const prevBbox = prevBBoxById[id];
    if (currentBbox == null || prevBbox == null) {
      throw new Error(getErrorMessage(id));
    }
    if (currentBbox === prevBbox) continue;

    const changedProps = Utils.diffObjects(prevBbox, currentBbox);

    if (!_.isEmpty(changedProps)) {
      yield updateBBoxAction(currentBbox.id, changedProps, tracingId);
    }
  }
}

function* diffBoundingBoxVisibilities(
  prevBoundingBoxes: UserBoundingBox[],
  currentBoundingBoxes: UserBoundingBox[],
  tracingId: string,
  tracingType: AnnotationLayerEnum,
) {
  const updateBBoxVisibility =
    tracingType === AnnotationLayerEnum.Skeleton
      ? updateUserBoundingBoxVisibilityInSkeletonTracing
      : updateUserBoundingBoxVisibilityInVolumeTracing;

  const prevVisibleState = gatherSetsForVisibility(prevBoundingBoxes);
  const visibleState = gatherSetsForVisibility(currentBoundingBoxes);

  const visibleDiff = diffSets(prevVisibleState.visible, visibleState.visible);
  const invisibleDiff = diffSets(prevVisibleState.invisible, visibleState.invisible);

  const newlyVisibleIds = Array.from(visibleDiff.bWithoutA);
  const newlyInvisibleIds = Array.from(invisibleDiff.bWithoutA);

  for (const id of newlyVisibleIds) {
    yield updateBBoxVisibility(id, true, tracingId);
  }

  for (const id of newlyInvisibleIds) {
    yield updateBBoxVisibility(id, false, tracingId);
  }
}

export function* diffBoundingBoxes(
  prevBoundingBoxes: UserBoundingBox[],
  currentBoundingBoxes: UserBoundingBox[],
  tracingId: string,
  tracingType: AnnotationLayerEnum,
) {
  if (prevBoundingBoxes === currentBoundingBoxes) return;

  yield* diffBoundingBoxesContents(prevBoundingBoxes, currentBoundingBoxes, tracingId, tracingType);
  yield* diffBoundingBoxVisibilities(
    prevBoundingBoxes,
    currentBoundingBoxes,
    tracingId,
    tracingType,
  );
}
