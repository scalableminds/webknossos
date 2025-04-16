// This module is used to compact the updateTreeVisibility updateActions
// in a way which reduces the amount of such actions. This is done by
// replacing the actions with updateTree*Group*Visibility actions where
// appropriate.
// See compactToggleActions for the high-level logic of the compaction.
import _ from "lodash";
import type {
  UpdateActionWithoutIsolationRequirement,
  UpdateTreeVisibilityUpdateAction,
} from "oxalis/model/sagas/update_actions";
import { updateTreeGroupVisibility, updateTreeVisibility } from "oxalis/model/sagas/update_actions";
import type { SkeletonTracing, Tree, TreeGroup, TreeMap, VolumeTracing } from "oxalis/store";
import {
  MISSING_GROUP_ID,
  createGroupToTreesMap,
  getGroupByIdWithSubgroups,
} from "oxalis/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
type GroupNode = {
  children: GroupNode[];
  groupId: number | null | undefined;
  parent: GroupNode | null | undefined;
};

// Returns an object which maps from group id to group node
function buildTreeGroupHashMap(skeletonTracing: SkeletonTracing): Record<number, GroupNode> {
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

  createSubTree(root, skeletonTracing.treeGroups);

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
  treeIdMap: TreeMap,
  groupIdMap: Record<number, GroupNode>,
  toggleActions: UpdateTreeVisibilityUpdateAction[],
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

  for (const toggleAction of toggleActions) {
    const ancestorPath = getAncestorPath(treeIdMap[toggleAction.value.treeId].groupId);

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

function isCommonAncestorToggler(
  skeletonTracing: SkeletonTracing,
  commonAncestor: number | undefined,
): [boolean, Tree[], number] {
  const groupToTreesMap = createGroupToTreesMap(skeletonTracing.trees);
  const groupWithSubgroups = getGroupByIdWithSubgroups(skeletonTracing.treeGroups, commonAncestor);
  const allTreesOfAncestor: Tree[] =
    groupWithSubgroups.length === 0
      ? _.values(skeletonTracing.trees)
      : _.flatMap(groupWithSubgroups, (groupId: number): Tree[] => groupToTreesMap[groupId] || []);

  const [visibleTrees, invisibleTrees] = _.partition(allTreesOfAncestor, (tree) => tree.isVisible);

  const affectedTreeCount = allTreesOfAncestor.length;
  let commonVisibility;
  let exceptions;

  if (visibleTrees.length > invisibleTrees.length) {
    commonVisibility = true;
    exceptions = invisibleTrees;
  } else {
    commonVisibility = false;
    exceptions = visibleTrees;
  }

  return [commonVisibility, exceptions, affectedTreeCount];
}

export default function compactToggleActions(
  updateActions: UpdateActionWithoutIsolationRequirement[],
  tracing: SkeletonTracing | VolumeTracing,
): UpdateActionWithoutIsolationRequirement[] {
  if (tracing.type !== "skeleton") {
    // Don't do anything if this is not a skeleton tracing
    return updateActions;
  }

  const skeletonTracing = tracing;

  // Extract the toggleActions which we are interested in
  const [toggleActions, remainingActions] = _.partition<UpdateActionWithoutIsolationRequirement>(
    updateActions,
    (ua) => ua.name === "updateTreeVisibility",
  );

  if (toggleActions.length <= 1) {
    // Don't try to compact actons if there are no or only one toggleAction(s)
    return updateActions;
  }

  // Build up some helper data structures
  const hashMap = buildTreeGroupHashMap(skeletonTracing);
  // Find the group id of the common ancestor of all toggled trees
  const commonAncestor = findCommonAncestor(
    skeletonTracing.trees,
    hashMap,
    toggleActions as UpdateTreeVisibilityUpdateAction[],
  );
  // commonVisibility is the new visibility which should be applied to all ascendants
  // of the common ancestor. The exceptions array lists all trees which differ from
  // that common visibility. These will receive separate updateActions.
  const [commonVisibility, exceptions, affectedTreeCount] = isCommonAncestorToggler(
    skeletonTracing,
    commonAncestor,
  );
  // If less than 50% of the toggled trees are exceptions, we should use the compaction
  const shouldUseToggleGroup = exceptions.length < 0.5 * affectedTreeCount;
  const compactedToggleActions = [
    updateTreeGroupVisibility(commonAncestor, commonVisibility, tracing.tracingId),
    ...exceptions.map((tree) => updateTreeVisibility(tree, tracing.tracingId)),
  ];
  const finalToggleActions = shouldUseToggleGroup ? compactedToggleActions : toggleActions;
  return remainingActions.concat(finalToggleActions);
}
