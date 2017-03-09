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
import scaleInfo from "oxalis/model/scaleinfo";
import ColorGenerator from "libs/color_generator";
import Utils from "libs/utils";
import Window from "libs/window";
import type { Vector3 } from "oxalis/constants";
import type { SkeletonTracingType, EdgeType, NodeType, TreeType, BranchPointType, TreeMapType, CommentType } from "oxalis/store";

function moveNodesToNewTree(trees: TreeMapType, nodeId: number): TreeMapType {
  // TODO
  return trees;
}

export function findTree(trees: TreeMapType, nodeId: number): ?TreeType {
  return _.values(trees)
    .filter(tree => _.map(tree.nodes, "id").includes(nodeId))[0];
}

function generateTreeNamePrefix(skeletonTracing, timestamp) {
  const { contentType, taskId } = skeletonTracing;
  let user = `${app.currentUser.firstName}_${app.currentUser.lastName}`;

  // Replace spaces in user names
  user = user.replace(/ /g, "_");
  if (contentType === "Explorational") {
    // Get YYYY-MM-DD string
    const creationDate = new Date(timestamp).toJSON().slice(0, 10);
    return `explorative_${creationDate}_${user}_`;
  } else {
    return `task_${taskId}_${user}_`;
  }
}

export function createNode(skeletonTracing: SkeletonTracingType, position: Vector3, rotation: Vector3, viewport: number, resolution: number, timestamp: number): Maybe<[NodeType, Array<EdgeType>]> {
  const { allowUpdate } = skeletonTracing.restrictions;
  const { activeTreeId, activeNodeId } = skeletonTracing;

  if (allowUpdate) {
    // Use the same radius as current active node or revert to default value
    const defaultRadius = 10 * scaleInfo.baseVoxel;
    const radius = activeNodeId ? skeletonTracing.trees[activeTreeId].nodes[activeNodeId].radius : defaultRadius;

    // Find new node id by increasing the max node id.
    // Default to 0 if there are no nodes yet
    const maxNodeId = _.max(_.flatMap(skeletonTracing.trees, tree => _.map(tree.nodes, node => node.id)));
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
      //bitDepth: datasetConfig.fourBit ? 4 : 8,
      //interpolation: datasetConfig.interpolation,
    };

    // Create a new edge
    const newEdges = [];
    if (_.isNumber(activeNodeId)) {
      const newEdge: EdgeType = {
        source: activeNodeId,
        target: nextNewId,
      };
      newEdges.push(newEdge);
    }
    const edges = skeletonTracing.trees[activeTreeId].edges.concat(newEdges);

    return Maybe.Just([node, edges]);
  }
  return Maybe.Nothing();
}

export function deleteNode(skeletonTracing: SkeletonTracingType): Maybe<[TreeMapType, number, number]> {
  const { allowUpdate } = skeletonTracing.restrictions;
  const { activeNodeId, activeTreeId } = skeletonTracing;

  if (allowUpdate && _.isNumber(activeNodeId)) {
    let newActiveNodeId;
    let newActiveTreeId;
    let newTrees;

    // Delete Node
    const activeTree = skeletonTracing.trees[activeTreeId];
    delete activeTree.nodes[activeNodeId];

    // Do we need to split trees? Are there edges leading to/from it?
    const sourceNodeIds = activeTree.edges.reduce((result, edge) => { if (edge.target === activeNodeId) result.push(edge.source); return result; }, []);
    const targetNodeIds = activeTree.edges.reduce((result, edge) => { if (edge.source === activeNodeId) result.push(edge.target); return result; }, []);

    if (_.isEmpty(sourceNodeIds) || _.isEmpty(targetNodeIds)) {
      // We do not need to split
      // just delete all edges leading to/from it
      const newEdges = activeTree.edges.filter(edge => edge.source !== activeNodeId && edge.target !== activeNodeId);
      activeTree.edges = newEdges;

      // Delete all comments containing the node
      const newComments = activeTree.comments.filter(comment => comment.node !== activeNodeId);
      activeTree.comments = newComments;

      // Decrease active node id or reset to null
      newActiveNodeId = activeNodeId === 0 ? null : activeNodeId - 1;
      newActiveTreeId = activeTreeId;
      newTrees = skeletonTracing.trees;
    } else {
      // Split the tree
      throw Error("TODO @ philipp");
    }

    return Maybe.Just([newTrees, newActiveNodeId, newActiveTreeId]);
  }
  return Maybe.Nothing();
}

export function createBranchPoint(skeletonTracing: SkeletonTracingType, timestamp: number): Maybe<BranchPointType> {
  const { branchPointsAllowed, allowUpdate } = skeletonTracing.restrictions;
  const { activeNodeId, activeTreeId } = skeletonTracing;

  if (branchPointsAllowed && allowUpdate && _.isNumber(activeNodeId)) {
    const doesBranchPointExistAlready = _.some(skeletonTracing.trees[activeTreeId].branchPoints, branchPoint => branchPoint.id === activeNodeId);

    if (!doesBranchPointExistAlready) {
      // create new branchpoint
      return Maybe.Just({
        id: activeNodeId,
        timestamp,
      });
    }
  }
  return Maybe.Nothing();
}

export function deleteBranchPoint(skeletonTracing: SkeletonTracingType): Maybe<[Array<BranchPointType>, number, number]> {
  const { branchPointsAllowed, allowUpdate } = skeletonTracing.restrictions;
  const { trees } = skeletonTracing;
  const hasBranchPoints = _.some(_.map(trees, tree => !_.isEmpty(tree.branchPoints)));

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

export function createTree(skeletonTracing: SkeletonTracingType, timestamp: number): Maybe<TreeType> {
  const { allowUpdate } = skeletonTracing.restrictions;

  if (allowUpdate) {
    // create a new tree id and name
    // tree id can become 0 after deleting all trees
    const maxTreeId = _.max(_.map(skeletonTracing.trees, "treeId"));
    const newTreeId = _.isNumber(maxTreeId) ? maxTreeId + 1 : 0;

    const name = generateTreeNamePrefix(skeletonTracing, timestamp) + Utils.zeroPad(newTreeId, 2);

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
}

export function deleteTree(skeletonTracing: SkeletonTracingType): Maybe<[TreeMapType, number, ?number]> {
  const { allowUpdate } = skeletonTracing.restrictions;
  const userConfirmation = Window.confirm("Do you really want to delete the whole tree?");

  if (allowUpdate && userConfirmation) {
    // Delete tree
    const newTrees = skeletonTracing.trees;
    delete newTrees[skeletonTracing.activeTreeId];

    // Because we always want an active tree, check if we need
    // to create one.
    let newActiveTreeId;
    let newActiveNodeId;
    if (_.size(newTrees) === 0) {
      const newTree = createTree(skeletonTracing).get();
      newTrees[newTree.treeId] = newTree;

      newActiveTreeId = newTree.treeId;
      newActiveNodeId = null;
    } else {
      // just set the last tree to be the active one
      const maxTreeId = _.max(_.map(newTrees, "treeId"));
      newActiveTreeId = maxTreeId;
      newActiveNodeId = _.get(newTrees[maxTreeId].nodes, "nodes[0].id", null);
    }

    return Maybe.Just([newTrees, newActiveTreeId, newActiveNodeId]);
  }
  return Maybe.Nothing();
}

export function mergeTrees(skeletonTracing: SkeletonTracingType, sourceNodeId: number, targetNodeId: number): Maybe<TreeType> {
  const { allowUpdate } = skeletonTracing.restrictions;
  const { trees } = skeletonTracing;
  const sourceTree = findTree(trees, sourceNodeId);
  const targetTree = findTree(trees, targetNodeId); // should be activeTree

  if (allowUpdate && sourceTree && targetTree) {
    const newTrees = _.omit(trees, sourceTree.treeId.toString());
    newTrees[targetTree.treeId].nodes = Object.assign(targetTree.nodes, sourceTree.nodes);
    newTrees[targetTree.treeId].edges = targetTree.edges.concat(sourceTree.edges);

    const newEdge: EdgeType = {
      source: sourceNodeId,
      target: targetNodeId,
    };
    newTrees[targetTree.treeId].edges.push(newEdge);

    return Maybe.Just(newTrees);
  }
  return Maybe.Nothing();
}

export function shuffleTreeColor(skeletonTracing: SkeletonTracingType, treeId: number): Maybe<[TreeType, number]> {
  const tree = skeletonTracing.trees[treeId];

  if (_.isNumber(treeId) && tree) {
    const randomId = _.random(0, 10000, false);
    // ColorGenerator fails to produce distinct color for huge ids (Infinity)
    tree.color = ColorGenerator.distinctColorForId(randomId);
    return Maybe.Just([tree, treeId]);
  }

  return Maybe.Nothing();
}

export function createComment(skeletonTracing: SkeletonTracingType, commentText: string): Maybe<Array<CommentType>> {
  const { allowUpdate } = skeletonTracing.restrictions;
  const { activeNodeId, activeTreeId, trees } = skeletonTracing;

  if (allowUpdate && _.isNumber(activeNodeId)) {
    // Gather all comments other than the activeNode's comments
    const comments = trees[activeTreeId].comments;
    const commentsWithoutActiveNodeComment = comments.filter(comment => comment.node !== activeNodeId);

    const newComment: CommentType = {
      node: activeNodeId,
      comment: commentText,
    };

    const newComments = commentsWithoutActiveNodeComment.concat([newComment]);
    return Maybe.Just(newComments);
  }

  return Maybe.Nothing();
}

export function deleteComment(skeletonTracing: SkeletonTracingType): Maybe<Array<CommentType>> {
  const { allowUpdate } = skeletonTracing.restrictions;
  const { activeNodeId, activeTreeId, trees } = skeletonTracing;

  if (allowUpdate && _.isNumber(activeNodeId)) {
    const comments = trees[activeTreeId].comments;
    const commentsWithoutActiveNodeComment = comments.filter(comment => comment.node !== activeNodeId);

    return Maybe.Just(commentsWithoutActiveNodeComment);
  }
  return Maybe.Nothing();
}
