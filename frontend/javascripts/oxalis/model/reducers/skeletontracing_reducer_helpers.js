/**
 * skeletontracing_reducer_helpers.js
 * @flow
 *
 * THESE HELPER FUNCTIONS MUST ONLY BE CALLED FROM A REDUCER
 *
 */

import Maybe from "data.maybe";
import _ from "lodash";
import update from "immutability-helper";

import type {
  OxalisState,
  SkeletonTracing,
  Edge,
  Node,
  MutableNode,
  Tree,
  MutableTree,
  BranchPoint,
  MutableBranchPoint,
  MutableCommentType,
  TreeMap,
  MutableTreeMap,
  CommentType,
  TreeGroup,
  RestrictionsAndSettings,
} from "oxalis/store";
import type {
  ServerSkeletonTracingTree,
  ServerNode,
  ServerBranchPoint,
} from "types/api_flow_types";
import {
  getSkeletonTracing,
  getActiveNodeFromTree,
  getTree,
  getActiveTree,
  getActiveGroup,
  findTreeByNodeId,
} from "oxalis/model/accessors/skeletontracing_accessor";
import ColorGenerator from "libs/color_generator";
import Constants, { NODE_ID_REF_REGEX, type Vector3 } from "oxalis/constants";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import * as Utils from "libs/utils";

export const DEFAULT_NODE_RADIUS = 1.0;

export function generateTreeName(state: OxalisState, timestamp: number, treeId: number) {
  let user = "";
  if (state.activeUser) {
    user = `${state.activeUser.firstName}_${state.activeUser.lastName}`;
    user = user.replace(/ /g, "_"); // Replace spaces in user names
  }

  let prefix = "Tree";
  if (state.tracing.annotationType === "Explorational") {
    // Get YYYY-MM-DD string
    const creationDate = new Date(timestamp).toJSON().slice(0, 10);
    prefix = `explorative_${creationDate}_${user}_`;
  } else if (state.task) {
    prefix = `task_${state.task.id}_${user}_`;
  }

  return `${prefix}${Utils.zeroPad(treeId, 3)}`;
}

function getMaximumNodeId(trees: TreeMap | MutableTreeMap): number {
  const newMaxNodeId = _.max(_.flatMap(trees, __ => __.nodes.map(n => n.id)));
  return newMaxNodeId != null ? newMaxNodeId : Constants.MIN_NODE_ID - 1;
}

export function getMaximumTreeId(trees: TreeMap | MutableTreeMap): number {
  const maxTreeId = _.max(_.map(trees, "treeId"));
  return maxTreeId != null ? maxTreeId : Constants.MIN_TREE_ID - 1;
}

function getNearestTreeId(treeId: number, trees: TreeMap): number {
  const sortedTreeIds = Object.keys(trees)
    .map(currentTreeId => parseInt(currentTreeId))
    .sort((firstId, secId) => (firstId > secId ? 1 : -1));
  if (sortedTreeIds.length === 0) {
    return 0;
  }
  // Uses a binary search to determine the lowest index at which treeId should be inserted into sortedTreeIds in order to maintain its sort order.
  // This corresponds to the original index of the deleted treeId.
  const originalIndex = _.sortedIndex(sortedTreeIds, treeId);
  const higherOrNearestId = Math.min(originalIndex, sortedTreeIds.length - 1);
  return sortedTreeIds[higherOrNearestId];
}

export function* mapGroups<R>(
  groups: Array<TreeGroup>,
  callback: TreeGroup => R,
): Generator<R, void, void> {
  for (const group of groups) {
    yield callback(group);
    if (group.children) {
      yield* mapGroups(group.children, callback);
    }
  }
}

export function getMaximumGroupId(groups: Array<TreeGroup>): number {
  const maxGroupId = _.max(Array.from(mapGroups(groups, group => group.groupId)));
  return maxGroupId >= 0 ? maxGroupId : 0;
}

function forEachGroups(groups: Array<TreeGroup>, callback: TreeGroup => *) {
  for (const group of groups) {
    callback(group);
    if (group.children) {
      forEachGroups(group.children, callback);
    }
  }
}

export function createNode(
  state: OxalisState,
  skeletonTracing: SkeletonTracing,
  tree: Tree,
  position: Vector3,
  rotation: Vector3,
  viewport: number,
  resolution: number,
  timestamp: number,
  restrictions: RestrictionsAndSettings,
): Maybe<[Node, EdgeCollection]> {
  const { allowUpdate } = restrictions;
  const activeNodeMaybe = getActiveNodeFromTree(skeletonTracing, tree);

  if (allowUpdate) {
    // Use the same radius as current active node or revert to default value
    const radius = activeNodeMaybe
      .map(activeNode => activeNode.radius)
      .getOrElse(DEFAULT_NODE_RADIUS);

    // Find new node id by increasing the max node id.
    const nextNewId = skeletonTracing.cachedMaxNodeId + 1;

    // Create the new node
    const node: Node = {
      position,
      radius,
      rotation,
      viewport,
      resolution,
      id: nextNewId,
      timestamp,
      bitDepth: state.datasetConfiguration.fourBit ? 4 : 8,
      interpolation: state.datasetConfiguration.interpolation,
    };

    // Create a new edge
    const edges = activeNodeMaybe
      .map(activeNode => {
        const newEdge = {
          source: activeNode.id,
          target: nextNewId,
        };
        return tree.edges.addEdge(newEdge);
      })
      .getOrElse(tree.edges);

    return Maybe.Just([node, edges]);
  }
  return Maybe.Nothing();
}

export function deleteNode(
  state: OxalisState,
  tree: Tree,
  node: Node,
  timestamp: number,
  restrictions: RestrictionsAndSettings,
): Maybe<[TreeMap, number, ?number, number]> {
  return getSkeletonTracing(state.tracing).chain(skeletonTracing => {
    const { allowUpdate } = restrictions;

    if (allowUpdate) {
      // Delete node and possible branchpoints/comments
      const activeTree = update(tree, {
        nodes: { $apply: nodes => nodes.delete(node.id) },
        comments: { $apply: comments => comments.filter(comment => comment.nodeId !== node.id) },
        branchPoints: {
          $apply: branchPoints =>
            branchPoints.filter(branchPoint => branchPoint.nodeId !== node.id),
        },
      });

      // Do we need to split trees? Are there edges leading to/from it?
      const neighborIds = [];
      const deletedEdges = activeTree.edges.getEdgesForNode(node.id);
      for (const edge of deletedEdges) {
        neighborIds.push(edge.target === node.id ? edge.source : edge.target);
      }

      const newTrees = splitTreeByNodes(
        state,
        skeletonTracing,
        activeTree,
        neighborIds,
        deletedEdges,
        timestamp,
      );

      // If the deleted node had the max id, find the new largest id
      let newMaxNodeId = skeletonTracing.cachedMaxNodeId;
      if (node.id === newMaxNodeId) {
        newMaxNodeId = getMaximumNodeId(newTrees);
      }

      const newActiveNodeId = neighborIds.length > 0 ? Math.min(...neighborIds) : null;
      const newActiveTree =
        newActiveNodeId != null ? findTreeByNodeId(newTrees, newActiveNodeId).get() : activeTree;
      const newActiveTreeId = newActiveTree.treeId;

      return Maybe.Just([newTrees, newActiveTreeId, newActiveNodeId, newMaxNodeId]);
    } else {
      return Maybe.Nothing();
    }
  });
}

export function deleteEdge(
  state: OxalisState,
  sourceTree: Tree,
  sourceNode: Node,
  targetTree: Tree,
  targetNode: Node,
  timestamp: number,
  restrictions: RestrictionsAndSettings,
): Maybe<[TreeMap, number]> {
  return getSkeletonTracing(state.tracing).chain(skeletonTracing => {
    const { allowUpdate } = restrictions;

    if (allowUpdate) {
      if (sourceTree.treeId !== targetTree.treeId) {
        // The two selected nodes are in different trees
        console.error(
          "Tried to delete an edge that was not there, the two nodes are in different trees.",
        );
        return Maybe.Nothing();
      }

      const deletedEdge = sourceTree.edges
        .getEdgesForNode(sourceNode.id)
        .find(edge => edge.target === targetNode.id || edge.source === targetNode.id);

      if (deletedEdge == null) {
        // The two selected nodes do not share an edge
        console.error("Tried to delete an edge that was not there.");
        return Maybe.Nothing();
      }

      const newTrees = splitTreeByNodes(
        state,
        skeletonTracing,
        sourceTree,
        [sourceNode.id, targetNode.id],
        [deletedEdge],
        timestamp,
      );

      // The treeId of the tree the active node belongs to could have changed
      const newActiveTree = findTreeByNodeId(newTrees, sourceNode.id).get();

      return Maybe.Just([newTrees, newActiveTree.treeId]);
    } else {
      return Maybe.Nothing();
    }
  });
}

function splitTreeByNodes(
  state: OxalisState,
  skeletonTracing: SkeletonTracing,
  activeTree: Tree,
  newTreeRootIds: Array<number>,
  deletedEdges: Array<Edge>,
  timestamp: number,
): TreeMap {
  // This function splits a given tree by deleting the given edges and making the
  // given node ids the new tree roots.
  // Not every node id is guaranteed to be a new tree root as there may be cyclic trees.

  let newTrees = skeletonTracing.trees;

  if (newTreeRootIds.length === 0) {
    // As there are no new tree root ids, we are deleting the last node from a tree.
    // It suffices to simply update that tree within the tree collection
    return update(newTrees, { [activeTree.treeId]: { $set: activeTree } });
  }

  // Traverse from each possible new root node in all directions (i.e., use each edge) and
  // remember which edges were already visited.
  const visitedEdges = {};
  const getEdgeHash = edge => `${edge.source}-${edge.target}`;
  const visitedNodes = {};

  // Mark deletedEdges as visited, so they are not traversed.
  deletedEdges.forEach(deletedEdge => {
    visitedEdges[getEdgeHash(deletedEdge)] = true;
  });

  const traverseTree = (inputNodeId: number, newTree: Tree) => {
    const nodeQueue = [inputNodeId];

    while (nodeQueue.length !== 0) {
      const nodeId = nodeQueue.shift();
      const edges = activeTree.edges.getEdgesForNode(nodeId);
      visitedNodes[nodeId] = true;
      newTree.nodes.mutableSet(nodeId, activeTree.nodes.get(nodeId));

      for (const edge of edges) {
        const edgeHash = getEdgeHash(edge);
        if (visitedEdges[edgeHash]) {
          continue;
        }
        visitedEdges[edgeHash] = true;
        newTree.edges.addEdge(edge, true);

        if (nodeId === edge.target) {
          nodeQueue.push(edge.source);
        } else {
          nodeQueue.push(edge.target);
        }
      }
    }
  };

  // The intermediateState is used for the createTree function, which takes
  // care of generating non-colliding tree names, ids and colors
  let intermediateState = state;
  // For each new tree root create a new tree
  const cutTrees = _.compact(
    // Sort the treeRootIds, so the tree connected to the node with the lowest id will remain the original tree (treeId, name, timestamp)
    newTreeRootIds
      .slice()
      .sort((a, b) => a - b)
      .map((rootNodeId, index) => {
        // The rootNodeId could have already been traversed from another rootNodeId
        // as there are cyclic trees
        // In this case we do not need to create a new tree for this rootNodeId
        if (visitedNodes[rootNodeId] === true) {
          return null;
        }

        let newTree;
        if (index === 0) {
          // Reuse the properties of the original tree for the first tree
          newTree = {
            branchPoints: [],
            color: activeTree.color,
            comments: [],
            edges: new EdgeCollection(),
            name: activeTree.name,
            nodes: new DiffableMap(),
            timestamp: activeTree.timestamp,
            treeId: activeTree.treeId,
            isVisible: true,
            groupId: activeTree.groupId,
          };
        } else {
          const immutableNewTree = createTree(intermediateState, timestamp).get();
          // Cast to mutable tree type since we want to mutably do the split
          // in this reducer for performance reasons.
          newTree = ((immutableNewTree: any): Tree);
          intermediateState = update(intermediateState, {
            tracing: { skeleton: { trees: { [newTree.treeId]: { $set: newTree } } } },
          });
        }

        traverseTree(rootNodeId, newTree);
        return newTree;
      }),
  );

  // Write branchpoints into correct trees
  activeTree.branchPoints.forEach(branchpoint => {
    cutTrees.forEach(newTree => {
      if (newTree.nodes.has(branchpoint.nodeId)) {
        newTree.branchPoints.push(branchpoint);
      }
    });
  });

  // Write comments into correct trees
  activeTree.comments.forEach(comment => {
    cutTrees.forEach(newTree => {
      if (newTree.nodes.has(comment.nodeId)) {
        newTree.comments.push(comment);
      }
    });
  });

  newTrees = skeletonTracing.trees;
  cutTrees.forEach(cutTree => {
    newTrees = update(newTrees, { [cutTree.treeId]: { $set: cutTree } });
  });

  return newTrees;
}

export function createBranchPoint(
  skeletonTracing: SkeletonTracing,
  tree: Tree,
  node: Node,
  timestamp: number,
  restrictions: RestrictionsAndSettings,
): Maybe<BranchPoint> {
  const { branchPointsAllowed, allowUpdate } = restrictions;

  if (branchPointsAllowed && allowUpdate) {
    const doesBranchPointExistAlready = _.some(
      tree.branchPoints,
      branchPoint => branchPoint.nodeId === node.id,
    );

    if (!doesBranchPointExistAlready) {
      // create new branchpoint
      return Maybe.Just({
        nodeId: node.id,
        timestamp,
      });
    }
  }
  return Maybe.Nothing();
}

export function deleteBranchPoint(
  skeletonTracing: SkeletonTracing,
  restrictions: RestrictionsAndSettings,
): Maybe<[Array<BranchPoint>, number, number]> {
  const { branchPointsAllowed, allowUpdate } = restrictions;
  const { trees } = skeletonTracing;
  const hasBranchPoints = _.some(_.map(trees, __ => !_.isEmpty(__.branchPoints)));

  if (branchPointsAllowed && allowUpdate && hasBranchPoints) {
    // Find most recent branchpoint across all trees
    const treesWithBranchPoints = _.values(trees).filter(tree => !_.isEmpty(tree.branchPoints));
    const { treeId } = _.maxBy(treesWithBranchPoints, tree => _.last(tree.branchPoints).timestamp);
    const branchPoint = _.last(trees[treeId].branchPoints);

    if (branchPoint) {
      // Delete branchpoint
      const newBranchPoints = _.without(skeletonTracing.trees[treeId].branchPoints, branchPoint);
      return Maybe.Just([newBranchPoints, treeId, branchPoint.nodeId]);
    }
  }
  return Maybe.Nothing();
}

export function createTree(
  state: OxalisState,
  timestamp: number,
  addToActiveGroup: boolean = true,
): Maybe<Tree> {
  return getSkeletonTracing(state.tracing).chain(skeletonTracing => {
    const { allowUpdate } = state.tracing.restrictions;

    if (allowUpdate) {
      // Create a new tree id and name
      const newTreeId = getMaximumTreeId(skeletonTracing.trees) + 1;

      const name = generateTreeName(state, timestamp, newTreeId);
      let groupId = null;
      if (addToActiveGroup) {
        const groupIdOfActiveTreeMaybe = getActiveTree(skeletonTracing).map(tree => tree.groupId);
        const groupIdOfActiveGroupMaybe = getActiveGroup(skeletonTracing).map(
          group => group.groupId,
        );
        groupId = Utils.toNullable(
          groupIdOfActiveTreeMaybe.orElse(() => groupIdOfActiveGroupMaybe),
        );
      }

      // Create the new tree
      const tree: Tree = {
        name,
        treeId: newTreeId,
        nodes: new DiffableMap(),
        timestamp,
        color: ColorGenerator.distinctColorForId(newTreeId),
        branchPoints: [],
        edges: new EdgeCollection(),
        comments: [],
        isVisible: true,
        groupId,
      };
      return Maybe.Just(tree);
    }
    return Maybe.Nothing();
  });
}

export function getOrCreateTree(
  state: OxalisState,
  skeletonTracing: SkeletonTracing,
  treeId: ?number,
  timestamp: number,
): Maybe<Tree> {
  return getTree(skeletonTracing, treeId).orElse(() => {
    // Only create a new tree if there are no trees
    // Specifically, this means that no new tree is created just because
    // the activeTreeId is temporarily null
    if (_.size(skeletonTracing.trees) === 0) {
      return createTree(state, timestamp);
    }
    return Maybe.Nothing();
  });
}

export function addTreesAndGroups(
  state: OxalisState,
  trees: MutableTreeMap,
  treeGroups: Array<TreeGroup>,
  restrictions: RestrictionsAndSettings,
): Maybe<[MutableTreeMap, Array<TreeGroup>, number]> {
  return getSkeletonTracing(state.tracing).chain(skeletonTracing => {
    const { allowUpdate } = restrictions;

    if (allowUpdate) {
      // Assign a new tree name for trees without a name
      const treeIds = Object.keys(trees).map(treeId => Number(treeId));
      for (const treeId of treeIds) {
        const tree = trees[treeId];
        if (tree.name === "") {
          tree.name = generateTreeName(state, tree.timestamp, tree.treeId);
        }
      }

      // TreeIds > 1024^2 break webKnossos, see https://github.com/scalableminds/webknossos/issues/5009
      const hasTreeIdsLargerThanMaximum = treeIds.filter(treeId => treeId > 1048576);
      const needsReassignedIds =
        Object.keys(skeletonTracing.trees).length > 0 || hasTreeIdsLargerThanMaximum;

      if (!needsReassignedIds) {
        // Without reassigning ids, the code is considerably faster.
        const newMaxNodeId = getMaximumNodeId(trees);
        return Maybe.Just([trees, treeGroups, newMaxNodeId]);
      }

      const groupIdMap = {};
      let nextGroupId = getMaximumGroupId(skeletonTracing.treeGroups) + 1;

      forEachGroups(treeGroups, (group: TreeGroup) => {
        // Assign new group ids for all groups
        groupIdMap[group.groupId] = nextGroupId;
        group.groupId = nextGroupId;
        nextGroupId++;
      });

      // Assign new ids for all nodes and trees to avoid duplicates
      let newTreeId = getMaximumTreeId(skeletonTracing.trees) + 1;
      let newNodeId = skeletonTracing.cachedMaxNodeId + 1;

      // Create a map from old node ids to new node ids
      // This needs to be done in advance to replace nodeId references in comments
      const idMap = {};
      for (const tree of _.values(trees)) {
        for (const node of tree.nodes.values()) {
          idMap[node.id] = newNodeId++;
        }
      }

      const newTrees = {};
      for (const treeId of treeIds) {
        const tree = trees[treeId];

        const newNodes = new DiffableMap();
        for (const node of tree.nodes.values()) {
          node.id = idMap[node.id];
          newNodes.mutableSet(node.id, node);
        }
        tree.nodes = newNodes;

        tree.edges = EdgeCollection.loadFromArray(
          tree.edges.map(edge => ({
            source: idMap[edge.source],
            target: idMap[edge.target],
          })),
        );

        for (const comment of tree.comments) {
          // Comments can reference other nodes, rewrite those references if the referenced id changed
          comment.nodeId = idMap[comment.nodeId];
          comment.content = comment.content.replace(
            NODE_ID_REF_REGEX,
            (__, p1) => `#${idMap[Number(p1)] != null ? idMap[Number(p1)] : p1}`,
          );
        }

        for (const bp of tree.branchPoints) {
          bp.nodeId = idMap[bp.nodeId];
        }

        // Assign the new group id to the tree if the tree belongs to a group
        tree.groupId = tree.groupId != null ? groupIdMap[tree.groupId] : tree.groupId;

        tree.treeId = newTreeId;
        newTrees[tree.treeId] = tree;

        newTreeId++;
      }
      return Maybe.Just([newTrees, treeGroups, newNodeId - 1]);
    }
    return Maybe.Nothing();
  });
}

export function deleteTree(
  state: OxalisState,
  tree: Tree,
  restrictions: RestrictionsAndSettings,
): Maybe<[TreeMap, ?number, ?number, number]> {
  return getSkeletonTracing(state.tracing).chain(skeletonTracing => {
    const { allowUpdate } = restrictions;

    if (allowUpdate) {
      // Delete tree
      const newTrees = _.omit(skeletonTracing.trees, tree.treeId.toString());

      let newActiveTreeId = null;
      let newActiveNodeId = null;
      if (_.size(newTrees) > 0) {
        // Setting the tree active whose id is the next highest compared to the id of the deleted tree.
        newActiveTreeId = getNearestTreeId(tree.treeId, newTrees);
        // Object.keys returns strings and the newActiveNodeId should be an integer
        newActiveNodeId = +_.first(Array.from(newTrees[newActiveTreeId].nodes.keys())) || null;
      }
      const newMaxNodeId = getMaximumNodeId(newTrees);

      return Maybe.Just([newTrees, newActiveTreeId, newActiveNodeId, newMaxNodeId]);
    }
    return Maybe.Nothing();
  });
}

export function mergeTrees(
  skeletonTracing: SkeletonTracing,
  sourceNodeId: number,
  targetNodeId: number,
  restrictions: RestrictionsAndSettings,
): Maybe<[Tree, number, number]> {
  const { allowUpdate } = restrictions;
  const { trees } = skeletonTracing;
  const sourceTree = findTreeByNodeId(trees, sourceNodeId).get();
  const targetTree = findTreeByNodeId(trees, targetNodeId).get(); // should be activeTree

  if (allowUpdate && sourceTree != null && targetTree != null && sourceTree !== targetTree) {
    const newEdge: Edge = {
      source: sourceNodeId,
      target: targetNodeId,
    };

    let newTrees = _.omit(trees, sourceTree.treeId.toString());

    const newNodes = targetTree.nodes.clone();
    for (const [id, node] of sourceTree.nodes.entries()) {
      newNodes.mutableSet(id, node);
    }

    newTrees = update(newTrees, {
      [targetTree.treeId]: {
        nodes: { $set: newNodes },
        edges: {
          $set: targetTree.edges.addEdges(sourceTree.edges.asArray().concat(newEdge)),
        },
        comments: { $set: targetTree.comments.concat(sourceTree.comments) },
        branchPoints: { $set: targetTree.branchPoints.concat(sourceTree.branchPoints) },
      },
    });
    return Maybe.Just([newTrees, targetTree.treeId, targetNodeId]);
  }
  return Maybe.Nothing();
}

export function shuffleTreeColor(
  skeletonTracing: SkeletonTracing,
  tree: Tree,
): Maybe<[Tree, number]> {
  const randomId = _.random(0, 10000, false);
  return setTreeColorIndex(skeletonTracing, tree, randomId);
}

export function setTreeColorIndex(
  skeletonTracing: SkeletonTracing,
  tree: Tree,
  colorIndex: number,
): Maybe<[Tree, number]> {
  const newTree = update(tree, { color: { $set: ColorGenerator.distinctColorForId(colorIndex) } });
  return Maybe.Just([newTree, tree.treeId]);
}

export function createComment(
  skeletonTracing: SkeletonTracing,
  tree: Tree,
  node: Node,
  commentText: string,
  restrictions: RestrictionsAndSettings,
): Maybe<Array<CommentType>> {
  const { allowUpdate } = restrictions;

  if (allowUpdate) {
    // Gather all comments other than the activeNode's comments
    const { comments } = tree;
    const commentsWithoutActiveNodeComment = comments.filter(comment => comment.nodeId !== node.id);

    const newComment: CommentType = {
      nodeId: node.id,
      content: commentText,
    };

    const newComments = commentsWithoutActiveNodeComment.concat([newComment]);
    return Maybe.Just(newComments);
  }

  return Maybe.Nothing();
}

export function deleteComment(
  skeletonTracing: SkeletonTracing,
  tree: Tree,
  node: Node,
  restrictions: RestrictionsAndSettings,
): Maybe<Array<CommentType>> {
  const { allowUpdate } = restrictions;

  if (allowUpdate) {
    const { comments } = tree;
    const commentsWithoutActiveNodeComment = comments.filter(comment => comment.nodeId !== node.id);

    return Maybe.Just(commentsWithoutActiveNodeComment);
  }
  return Maybe.Nothing();
}

export function toggleAllTreesReducer(
  state: OxalisState,
  skeletonTracing: SkeletonTracing,
): OxalisState {
  // Let's make all trees visible if there is one invisible tree
  const shouldBecomeVisible = _.values(skeletonTracing.trees).some(tree => !tree.isVisible);

  const updateTreeObject = {};
  const isVisibleUpdater = {
    isVisible: { $set: shouldBecomeVisible },
  };
  Object.keys(skeletonTracing.trees).forEach(treeId => {
    updateTreeObject[treeId] = isVisibleUpdater;
  });

  return update(state, {
    tracing: {
      skeleton: {
        trees: updateTreeObject,
      },
    },
  });
}

export function toggleTreeGroupReducer(
  state: OxalisState,
  skeletonTracing: SkeletonTracing,
  groupId: number,
  targetVisibility?: boolean,
): OxalisState {
  let toggledGroup;
  forEachGroups(skeletonTracing.treeGroups, group => {
    if (group.groupId === groupId) toggledGroup = group;
  });
  if (toggledGroup == null) return state;

  // Assemble a list that contains the toggled groupId and the groupIds of all child groups
  const affectedGroupIds = new Set(mapGroups([toggledGroup], group => group.groupId));

  // Let's make all trees visible if there is one invisible tree in one of the affected groups
  const shouldBecomeVisible =
    targetVisibility != null
      ? targetVisibility
      : _.values(skeletonTracing.trees).some(
          tree => affectedGroupIds.has(tree.groupId) && !tree.isVisible,
        );

  const updateTreeObject = {};
  const isVisibleUpdater = {
    isVisible: { $set: shouldBecomeVisible },
  };
  _.values(skeletonTracing.trees).forEach(tree => {
    if (affectedGroupIds.has(tree.groupId)) {
      updateTreeObject[tree.treeId] = isVisibleUpdater;
    }
  });

  return update(state, {
    tracing: {
      skeleton: { trees: updateTreeObject },
    },
  });
}

function serverNodeToMutableNode(n: ServerNode): MutableNode {
  return {
    id: n.id,
    position: Utils.point3ToVector3(n.position),
    rotation: Utils.point3ToVector3(n.rotation),
    bitDepth: n.bitDepth,
    viewport: n.viewport,
    resolution: n.resolution,
    radius: n.radius,
    timestamp: n.createdTimestamp,
    interpolation: n.interpolation,
  };
}

function serverBranchPointToMutableBranchPoint(b: ServerBranchPoint): MutableBranchPoint {
  return {
    timestamp: b.createdTimestamp,
    nodeId: b.nodeId,
  };
}

export function createMutableTreeMapFromTreeArray(
  trees: Array<ServerSkeletonTracingTree>,
): MutableTreeMap {
  return _.keyBy(
    trees.map(
      (tree): MutableTree => ({
        comments: ((tree.comments: any): Array<MutableCommentType>),
        edges: EdgeCollection.loadFromArray(tree.edges),
        name: tree.name,
        treeId: tree.treeId,
        nodes: new DiffableMap(
          tree.nodes.map(serverNodeToMutableNode).map(node => [node.id, node]),
        ),
        color:
          tree.color != null
            ? Utils.colorObjectToRGBArray(tree.color)
            : ColorGenerator.distinctColorForId(tree.treeId),
        branchPoints: _.map(tree.branchPoints, serverBranchPointToMutableBranchPoint),
        isVisible: tree.isVisible != null ? tree.isVisible : true,
        timestamp: tree.createdTimestamp,
        groupId: tree.groupId,
      }),
    ),
    "treeId",
  );
}

export function createTreeMapFromTreeArray(trees: Array<ServerSkeletonTracingTree>): TreeMap {
  return ((createMutableTreeMapFromTreeArray(trees): any): TreeMap);
}

export function removeMissingGroupsFromTrees(
  skeletonTracing: SkeletonTracing,
  treeGroups: Array<TreeGroup>,
): TreeMap {
  // Change the groupId of trees for groups that no longer exist
  const groupIds = Array.from(mapGroups(treeGroups, group => group.groupId));
  const changedTrees = {};
  Object.keys(skeletonTracing.trees).forEach(treeId => {
    const tree = skeletonTracing.trees[Number(treeId)];
    if (tree.groupId != null && !groupIds.includes(tree.groupId)) {
      changedTrees[treeId] = { ...tree, groupId: null };
    }
  });
  return changedTrees;
}
