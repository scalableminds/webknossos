/**
 * foo.js
 * @flow
 */

import _ from "lodash";
import Maybe from "data.maybe";
import app from "app";
import scaleInfo from "oxalis/model/scaleInfo";
import ColorGenerator from "libs/color_generator";
import Toast from "libs/toast";
import Utils from "libs/utils";
import type { Vector3 } from "oxalis/constants";
import type { TreeType, NodeType, EdgeType, SkeletonTracingType } from "oxalis/store";

function moveNodesToNewTree(trees, nodeId) {

}

function generateTreeNamePrefix(skeletonTracing) {
  const { tracingType, taskId } = skeletonTracing;
  let user = `${app.currentUser.firstName}_${app.currentUser.lastName}`;

  // Replace spaces in user names
  user = user.replace(/ /g, "_");
  if (tracingType === "Explorational") {
    // Get YYYY-MM-DD string
    const creationDate = new Date().toJSON().slice(0, 10);
    return `explorative_${creationDate}_${user}_`;
  } else {
    return `task_${taskId}_${user}_`;
  }
}

function getNewTreeColor(id) {
  return ColorGenerator.distinctColorForId(id);
}

export function createNode(skeletonTracing: SkeletonTracingType, position: Vector3, rotation: Vector3): Maybe<[NodeType, EdgeType]> {
  const { updateAllowed } = skeletonTracing.restrictions;
  const { activeTreeId, activeNodeId } = skeletonTracing;

  if (updateAllowed) {
    const defaultRadius = 10 * scaleInfo.baseVoxel;
    const radius = skeletonTracing.trees[activeTreeId].nodes[activeNodeId].radius || defaultRadius;
    const nextNewId = Math.max(_.keys(skeletonTracing.trees[activeTreeId].nodes)) + 1;

    // Create the new node
    const node: NodeType = {
      position,
      radius,
      rotation,
      id: nextNewId,
      timestamp: Date.now(),
    };

    // Create a new edge
    const edges = skeletonTracing.trees[activeTreeId].edges;
    const newEdge: EdgeType = {
      source: activeNodeId,
      target: nextNewId,
    };
    edges.push(newEdge);

    return Maybe.Just([node, edges]);
  }
  return Maybe.Nothing();
}

export function deleteNode(skeletonTracing: SkeletonTracingType): Maybe<[Array<TreeType>, number, number]> {
  const { updateAllowed } = skeletonTracing.restrictions;
  const { activeNodeId, activeTreeId, trees } = skeletonTracing;

  if (updateAllowed && activeNodeId > 1) {

    let newActiveNodeId;
    let newActiveTreeId;

    // Delete Node
    const activeTree = skeletonTracing[activeTreeId];
    delete activeTree.nodes[activeNodeId];

    // Do we need to split trees? Are there edges leading to/from it?
    const sourceNodeIds = activeTree.edges.map((edge) => { if (edge.from === activeNodeId) return edge.to; });
    const targetNodeIds = activeTree.edges.map((edge) => { if (edge.to === activeNodeId) return edge.from; });

    if (sourceNodeIds && targetNodeIds) {
      const newTrees = sourceNodeIds.map(nodeId => moveNodesToNewTree(nodeId)) +
        targetNodeIds.map(nodeId => moveNodesToNewTree(nodeId));

      // Delete current tree
      delete skeletonTracing[activeTreeId];
      // Set the newly split ones
      newTrees.forEach(tree => trees[tree.treeId] = tree);

      newActiveNodeId = newTrees[-1].nodes[0];
      newActiveTreeId = newTrees[-1].treeId;

    } else {
      // We do not need to split
      // just delete all edges leading to/from it
      const newEdges = activeTree.edges.filter(edge => edge.from !== activeNodeId || edge.source !== activeNodeId);
      activeTree.edge = newEdges;

      // Delete all comments containing the node
      const newComments = activeTree.comments.filter(comment => comment.id !== activeNodeId);
      activeTree.comments = newComments;

      newActiveNodeId = activeNodeId;
      newActiveTreeId = activeTreeId;
    }

    return Maybe.Just([trees, newActiveNodeId, newActiveTreeId]);
  }
  Toast.error("Unable: Attempting to delete first node");
  return Maybe.Nothing();
}

export function createBranchPoint(skeletonTracing: SkeletonTracingType): Maybe {
  const { branchPointsAllowed, updateAllowed } = skeletonTracing.restrictions;
  const { activeNodeId } = skeletonTracing;

  if (branchPointsAllowed && updateAllowed && activeNodeId) {
    // create new branchpoint
    return Maybe.Just({
      id: activeNodeId,
      timestamp: Date.now(),
    });
  }
  return Maybe.Nothing();
}

export function deleteBranchPoint(skeletonTracing: SkeletonTracingType): Maybe<[Object, number, number]> {
  const { branchPointsAllowed, updateAllowed } = skeletonTracing.restrictions;
  const { trees } = skeletonTracing;

  if (branchPointsAllowed && updateAllowed) {
    // Find most recent branchpoint across all trees
    const treeId = _.maxBy(trees, tree => tree.branchPoints[-1].timestamp).treeId;
    const nodeId = trees[treeId].branchPoints[-1].id;

    // Delete branchpoint
    const branchPoints = skeletonTracing.trees[treeId].nodes[nodeId].branchPoints;
    const branchPoint = branchPoints.pop();

    return Maybe.Just([branchPoints, treeId, branchPoint.id]);
  }
  return Maybe.Nothing();
}

export function createTree(skeletonTracing: SkeletonTracingType): Maybe<TreeType> {
  const { updateAllowed } = skeletonTracing.restrictions;

  if (updateAllowed) {
    const newTreeId = Math.max(_.keys(skeletonTracing.trees)) + 1;
    const name = generateTreeNamePrefix(skeletonTracing) + Utils.zeroPad(this.newTreeId, 2);

    const tree: TreeType = {
      name,
      treeId: newTreeId,
      nodes: [],
      timestamp: Date.now(),
      color: getNewTreeColor(newTreeId),
      comments: [],
    };

    return Maybe.Just(tree);
  }
  return Maybe.Nothing();
}

export function deleteTree(skeletonTracing: SkeletonTracingType): Maybe<[Array<TreeType>, number, number]> {
  const { updateAllowed } = skeletonTracing.restrictions;
  const userConfirmation = confirm("Do you really want to delete the whole tree?");

  if (updateAllowed && userConfirmation) {
    // Delete tree
    const trees = skeletonTracing.trees;
    delete trees[skeletonTracing.activeTreeId];

    // Because we always want an active tree, check if we need
    // to create one.
    let newActiveTreeId;
    let newActiveNodeId;
    if (trees.length === 0) {
      const newTree = createTree(skeletonTracing).get();
      trees.push(newTree);

      newActiveTreeId = newTree.treeId;
      newActiveNodeId = null;
    } else {
      // just set the last tree to be the active one
      newActiveTreeId = trees[-1].treeId;
      newActiveNodeId = trees[-1].nodes[0];
    }

    return Maybe.Just([trees, newActiveNodeId, newActiveTreeId]);
  }
  return Maybe.Nothing();
}

