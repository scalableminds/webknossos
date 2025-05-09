// This module is used to compact the updateTreeVisibility updateActions
// in a way which reduces the amount of such actions. This is done by
// replacing the actions with updateTree*Group*Visibility actions where
// appropriate.
// See compactToggleActions for the high-level logic of the compaction.
import _ from "lodash";
import type {
  UpdateActionWithoutIsolationRequirement,
  UpdateSegmentVisibilityVolumeAction,
  UpdateTreeVisibilityUpdateAction,
} from "viewer/model/sagas/update_actions";
import {
  updateSegmentGroupVisibilityVolumeAction,
  updateSegmentVisibilityVolumeAction,
  updateTreeGroupVisibility,
  updateTreeVisibility,
} from "viewer/model/sagas/update_actions";
import type {
  Segment,
  SegmentMap,
  SkeletonTracing,
  Tree,
  TreeGroup,
  TreeMap,
  VolumeTracing,
} from "viewer/store";
import {
  MISSING_GROUP_ID,
  createGroupToSegmentsMap,
  createGroupToTreesMap,
  getGroupByIdWithSubgroups,
} from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
type GroupNode = {
  children: GroupNode[];
  groupId: number | null | undefined;
  parent: GroupNode | null | undefined;
};

// Returns an object which maps from group id to group node
function buildTreeGroupHashMap(
  tracing: SkeletonTracing | VolumeTracing,
): Record<number, GroupNode> {
  const root: GroupNode = {
    children: [],
    groupId: null,
    parent: null,
  };

  function createSubTree(subTreeRoot: GroupNode, children: TreeGroup[]) {
    for (const child of children) {
      const childNode = {
        children: [],
        groupId: child.groupId,
        parent: subTreeRoot,
      };
      createSubTree(childNode, child.children);
      subTreeRoot.children.push(childNode);
    }
  }

  createSubTree(root, "treeGroups" in tracing ? tracing.treeGroups : tracing.segmentGroups);

  function buildHashMap(subTreeRoot: GroupNode, hashMap: Record<number, GroupNode>) {
    const groupId = subTreeRoot.groupId != null ? subTreeRoot.groupId : MISSING_GROUP_ID;
    hashMap[groupId] = subTreeRoot;

    for (const child of subTreeRoot.children) {
      buildHashMap(child, hashMap);
    }

    return hashMap;
  }

  const hashMap = buildHashMap(root, {});
  return hashMap;
}

// Finds the id of the common group for the used trees in the toggleActions
function findCommonAncestor(
  treeIdMap: TreeMap | SegmentMap,
  groupIdMap: Record<number, GroupNode>,
  toggleActions: Array<UpdateTreeVisibilityUpdateAction | UpdateSegmentVisibilityVolumeAction>,
): number | undefined {
  function getAncestorPath(groupId: number | null | undefined): number[] {
    const path = [];
    let currentGroupNode: GroupNode | null | undefined =
      groupIdMap[groupId == null ? MISSING_GROUP_ID : groupId];

    while (currentGroupNode != null) {
      if (currentGroupNode.parent == null && currentGroupNode.groupId == null) {
        break;
      }

      path.unshift(currentGroupNode.groupId != null ? currentGroupNode.groupId : MISSING_GROUP_ID);
      currentGroupNode = currentGroupNode.parent;
    }

    return path;
  }

  let commonPath: number[] | null = null;

  const getAncestor =
    "getNullable" in treeIdMap
      ? (value: UpdateSegmentVisibilityVolumeAction["value"]) => treeIdMap.getNullable(value.id)
      : (value: UpdateTreeVisibilityUpdateAction["value"]) => treeIdMap[value.treeId];
  for (const toggleAction of toggleActions) {
    const ancestorPath = getAncestorPath(getAncestor(toggleAction.value as any)?.groupId);

    if (commonPath == null) {
      commonPath = ancestorPath;
    } else {
      const newPath = [];

      for (let i = 0; i < commonPath.length; i++) {
        const groupId: number = commonPath[i];

        if (i < ancestorPath.length && ancestorPath[i] === groupId) {
          newPath.push(groupId);
        } else {
          break;
        }
      }

      commonPath = newPath;
    }
  }

  return _.last(commonPath);
}

function isCommonAncestorToggler<T extends SkeletonTracing | VolumeTracing>(
  tracing: T,
  commonAncestor: number | undefined,
): [boolean, Array<T extends SkeletonTracing ? Tree : Segment>, number] {
  let allItemsOfAncestor: Array<Tree | Segment> = [];
  if (tracing.type === "skeleton") {
    const items = tracing.trees;
    const groups = tracing.treeGroups;
    const groupToTreesMap = createGroupToTreesMap(items);
    const groupWithSubgroups = getGroupByIdWithSubgroups(groups, commonAncestor);
    allItemsOfAncestor =
      groupWithSubgroups.length === 0
        ? _.values(items)
        : _.flatMap(
            groupWithSubgroups,
            (groupId: number): Tree[] => groupToTreesMap[groupId] || [],
          );
  } else {
    const items = tracing.segments;
    const groups = tracing.segmentGroups;
    const groupToTreesMap = createGroupToSegmentsMap(items);
    const groupWithSubgroups = getGroupByIdWithSubgroups(groups, commonAncestor);
    allItemsOfAncestor =
      groupWithSubgroups.length === 0
        ? Array.from(items.values())
        : _.flatMap(
            groupWithSubgroups,
            (groupId: number): Segment[] => groupToTreesMap[groupId] || [],
          );
  }

  const [visibleItems, invisibleItems] = _.partition(allItemsOfAncestor, (tree) => tree.isVisible);

  const affectedItemCount = allItemsOfAncestor.length;
  let commonVisibility;
  let exceptions;

  if (visibleItems.length > invisibleItems.length) {
    commonVisibility = true;
    exceptions = invisibleItems;
  } else {
    commonVisibility = false;
    exceptions = visibleItems;
  }

  return [
    commonVisibility,
    exceptions as Array<T extends SkeletonTracing ? Tree : Segment>,
    affectedItemCount,
  ];
}

export default function compactToggleActions(
  updateActions: UpdateActionWithoutIsolationRequirement[],
  tracing: SkeletonTracing | VolumeTracing,
): UpdateActionWithoutIsolationRequirement[] {
  // Extract the toggleActions which we are interested in
  const [toggleActions, remainingActions] = _.partition<UpdateActionWithoutIsolationRequirement>(
    updateActions,
    (ua) => ua.name === "updateTreeVisibility" || ua.name === "updateSegmentVisibility",
  );

  if (toggleActions.length <= 1) {
    // Don't try to compact actons if there are no or only one toggleAction(s)
    return updateActions;
  }

  const items = tracing.type === "skeleton" ? tracing.trees : tracing.segments;

  // Build up some helper data structures
  const hashMap = buildTreeGroupHashMap(tracing);
  // Find the group id of the common ancestor of all toggled trees
  const commonAncestor = findCommonAncestor(
    items,
    hashMap,
    toggleActions as Array<UpdateTreeVisibilityUpdateAction | UpdateSegmentVisibilityVolumeAction>,
  );
  // commonVisibility is the new visibility which should be applied to all ascendants
  // of the common ancestor. The exceptions array lists all trees which differ from
  // that common visibility. These will receive separate updateActions.
  const [commonVisibility, exceptions, affectedItemCount] = isCommonAncestorToggler(
    tracing,
    commonAncestor,
  );
  // If less than 50% of the toggled trees are exceptions, we should use the compaction
  const shouldUseToggleGroup = exceptions.length < 0.5 * affectedItemCount;
  const compactedToggleActions =
    tracing.type === "skeleton"
      ? [
          updateTreeGroupVisibility(commonAncestor, commonVisibility, tracing.tracingId),
          ...exceptions.map((tree) => updateTreeVisibility(tree as Tree, tracing.tracingId)),
        ]
      : [
          updateSegmentGroupVisibilityVolumeAction(
            commonAncestor ?? null,
            commonVisibility,
            tracing.tracingId,
          ),
          ...exceptions.map((_segment) => {
            const segment = _segment as Segment;
            return updateSegmentVisibilityVolumeAction(
              segment.id,
              segment.isVisible,
              tracing.tracingId,
            );
          }),
        ];
  const finalToggleActions = shouldUseToggleGroup ? compactedToggleActions : toggleActions;
  return remainingActions.concat(finalToggleActions);
}
