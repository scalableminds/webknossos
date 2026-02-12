import { diffMaps } from "libs/utils";
import isEqual from "lodash-es/isEqual";
import type { TreeGroup } from "viewer/model/types/tree_types";
import { callDeepWithChildren } from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";

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
  /*
   * Checks whether ancestorId is an ancestor
   * of possibleDescendantId.
   */
  const stack = [...(childrenMap.get(ancestorId) ?? [])];
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
): Map<number, Set<number>> {
  /*
   * Returns a map that contains "problematic" groups that are about
   * to be moved into one of its descendant groups.
   * The map maps from each key of a problematic group to its
   * target group.
   */
  const prevChildrenMap = buildChildrenMap(prevGroupsById);

  const deps = new Map<number, Set<number>>(); // A -> Set of B (A depends on B)

  for (const u of updates) {
    deps.set(u.groupId, new Set());
  }

  for (const u of updates) {
    if (u.to == null) continue;

    if (isDescendant(u.groupId, u.to, prevChildrenMap)) {
      // The group is moved into one of its descendants.
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

  const { onlyA, onlyB, changed } = diffMaps(prevGroupsById, groupsById, isEqual);

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
