// @flow

// This module is used to compact the updateTreeVisibility updateActions
// in a way which reduces the amount of such actions. This is done by
// replacing the actions with updateTree*Group*Visibility actions where
// appropriate.
// See compactToggleActions for the high-level logic of the compaction.

import _ from "lodash";

import type { SkeletonTracing, Tracing, Tree } from "oxalis/store";
import {
  type UpdateAction,
  type UpdateTreeVisibilityUpdateAction,
  updateTreeGroupVisibility,
  updateTreeVisibility,
} from "oxalis/model/sagas/update_actions";
import {
  createGroupToTreesMap,
  getGroupByIdWithSubgroups,
} from "oxalis/view/right-border-tabs/tree_hierarchy_view_helpers";

type GroupNode = {
  children: Array<GroupNode>,
  groupId: ?number,
  parent: ?GroupNode,
};

// Returns a 2-tuple with
// - a tree structure for the groups for which each node has parent pointers
// - an Object which maps from group id to group node
function buildTreeGroupTree(
  skeletonTracing: SkeletonTracing,
): [GroupNode, { [key: number]: GroupNode }] {
  const root: GroupNode = {
    children: [],
    groupId: null,
    parent: null,
  };

  function createSubTree(subTreeRoot, children) {
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

  function buildHashMap(subTreeRoot, hashMap) {
    const groupId = subTreeRoot.groupId != null ? subTreeRoot.groupId : -1;
    hashMap[groupId] = subTreeRoot;
    for (const child of subTreeRoot.children) {
      buildHashMap(child, hashMap);
    }
    return hashMap;
  }
  const hashMap = buildHashMap(root, {});

  return [root, hashMap];
}

// Finds the id of the common group for the used trees in the toggleActions
function findCommonAncestor(
  treeGroupTree,
  treeIdMap,
  groupIdMap,
  toggleActions: Array<UpdateTreeVisibilityUpdateAction>,
): number {
  function getAncestorPath(groupId): Array<number> {
    const path = [];
    let currentGroupNode = groupIdMap[groupId == null ? -1 : groupId];

    while (currentGroupNode != null) {
      if (currentGroupNode.parent == null && currentGroupNode.groupId == null) {
        break;
      }
      path.unshift(currentGroupNode.groupId != null ? currentGroupNode.groupId : -1);
      currentGroupNode = currentGroupNode.parent;
    }
    return path;
  }

  let commonPath = null;
  for (const toggleAction of toggleActions) {
    const ancestorPath = getAncestorPath(treeIdMap[toggleAction.value.treeId].groupId);
    if (commonPath == null) {
      commonPath = ancestorPath;
    } else {
      const newPath = [];
      for (let i = 0; i < commonPath.length; i++) {
        const groupId = commonPath[i];
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

function isCommonAncestorToggler(skeletonTracing: SkeletonTracing, commonAncestor: number) {
  const groupToTreesMap = createGroupToTreesMap(skeletonTracing.trees);
  const groupWithSubgroups = getGroupByIdWithSubgroups(skeletonTracing.treeGroups, commonAncestor);

  const allTreesOfAncestor: Array<Tree> =
    groupWithSubgroups.length === 0
      ? _.values(skeletonTracing.trees)
      : _.flatMap(
          groupWithSubgroups,
          (groupId: number): Array<Tree> => groupToTreesMap[groupId] || [],
        );

  const [visibleTrees, invisibleTrees] = _.partition(allTreesOfAncestor, tree => tree.isVisible);
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
  updateActions: Array<UpdateAction>,
  tracing: Tracing,
): Array<UpdateAction> {
  const skeletonTracing = tracing.skeleton;
  if (skeletonTracing == null) {
    // Don't do anything if this is not a skeleton tracing
    return updateActions;
  }

  // Extract the toggleActions which we are interested in
  const [_toggleActions, remainingActions] = _.partition(
    updateActions,
    ua => ua.name === "updateTreeVisibility",
  );
  const toggleActions = ((_toggleActions: any): Array<UpdateTreeVisibilityUpdateAction>);

  if (toggleActions.length <= 1) {
    // Don't try to compact actons if there are no or only one toggleAction(s)
    return updateActions;
  }

  // Build up some helper data structures
  const [treeGroupTree, hashMap] = buildTreeGroupTree(skeletonTracing);
  // Find the group id of the common ancestor of all toggled trees
  const commonAncestor = findCommonAncestor(
    treeGroupTree,
    skeletonTracing.trees,
    hashMap,
    toggleActions,
  );

  // commonVisibility is the new visibility which should by applied to all ascendants
  // of the common ancestor. The exceptions array lists all trees which differ from
  // that common visibility. These will receive separate updateActions.
  const [commonVisibility, exceptions, affectedTreeCount] = isCommonAncestorToggler(
    skeletonTracing,
    commonAncestor,
  );

  // If less than 50% of the toggled trees are exceptions, we should use the compaction
  const shouldUseToggleGroup = exceptions.length < 0.5 * affectedTreeCount;

  const compactedToggleActions = [
    updateTreeGroupVisibility(commonAncestor, commonVisibility),
  ].concat(exceptions.map(tree => updateTreeVisibility(tree)));
  const finalToggleActions = shouldUseToggleGroup ? compactedToggleActions : toggleActions;

  return remainingActions.concat(finalToggleActions);
}
