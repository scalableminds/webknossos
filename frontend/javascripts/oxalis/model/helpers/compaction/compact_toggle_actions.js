// @flow

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
} from "oxalis/view/right-menu/tree_hierarchy_view_helpers";

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
) {
  function getAncestorPath(groupId) {
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
  let commonVisibility;
  let exceptions = [];

  const groupToTreesMap = createGroupToTreesMap(skeletonTracing.trees);
  const groupWithSubgroups = getGroupByIdWithSubgroups(skeletonTracing.treeGroups, commonAncestor);

  const allTreesOfAncestor: Array<Tree> =
    groupWithSubgroups.length === 0
      ? _.values(skeletonTracing.trees)
      : _.flatMap(groupWithSubgroups, (groupId: number): Array<Tree> => groupToTreesMap[groupId]);

  const [visibleTrees, invisibleTrees] = _.partition(allTreesOfAncestor, tree => tree.isVisible);
  const affectedTreeCount = allTreesOfAncestor.length;

  if (visibleTrees.length === 0) {
    commonVisibility = false;
  } else if (invisibleTrees.length === 0) {
    commonVisibility = true;
  } else if (visibleTrees.length > invisibleTrees.length) {
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
    return updateActions;
  }

  const [_toggleActions, remainingActions] = _.partition(
    updateActions,
    ua => ua.name === "updateTreeVisibility",
  );
  const toggleActions = ((_toggleActions: any): Array<UpdateTreeVisibilityUpdateAction>);

  if (toggleActions.length <= 1) {
    // Don't try to compact actons if there are no or only one toggleAction(s)
    return updateActions;
  }

  const [treeGroupTree, hashMap] = buildTreeGroupTree(skeletonTracing);
  const commonAncestor = findCommonAncestor(
    treeGroupTree,
    skeletonTracing.trees,
    hashMap,
    toggleActions,
  );

  const [commonVisibility, exceptions, affectedTreeCount] = isCommonAncestorToggler(
    skeletonTracing,
    commonAncestor,
  );
  // If less than 50% of the toggled trees are exceptions, we can use the compactation
  const shouldUseToggleGroup = exceptions.length < 0.5 * affectedTreeCount;

  const finalToggleActions =
    commonAncestor != null && shouldUseToggleGroup
      ? [updateTreeGroupVisibility(commonAncestor, commonVisibility)].concat(
          exceptions.map(tree => updateTreeVisibility(tree)),
        )
      : toggleActions;

  return remainingActions.concat(finalToggleActions);
}
