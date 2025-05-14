import { diffSets } from "libs/utils";
import _ from "lodash";
import type { TreeGroup, UserBoundingBox } from "viewer/store";

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

export function diffUserBoundingBoxes(prevBoxes: UserBoundingBox[], boxes: UserBoundingBox[]) {
  if (prevBoxes === boxes) {
    return {
      didContentChange: false,
      newlyVisibleIds: [],
      newlyInvisibleIds: [],
    };
  }
  const didContentChange = !_.isEqual(stripIsVisible(prevBoxes), stripIsVisible(boxes));

  const prevVisibleState = gatherSetsForVisibility(prevBoxes);
  const visibleState = gatherSetsForVisibility(boxes);

  const visibleDiff = diffSets(prevVisibleState.visible, visibleState.visible);
  const invisibleDiff = diffSets(prevVisibleState.invisible, visibleState.invisible);

  const newlyVisibleIds = Array.from(visibleDiff.bWithoutA);
  const newlyInvisibleIds = Array.from(invisibleDiff.bWithoutA);

  return { didContentChange, newlyVisibleIds, newlyInvisibleIds };
}
