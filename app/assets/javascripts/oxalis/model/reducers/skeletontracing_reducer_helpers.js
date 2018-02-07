/**
 * skeletontracing_reducer_helpers.js
 * @flow
 *
 * THESE HELPER FUNCTIONS MUST ONLY BE CALLED FROM A REDUCER
 *
 */

import _ from "lodash";
import Maybe from "data.maybe";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import ColorGenerator from "libs/color_generator";
import update from "immutability-helper";
import Utils from "libs/utils";
import Constants from "oxalis/constants";
import {
  getSkeletonTracing,
  getActiveNodeFromTree,
  findTreeByNodeId,
} from "oxalis/model/accessors/skeletontracing_accessor";
import type { Vector3 } from "oxalis/constants";
import type {
  OxalisState,
  SkeletonTracingType,
  EdgeType,
  NodeType,
  TreeType,
  BranchPointType,
  TreeMapType,
  CommentType,
} from "oxalis/store";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";

export function generateTreeName(state: OxalisState, timestamp: number, treeId: number) {
  let user = "";
  if (state.activeUser) {
    user = `${state.activeUser.firstName}_${state.activeUser.lastName}`;
    user = user.replace(/ /g, "_"); // Replace spaces in user names
  }

  let prefix = "Tree";
  if (state.tracing.tracingType === "Explorational") {
    // Get YYYY-MM-DD string
    const creationDate = new Date(timestamp).toJSON().slice(0, 10);
    prefix = `explorative_${creationDate}_${user}_`;
  } else if (state.task) {
    prefix = `task_${state.task.id}_${user}_`;
  }

  return `${prefix}${Utils.zeroPad(treeId, 3)}`;
}

function getMaximumNodeId(trees: TreeMapType): number {
  const newMaxNodeId = _.max(_.flatMap(trees, __ => __.nodes.map(n => n.id)));
  return newMaxNodeId != null ? newMaxNodeId : Constants.MIN_NODE_ID - 1;
}

function getMaximumTreeId(trees: TreeMapType): number {
  return _.max(_.map(trees, "treeId"));
}

export function createNode(
  state: OxalisState,
  skeletonTracing: SkeletonTracingType,
  tree: TreeType,
  position: Vector3,
  rotation: Vector3,
  viewport: number,
  resolution: number,
  timestamp: number,
): Maybe<[NodeType, EdgeCollection]> {
  const { allowUpdate } = skeletonTracing.restrictions;
  const activeNodeMaybe = getActiveNodeFromTree(skeletonTracing, tree);

  if (allowUpdate) {
    // Use the same radius as current active node or revert to default value
    const defaultRadius = 10 * getBaseVoxel(state.dataset.scale);
    const radius = activeNodeMaybe.map(activeNode => activeNode.radius).getOrElse(defaultRadius);

    // Find new node id by increasing the max node id.
    const nextNewId = skeletonTracing.cachedMaxNodeId + 1;

    // Create the new node
    const node: NodeType = {
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
    const newEdges = activeNodeMaybe
      .map(activeNode => [
        {
          source: activeNode.id,
          target: nextNewId,
        },
      ])
      .getOrElse([]);
    const edges = tree.edges.addEdges(newEdges);

    return Maybe.Just([node, edges]);
  }
  return Maybe.Nothing();
}

export function deleteNode(
  state: OxalisState,
  tree: TreeType,
  node: NodeType,
  timestamp: number,
): Maybe<[TreeMapType, number, ?number, number]> {
  return getSkeletonTracing(state.tracing).chain(skeletonTracing => {
    const { allowUpdate } = skeletonTracing.restrictions;

    if (allowUpdate) {
      // Delete Node
      const activeTree = update(tree, {
        nodes: { $apply: nodes => nodes.delete(node.id) },
      });

      // Do we need to split trees? Are there edges leading to/from it?
      const neighborIds = [];
      const deletedEdges = activeTree.edges.getEdgesForNode(node.id);
      for (const edge of deletedEdges) {
        neighborIds.push(edge.target === node.id ? edge.source : edge.target);
      }

      if (neighborIds.length === 0) {
        return deleteTree(state, activeTree, timestamp);
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

      const newActiveNodeId = neighborIds[0];
      const newActiveTree = findTreeByNodeId(newTrees, newActiveNodeId).get();
      const newActiveTreeId = newActiveTree.treeId;

      return Maybe.Just([newTrees, newActiveTreeId, newActiveNodeId, newMaxNodeId]);
    } else {
      return Maybe.Nothing();
    }
  });
}

export function deleteEdge(
  state: OxalisState,
  sourceTree: TreeType,
  sourceNode: NodeType,
  targetTree: TreeType,
  targetNode: NodeType,
  timestamp: number,
): Maybe<TreeMapType> {
  return getSkeletonTracing(state.tracing).chain(skeletonTracing => {
    const { allowUpdate } = skeletonTracing.restrictions;

    if (allowUpdate) {
      if (sourceTree.treeId !== targetTree.treeId) {
        // The two selected nodes are in different trees
        console.error(
          "Tried two delete an edge that was not there, the two nodes are in different trees.",
        );
        return Maybe.Nothing();
      }

      const deletedEdge = sourceTree.edges
        .getEdgesForNode(sourceNode.id)
        .find(edge => edge.target === targetNode.id || edge.source === targetNode.id);

      if (deletedEdge == null) {
        // The two selected nodes do not share an edge
        console.error("Tried two delete an edge that was not there.");
        return Maybe.Nothing();
      }

      return Maybe.Just(
        splitTreeByNodes(
          state,
          skeletonTracing,
          sourceTree,
          [sourceNode.id, targetNode.id],
          [deletedEdge],
          timestamp,
        ),
      );
    } else {
      return Maybe.Nothing();
    }
  });
}

function splitTreeByNodes(
  state: OxalisState,
  skeletonTracing: SkeletonTracingType,
  activeTree: TreeType,
  newTreeRootIds: Array<number>,
  deletedEdges: Array<EdgeType>,
  timestamp: number,
): TreeMapType {
  // This function splits a given tree by deleting the given edges and making the
  // given node ids the new tree roots.
  // Not every node id is guaranteed to be a new tree root as there may be cyclic trees.

  let newTrees = skeletonTracing.trees;

  // Traverse from each possible new root node in all directions (i.e., use each edge) and
  // remember which edges were already visited.
  const visitedEdges = {};
  const getEdgeHash = edge => `${edge.source}-${edge.target}`;
  const visitedNodes = {};

  // Mark deletedEdges as visited, so they are not traversed.
  deletedEdges.forEach(deletedEdge => {
    visitedEdges[getEdgeHash(deletedEdge)] = true;
  });

  const traverseTree = (inputNodeId: number, newTree: TreeType) => {
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
    newTreeRootIds.map((rootNodeId, index) => {
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
        };
      } else {
        const immutableNewTree = createTree(intermediateState, timestamp).get();
        // Cast to mutable tree type since we want to mutably do the split
        // in this reducer for performance reasons.
        newTree = ((immutableNewTree: any): TreeType);
        intermediateState = update(intermediateState, {
          tracing: { trees: { [newTree.treeId]: { $set: newTree } } },
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
  skeletonTracing: SkeletonTracingType,
  tree: TreeType,
  node: NodeType,
  timestamp: number,
): Maybe<BranchPointType> {
  const { branchPointsAllowed, allowUpdate } = skeletonTracing.restrictions;

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
  skeletonTracing: SkeletonTracingType,
): Maybe<[Array<BranchPointType>, number, number]> {
  const { branchPointsAllowed, allowUpdate } = skeletonTracing.restrictions;
  const { trees } = skeletonTracing;
  const hasBranchPoints = _.some(_.map(trees, __ => !_.isEmpty(__.branchPoints)));

  if (branchPointsAllowed && allowUpdate && hasBranchPoints) {
    // Find most recent branchpoint across all trees
    const treesWithBranchPoints = _.values(trees).filter(tree => !_.isEmpty(tree.branchPoints));
    const treeId = _.maxBy(treesWithBranchPoints, tree => _.last(tree.branchPoints).timestamp)
      .treeId;
    const branchPoint = _.last(trees[treeId].branchPoints);

    if (branchPoint) {
      // Delete branchpoint
      const newBranchPoints = _.without(skeletonTracing.trees[treeId].branchPoints, branchPoint);
      return Maybe.Just([newBranchPoints, treeId, branchPoint.nodeId]);
    }
  }
  return Maybe.Nothing();
}

export function createTree(state: OxalisState, timestamp: number): Maybe<TreeType> {
  return getSkeletonTracing(state.tracing).chain(skeletonTracing => {
    const { allowUpdate } = state.tracing.restrictions;

    if (allowUpdate) {
      // create a new tree id and name
      // tree id can become 0 after deleting all trees
      const maxTreeId = getMaximumTreeId(skeletonTracing.trees);
      const newTreeId = _.isNumber(maxTreeId) ? maxTreeId + 1 : Constants.MIN_TREE_ID;

      const name = generateTreeName(state, timestamp, newTreeId);

      // Create the new tree
      const tree: TreeType = {
        name,
        treeId: newTreeId,
        nodes: new DiffableMap(),
        timestamp,
        color: ColorGenerator.distinctColorForId(newTreeId),
        branchPoints: [],
        edges: new EdgeCollection(),
        comments: [],
        isVisible: true,
      };
      return Maybe.Just(tree);
    }
    return Maybe.Nothing();
  });
}

export function addTrees(state: OxalisState, trees: TreeMapType): Maybe<TreeMapType> {
  return getSkeletonTracing(state.tracing).chain(skeletonTracing => {
    const { allowUpdate } = skeletonTracing.restrictions;

    if (allowUpdate) {
      const newTrees = {};
      // Assign new ids for all nodes and trees to avoid duplicates
      let newTreeId = getMaximumTreeId(skeletonTracing.trees) + 1;
      let newNodeId = getMaximumNodeId(skeletonTracing.trees) + 1;
      for (const treeId of Object.keys(trees)) {
        const tree = trees[Number(treeId)];

        // Create a map from old node ids to new node ids
        const idMap = {};
        const newNodes = new DiffableMap();
        for (const node of tree.nodes.values()) {
          idMap[node.id] = newNodeId;
          newNodes.mutableSet(newNodeId, update(node, { id: { $set: newNodeId } }));
          newNodeId++;
        }

        const newEdges = EdgeCollection.loadFromArray(
          tree.edges.map(edge => ({
            source: idMap[edge.source],
            target: idMap[edge.target],
          })),
        );

        const newComments = tree.comments.map(comment =>
          update(comment, { nodeId: { $set: idMap[comment.nodeId] } }),
        );

        const newBranchPoints = tree.branchPoints.map(bp =>
          update(bp, { nodeId: { $set: idMap[bp.nodeId] } }),
        );

        newTrees[newTreeId] = update(tree, {
          treeId: { $set: newTreeId },
          nodes: { $set: newNodes },
          edges: { $set: newEdges },
          comments: { $set: newComments },
          branchPoints: { $set: newBranchPoints },
        });
        newTreeId++;
      }
      return Maybe.Just(newTrees);
    }
    return Maybe.Nothing();
  });
}

export function deleteTree(
  state: OxalisState,
  tree: TreeType,
  timestamp: number,
): Maybe<[TreeMapType, number, ?number, number]> {
  return getSkeletonTracing(state.tracing).chain(skeletonTracing => {
    const { allowUpdate } = skeletonTracing.restrictions;

    if (allowUpdate) {
      // Delete tree
      let newTrees = _.omit(skeletonTracing.trees, tree.treeId.toString());

      // Because we always want an active tree, check if we need
      // to create one.
      let newActiveTreeId;
      let newActiveNodeId;
      if (_.size(newTrees) === 0) {
        const newTree = createTree(state, timestamp).get();
        newTrees = update(newTrees, { [newTree.treeId]: { $set: newTree } });

        newActiveTreeId = newTree.treeId;
        newActiveNodeId = null;
      } else {
        // just set the last tree to be the active one
        const maxTreeId = getMaximumTreeId(newTrees);
        newActiveTreeId = maxTreeId;
        // Object.keys returns strings and the newActiveNodeId should be an integer
        newActiveNodeId = +_.first(Array.from(newTrees[maxTreeId].nodes.keys())) || null;
      }
      const newMaxNodeId = getMaximumNodeId(newTrees);

      return Maybe.Just([newTrees, newActiveTreeId, newActiveNodeId, newMaxNodeId]);
    }
    return Maybe.Nothing();
  });
}

export function mergeTrees(
  skeletonTracing: SkeletonTracingType,
  sourceNodeId: number,
  targetNodeId: number,
): Maybe<[TreeType, number, number]> {
  const { allowUpdate } = skeletonTracing.restrictions;
  const { trees } = skeletonTracing;
  const sourceTree = findTreeByNodeId(trees, sourceNodeId).get();
  const targetTree = findTreeByNodeId(trees, targetNodeId).get(); // should be activeTree

  if (allowUpdate && sourceTree != null && targetTree != null && sourceTree !== targetTree) {
    const newEdge: EdgeType = {
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
  skeletonTracing: SkeletonTracingType,
  tree: TreeType,
): Maybe<[TreeType, number]> {
  const randomId = _.random(0, 10000, false);
  // ColorGenerator fails to produce distinct color for huge ids (Infinity)
  const newTree = update(tree, { color: { $set: ColorGenerator.distinctColorForId(randomId) } });
  return Maybe.Just([newTree, tree.treeId]);
}

export function createComment(
  skeletonTracing: SkeletonTracingType,
  tree: TreeType,
  node: NodeType,
  commentText: string,
): Maybe<Array<CommentType>> {
  const { allowUpdate } = skeletonTracing.restrictions;

  if (allowUpdate) {
    // Gather all comments other than the activeNode's comments
    const comments = tree.comments;
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
  skeletonTracing: SkeletonTracingType,
  tree: TreeType,
  node: NodeType,
): Maybe<Array<CommentType>> {
  const { allowUpdate } = skeletonTracing.restrictions;

  if (allowUpdate) {
    const comments = tree.comments;
    const commentsWithoutActiveNodeComment = comments.filter(comment => comment.nodeId !== node.id);

    return Maybe.Just(commentsWithoutActiveNodeComment);
  }
  return Maybe.Nothing();
}

export function toggleAllTreesReducer(
  state: OxalisState,
  skeletonTracing: SkeletonTracingType,
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
      trees: updateTreeObject,
    },
  });
}
