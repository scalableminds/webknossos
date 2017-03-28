/**
 * skeletontracing_reducer_helpers.js
 * @flow
 *
 * THESE HELPERFUNCTIONS MUST ONLY BE CALLED FROM A REDUCER
 *
 */

import _ from "lodash";
import Maybe from "data.maybe";
import app from "app";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import ColorGenerator from "libs/color_generator";
import update from "immutability-helper";
import Utils from "libs/utils";
import type { Vector3 } from "oxalis/constants";
import type { OxalisState, SkeletonTracingType, EdgeType, NodeType, TreeType, BranchPointType, TreeMapType, CommentType } from "oxalis/store";
import { getSkeletonTracing, getActiveNodeFromTree, findTreeByNodeId } from "oxalis/model/accessors/skeletontracing_accessor";

function generateTreeNamePrefix(state: OxalisState, timestamp) {
  let user = `${app.currentUser.firstName}_${app.currentUser.lastName}`;

  // Replace spaces in user names
  user = user.replace(/ /g, "_");
  if (state.tracing.tracingType === "Explorational" || !state.task) {
    // Get YYYY-MM-DD string
    const creationDate = new Date(timestamp).toJSON().slice(0, 10);
    return `explorative_${creationDate}_${user}_`;
  } else {
    return `task_${state.task.taskId}_${user}_`;
  }
}

export function createNode(skeletonTracing: SkeletonTracingType, datasetScale: Vector3, tree: TreeType, position: Vector3, rotation: Vector3, viewport: number, resolution: number, timestamp: number): Maybe<[NodeType, Array<EdgeType>]> {
  const { allowUpdate } = skeletonTracing.restrictions;
  const activeNodeMaybe = getActiveNodeFromTree(skeletonTracing, tree);

  if (allowUpdate) {
    // Use the same radius as current active node or revert to default value
    const defaultRadius = 10 * getBaseVoxel(datasetScale);
    const radius = activeNodeMaybe.map(activeNode => activeNode.radius).getOrElse(defaultRadius);

    // Find new node id by increasing the max node id.
    // Default to 0 if there are no nodes yet
    const maxNodeId = _.max(_.flatMap(skeletonTracing.trees, __ => _.map(__.nodes, node => node.id)));
    const nextNewId = _.isNumber(maxNodeId) ? maxNodeId + 1 : 0;

    // Create the new node
    const node: NodeType = {
      position,
      radius,
      rotation,
      viewport,
      resolution,
      id: nextNewId,
      timestamp,
      bitDepth: 8, // datasetConfig.fourBit ? 4 : 8,
      interpolation: true, // datasetConfig.interpolation,
    };

    // Create a new edge
    const newEdges = activeNodeMaybe.map(activeNode => [{
      source: activeNode.id,
      target: nextNewId,
    }]).getOrElse([]);
    const edges = tree.edges.concat(newEdges);

    return Maybe.Just([node, edges]);
  }
  return Maybe.Nothing();
}

export function deleteNode(state: OxalisState, tree: TreeType, node: NodeType, timestamp: number): Maybe<[TreeMapType, number, ?number]> {
  return getSkeletonTracing(state.tracing).chain((skeletonTracing) => {
    const { allowUpdate } = skeletonTracing.restrictions;

    if (allowUpdate) {
      let newActiveNodeId = node.id;
      let newActiveTreeId = tree.treeId;
      let newTrees = skeletonTracing.trees;

      // Delete Node
      const activeTree = update(tree, { nodes: { $set: _.omit(tree.nodes, [node.id.toString()]) } });

      // Do we need to split trees? Are there edges leading to/from it?
      const sourceNodeIds = activeTree.edges.filter(edge => edge.target === node.id).map(edge => edge.source);
      const targetNodeIds = activeTree.edges.filter(edge => edge.source === node.id).map(edge => edge.target);
      const neighborIds = sourceNodeIds.concat(targetNodeIds);

      if (neighborIds.length === 0) {
        return deleteTree(state, activeTree, timestamp);
      } else {
        // Use split-algorithmus. If we delete a node which is only connected via one edge,
        // this algorithmus will only produce one tree (which reuses the old oen)

        // Build a hashmap which contains for each node all edges leading/leaving into/from the node
        const nodeToEdgesMap: {[number]: Array<EdgeType>} = {};
        activeTree.edges.forEach((edge) => {
          if (nodeToEdgesMap[edge.source]) {
            nodeToEdgesMap[edge.source].push(edge);
          } else {
            nodeToEdgesMap[edge.source] = [edge];
          }
          if (nodeToEdgesMap[edge.target]) {
            nodeToEdgesMap[edge.target].push(edge);
          } else {
            nodeToEdgesMap[edge.target] = [edge];
          }
        });

        // Traverse from active node in all directions (i.e., use each edge) and
        // remember which edges were already visited
        const deletedEdges = nodeToEdgesMap[node.id];
        const visitedEdges = {};
        const getEdgeHash = edge => `${edge.source}-${edge.target}`;

        // Mark edges of deleted node as visited
        deletedEdges.forEach((deletedEdge) => {
          visitedEdges[getEdgeHash(deletedEdge)] = true;
        });

        const traverseTree = (nodeId: number, newTree: TreeType) => {
          const edges = nodeToEdgesMap[nodeId];

          if (nodeId !== node.id) {
            newTree.nodes[nodeId] = activeTree.nodes[nodeId];
          }
          for (const edge of edges) {
            const edgeHash = getEdgeHash(edge);
            if (visitedEdges[edgeHash]) {
              continue;
            }
            visitedEdges[edgeHash] = true;
            newTree.edges.push(edge);

            traverseTree(edge.source, newTree);
            traverseTree(edge.target, newTree);
          }
        };

        // The intermediateState is used for the createTree function, which takes
        // care of generating non-colliding tree names, ids and colors
        let intermediateState = state;
        // For each edge of the to-be-deleted node, create a new tree.
        const cutTrees = deletedEdges.map((edgeOfActiveNode, edgeIndex) => {
          let newTree;
          if (edgeIndex === 0) {
            // Reuse the first tree
            newTree = {
              branchPoints: [],
              color: activeTree.color,
              comments: [],
              edges: [],
              name: activeTree.name,
              nodes: {},
              timestamp: activeTree.timestamp,
              treeId: activeTree.treeId,
            };
          } else {
            newTree = createTree(intermediateState, timestamp).get();
            intermediateState = update(intermediateState, { tracing: { trees: { [newTree.treeId]: { $set: newTree } } } });
          }

          const neighborId = node.id !== edgeOfActiveNode.source
            ? edgeOfActiveNode.source
            : edgeOfActiveNode.target;

          if (newActiveNodeId != null) {
            // Use a neighbor of the deleted node as the new active node
            newActiveNodeId = neighborId;
          }
          traverseTree(neighborId, newTree);
          return newTree;
        });

        // Write branchpoints into correct trees
        activeTree.branchPoints.forEach((branchpoint) => {
          cutTrees.forEach((newTree) => {
            if (newTree.nodes[branchpoint.id]) {
              newTree.branchPoints.push(branchpoint);
            }
          });
        });

        // Write comments into correct trees
        activeTree.comments.forEach((comment) => {
          cutTrees.forEach((newTree) => {
            if (newTree.nodes[comment.node]) {
              newTree.comments.push(comment);
            }
          });
        });

        newTrees = skeletonTracing.trees;
        cutTrees.forEach((cutTree) => {
          newTrees = update(newTrees, { [cutTree.treeId]: { $set: cutTree } });
        });
        // newActiveNodeId was already written to when traversing the tree. Find the
        // corresponding treeId
        const newActiveTree = findTreeByNodeId(newTrees, newActiveNodeId).get();
        newActiveTreeId = newActiveTree.treeId;
      }

      return Maybe.Just([newTrees, newActiveTreeId, newActiveNodeId]);
    } else {
      return Maybe.Nothing();
    }
  });
}

export function createBranchPoint(skeletonTracing: SkeletonTracingType, tree: TreeType, node: NodeType, timestamp: number): Maybe<BranchPointType> {
  const { branchPointsAllowed, allowUpdate } = skeletonTracing.restrictions;

  if (branchPointsAllowed && allowUpdate) {
    const doesBranchPointExistAlready = _.some(tree.branchPoints, branchPoint => branchPoint.id === node.id);

    if (!doesBranchPointExistAlready) {
      // create new branchpoint
      return Maybe.Just({
        id: node.id,
        timestamp,
      });
    }
  }
  return Maybe.Nothing();
}

export function deleteBranchPoint(skeletonTracing: SkeletonTracingType): Maybe<[Array<BranchPointType>, number, number]> {
  const { branchPointsAllowed, allowUpdate } = skeletonTracing.restrictions;
  const { trees } = skeletonTracing;
  const hasBranchPoints = _.some(_.map(trees, __ => !_.isEmpty(__.branchPoints)));

  if (branchPointsAllowed && allowUpdate && hasBranchPoints) {
    // Find most recent branchpoint across all trees
    const treesWithBranchPoints = _.values(trees).filter(tree => !_.isEmpty(tree.branchPoints));
    const treeId = _.maxBy(treesWithBranchPoints, tree => _.last(tree.branchPoints).timestamp).treeId;
    const branchPoint = _.last(trees[treeId].branchPoints);

    if (branchPoint) {
      // Delete branchpoint
      const newBranchPoints = _.without(skeletonTracing.trees[treeId].branchPoints, branchPoint);
      return Maybe.Just([newBranchPoints, treeId, branchPoint.id]);
    }
  }
  return Maybe.Nothing();
}

export function createTree(state: OxalisState, timestamp: number): Maybe<TreeType> {
  return getSkeletonTracing(state.tracing).chain((skeletonTracing) => {
    const { allowUpdate } = skeletonTracing.restrictions;

    if (allowUpdate) {
      // create a new tree id and name
      // tree id can become 0 after deleting all trees
      const maxTreeId = _.max(_.map(skeletonTracing.trees, "treeId"));
      const newTreeId = _.isNumber(maxTreeId) ? maxTreeId + 1 : 0;

      const name = generateTreeNamePrefix(state, timestamp) + Utils.zeroPad(newTreeId, 2);

      // Create the new tree
      const tree: TreeType = {
        name,
        treeId: newTreeId,
        nodes: {},
        timestamp,
        color: ColorGenerator.distinctColorForId(newTreeId),
        branchPoints: [],
        edges: [],
        comments: [],
      };
      return Maybe.Just(tree);
    }
    return Maybe.Nothing();
  });
}

export function deleteTree(state: OxalisState, tree: TreeType, timestamp: number): Maybe<[TreeMapType, number, ?number]> {
  return getSkeletonTracing(state.tracing).chain((skeletonTracing) => {
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
        const maxTreeId = _.max(_.map(newTrees, "treeId"));
        newActiveTreeId = maxTreeId;
        newActiveNodeId = _.first(Object.keys(newTrees[maxTreeId].nodes)) || null;
      }

      return Maybe.Just([newTrees, newActiveTreeId, newActiveNodeId]);
    }
    return Maybe.Nothing();
  });
}

export function mergeTrees(skeletonTracing: SkeletonTracingType, sourceNodeId: number, targetNodeId: number): Maybe<[TreeType, number, number]> {
  const { allowUpdate } = skeletonTracing.restrictions;
  const { trees } = skeletonTracing;
  const sourceTree = findTreeByNodeId(trees, sourceNodeId).get();
  const targetTree = findTreeByNodeId(trees, targetNodeId).get(); // should be activeTree

  if (allowUpdate && sourceTree && targetTree) {
    const newEdge: EdgeType = {
      source: sourceNodeId,
      target: targetNodeId,
    };

    let newTrees = _.omit(trees, sourceTree.treeId.toString());
    newTrees = update(newTrees, { [targetTree.treeId]: {
      nodes: { $set: Object.assign({}, targetTree.nodes, sourceTree.nodes) },
      edges: { $set: targetTree.edges.concat(sourceTree.edges).concat([newEdge]) },
      comments: { $set: targetTree.comments.concat(sourceTree.comments) },
      branchPoints: { $set: targetTree.branchPoints.concat(sourceTree.branchPoints) },
    } });
    return Maybe.Just([newTrees, targetTree.treeId, targetNodeId]);
  }
  return Maybe.Nothing();
}

export function shuffleTreeColor(skeletonTracing: SkeletonTracingType, tree: TreeType): Maybe<[TreeType, number]> {
  const randomId = _.random(0, 10000, false);
  // ColorGenerator fails to produce distinct color for huge ids (Infinity)
  const newTree = update(tree, { color: { $set: ColorGenerator.distinctColorForId(randomId) } });
  return Maybe.Just([newTree, tree.treeId]);
}

export function createComment(skeletonTracing: SkeletonTracingType, tree: TreeType, node: NodeType, commentText: string): Maybe<Array<CommentType>> {
  const { allowUpdate } = skeletonTracing.restrictions;

  if (allowUpdate) {
    // Gather all comments other than the activeNode's comments
    const comments = tree.comments;
    const commentsWithoutActiveNodeComment = comments.filter(comment => comment.node !== node.id);

    const newComment: CommentType = {
      node: node.id,
      content: commentText,
    };

    const newComments = commentsWithoutActiveNodeComment.concat([newComment]);
    return Maybe.Just(newComments);
  }

  return Maybe.Nothing();
}

export function deleteComment(skeletonTracing: SkeletonTracingType, tree: TreeType, node: NodeType): Maybe<Array<CommentType>> {
  const { allowUpdate } = skeletonTracing.restrictions;

  if (allowUpdate) {
    const comments = tree.comments;
    const commentsWithoutActiveNodeComment = comments.filter(comment => comment.node !== node.id);

    return Maybe.Just(commentsWithoutActiveNodeComment);
  }
  return Maybe.Nothing();
}
