/*
* traceparser.js
* @flow
*/

import _ from "lodash";
import * as THREE from "three";
import app from "app";
import Toast from "libs/toast";
import TracePoint from "oxalis/model/skeletontracing/tracepoint";
import TraceTree from "oxalis/model/skeletontracing/tracetree";
import type { SkeletonContentDataType, VolumeContentDataType, Tracing } from "oxalis/model";
import SkeletonTracing from "oxalis/model/skeletontracing/skeletontracing";
import RestrictionHandler from "oxalis/model/helpers/restriction_handler";


class TracingParser {

  static buildTrees(data: VolumeContentDataType | SkeletonContentDataType) {
    const trees = [];

    for (const treeData of data.trees) {
      // Create new tree
      const tree = new TraceTree(
        treeData.id,
        this.convertColor(treeData.color),
        treeData.name ? treeData.name : `Tree${(`00${treeData.id}`).slice(-3)}`,
        treeData.timestamp,
        treeData.comments,
        treeData.branchPoints,
      );

      // Initialize nodes
      for (const node of treeData.nodes) {
        tree.nodes.push(
          new TracePoint(
            node.id, node.position, node.radius, treeData.id,
            node.rotation, node.timestamp, node.viewport, node.resolution, node.bitDepth, node.interpolation,
          ),
        );
      }

      // Initialize edges
      for (const edge of treeData.edges) {
        const sourceNode = _.find(tree.nodes, { id: edge.source });
        const targetNode = _.find(tree.nodes, { id: edge.target });
        if (sourceNode && targetNode) {
          sourceNode.appendNext(targetNode);
          targetNode.appendNext(sourceNode);
        } else {
          if (!sourceNode) { Toast.error(`Node with id ${edge.source} doesn't exist. Ignored edge due to missing source node.`); }
          if (!targetNode) { Toast.error(`Node with id ${edge.target} doesn't exist. Ignored edge due to missing target node.`); }
        }
      }

      trees.push(tree);
    }

    return trees;
  }


  static convertColor(colorArray): THREE.Color {
    return new THREE.Color().setRGB(...colorArray).getHex();
  }

  static generateTreeNamePrefix(tracingType: string, taskId: number): string {
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


  static parse(tracing: Tracing): SkeletonTracing {
    if (tracing == null) {
      Error("implement me");
    }

    const skeletonTracing = new SkeletonTracing();
    skeletonTracing.trees = this.buildTrees(tracing.content.contentData);

    for (const tree of skeletonTracing.trees) {
      // idCount should be bigger than any other id
      const maxNodeId = _.maxBy(tree.nodes, "id");
      skeletonTracing.idCount = Math.max(maxNodeId.id + 1, skeletonTracing.idCount);

      // Set active Node
      const activeNodeT = _.find(tree.nodes, { id: tracing.activeNode });
      if (activeNodeT) {
        skeletonTracing.activeNode = activeNodeT;
        // Active Tree is the one last added
        skeletonTracing.activeTree = tree;
      }

      // Initialize tree colors
      if (tree.color == null) {
        skeletonTracing.shuffleTreeColor(tree);
      }

      skeletonTracing.treeIdCount = Math.max(tree.treeId + 1, skeletonTracing.treeIdCount);
      skeletonTracing.colorIdCounter = skeletonTracing.treeIdCount;
    }


    if ((tracing.typ === "Task") && skeletonTracing.getNodeListOfAllTrees().length === 0) {
      skeletonTracing.addNode(tracing.content.editPosition, tracing.content.editRotation, 0, 0, 4, false);
    }

    skeletonTracing.branchPointsAllowed = tracing.content.settings.branchPointsAllowed;
    if (!skeletonTracing.branchPointsAllowed) {
      // calculate direction of first edge in nm
      if (Utils.__guard__(tracing.content.contentData.trees[0], x1 => x1.edges) != null) {
        for (const edge of tracing.content.contentData.trees[0].edges) {
          const sourceNode = _.find(skeletonTracing.trees[0].nodes, { id: edge.source }).position;
          const targetNode = _.find(skeletonTracing.trees[0].nodes, { id: edge.target }).position;
          if (sourceNode[0] !== targetNode[0] || sourceNode[1] !== targetNode[1] || sourceNode[2] !== targetNode[2]) {
            skeletonTracing.firstEdgeDirection = [targetNode[0] - sourceNode[0],
              targetNode[1] - sourceNode[1],
              targetNode[2] - sourceNode[2]];
            break;
          }
        }
      }
    }

    //   if (this.firstEdgeDirection) {
    //     this.flycam.setSpaceDirection(this.firstEdgeDirection);
    //   }
    // }

    if (tracing.activeNode && !skeletonTracing.activeNode) {
      Toast.error(`Node with id ${tracing.activeNode} doesn't exist. Ignored active node.`);
    }

    skeletonTracing.restrictionHandler = new RestrictionHandler(tracing.restrictions);

    // Ensure a tree is active
    if (!skeletonTracing.activeTree) {
      if (skeletonTracing.trees.length > 0) {
        skeletonTracing.activeTree = skeletonTracing.trees[0];
      } else {
        skeletonTracing.createNewTree();
      }
    }


    // Initialize tree name prefix
    skeletonTracing.treePrefix = this.generateTreeNamePrefix(tracing.typ, tracing.taskId);


    return skeletonTracing;
  }
}

export default TracingParser;
