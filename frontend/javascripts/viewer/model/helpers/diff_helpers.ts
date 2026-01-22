import { diffArrays, diffMaps, diffObjects } from "libs/utils";
import isEmpty from "lodash/isEmpty";
import isEqual from "lodash/isEqual";
import keyBy from "lodash/keyBy";
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
} from "viewer/model/sagas/volume/update_actions";
import type { UserBoundingBox } from "viewer/store";
import { callDeepWithChildren } from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
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
  outputSets: { expanded: Set<number>; notExpanded: Set<number> } = {
    expanded: new Set(),
    notExpanded: new Set(),
  },
) {
  for (const group of groups) {
    if (group.isExpanded) {
      outputSets.expanded.add(group.groupId);
    } else {
      outputSets.notExpanded.add(group.groupId);
    }
    gatherIdToExpandedState(group.children, outputSets);
  }
  return outputSets;
}

export function diffGroups(prevGroups: TreeGroup[], groups: TreeGroup[]) {
  if (prevGroups === groups) {
    return {
      didContentChange: false,
      newlyExpandedIds: [],
      newlyNotExpandedIds: [],
    };
  }
  const didContentChange = !isEqual(stripIsExpanded(prevGroups), stripIsExpanded(groups));

  const prevExpandedState = gatherIdToExpandedState(prevGroups);
  const expandedState = gatherIdToExpandedState(groups);

  const newlyExpandedIds = Array.from(
    expandedState.expanded.difference(prevExpandedState.expanded),
  );
  const newlyNotExpandedIds = Array.from(
    expandedState.notExpanded.difference(prevExpandedState.notExpanded),
  );

  return { didContentChange, newlyExpandedIds, newlyNotExpandedIds };
}

type FlatGroup = {
  id: number;
  name: string;
  parentGroupId: number | null | undefined;
};

function getGroupByIdDictionary(groups: TreeGroup[]) {
  const flatGroupById = new Map<number, FlatGroup>();
  callDeepWithChildren(
    groups,
    undefined,
    (
      group: TreeGroup,
      _index: number,
      _treeGroups: TreeGroup[],
      parentGroupId: number | null | undefined,
    ) => {
      const flatGroup = {
        id: group.groupId,
        name: group.name,
        parentGroupId,
      };
      flatGroupById.set(group.groupId, flatGroup);
    },
    undefined,
    true,
  );
  return flatGroupById;
}

export type ParentUpdate = {
  groupId: number;
  from: number | null | undefined;
  to: number | null | undefined;
  nameChanged: boolean;
  newName?: string;
};

function buildChildrenMap(groupsById: Map<number, FlatGroup>) {
  /* The returned map maps from group id to a list of its direct children */
  const children = new Map<number, number[]>();

  for (const group of groupsById.values()) {
    if (group.parentGroupId != null) {
      const arr = children.get(group.parentGroupId) ?? [];
      arr.push(group.id);
      children.set(group.parentGroupId, arr);
    }
  }
  return children;
}

function isDescendant(
  ancestorId: number,
  possibleDescendantId: number,
  childrenMap: Map<number, number[]>,
): boolean {
  const stack = childrenMap.get(ancestorId) ?? [];
  const visited = new Set<number>();

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === possibleDescendantId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(childrenMap.get(current) ?? []));
  }

  return false;
}

export function buildOrderDependencies(
  updates: ParentUpdate[],
  prevGroupsById: Map<number, FlatGroup>,
) {
  const prevChildrenMap = buildChildrenMap(prevGroupsById);

  const deps = new Map<number, Set<number>>(); // A -> Set of B (A depends on B)

  for (const u of updates) {
    deps.set(u.groupId, new Set());
  }

  for (const u of updates) {
    if (u.to == null) continue;

    if (isDescendant(u.groupId, u.to, prevChildrenMap)) {
      // The group is moved into one of its descendents.
      // Therefore, that descendant must be updated first.
      deps.get(u.groupId)!.add(u.to);
    }
  }

  return deps;
}

export function topologicallySortUpdates(
  updates: ParentUpdate[],
  deps: Map<number, Set<number>>,
): ParentUpdate[] {
  // Uses Kahns algorithm to build a topological order.
  const inDegree = new Map<number, number>();

  for (const u of updates) {
    inDegree.set(u.groupId, 0);
  }

  for (const [, set] of deps) {
    for (const dep of set) {
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
    }
  }

  const queue: number[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const ordered: ParentUpdate[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const update = updates.find((u) => u.groupId === id)!;
    ordered.unshift(update);

    for (const dep of deps.get(id) ?? []) {
      inDegree.set(dep, inDegree.get(dep)! - 1);
      if (inDegree.get(dep) === 0) queue.push(dep);
    }
  }

  if (ordered.length !== updates.length) {
    throw new Error("Cycle detected in group parent updates");
  }

  return ordered;
}

export type GranularGroupDiff = ReturnType<typeof diffGroupsGranular>;

export function diffGroupsGranular(prevGroups: TreeGroup[], groups: TreeGroup[]) {
  const prevGroupsById = getGroupByIdDictionary(prevGroups);
  const groupsById = getGroupByIdDictionary(groups);

  const { newlyExpandedIds, newlyNotExpandedIds } = diffGroups(prevGroups, groups);

  const { onlyA, onlyB, changed } = diffMaps(prevGroupsById, groupsById, _.isEqual);

  return {
    prevGroupsById,
    groupsById,
    onlyA,
    onlyB,
    changed,
    newlyExpandedIds,
    newlyNotExpandedIds,
  };
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

function* diffBoundingBoxContents(
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
  const didContentChange = !isEqual(
    prevBoundingBoxesWithoutIsVisible,
    currentBoundingBoxesWithoutIsVisible,
  );

  if (!didContentChange) {
    return;
  }
  const prevBBoxById = keyBy(prevBoundingBoxesWithoutIsVisible, (bbox) => bbox.id);
  const currentBBoxById = keyBy(currentBoundingBoxesWithoutIsVisible, (bbox) => bbox.id);

  const {
    onlyA: deletedBBoxIds,
    onlyB: addedBBoxIds,
    both: maybeChangedBBoxIds,
  } = diffArrays(
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

    const changedProps = diffObjects(prevBbox, currentBbox);

    if (!isEmpty(changedProps)) {
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

  const newlyVisibleIds = Array.from(visibleState.visible.difference(prevVisibleState.visible));
  const newlyInvisibleIds = Array.from(
    visibleState.invisible.difference(prevVisibleState.invisible),
  );

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

  yield* diffBoundingBoxContents(prevBoundingBoxes, currentBoundingBoxes, tracingId, tracingType);
  yield* diffBoundingBoxVisibilities(
    prevBoundingBoxes,
    currentBoundingBoxes,
    tracingId,
    tracingType,
  );
}
