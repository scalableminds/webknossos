/**
 * skeleton.js
 * @flow
 */

import _ from "lodash";
import Utils from "libs/utils";
import Store from "oxalis/throttled_store";
import type { SkeletonTracingType } from "oxalis/store";
import { diffTrees } from "oxalis/model/sagas/skeletontracing_saga";
import SkeletonGeometryHandler from "oxalis/geometries/skeleton_geometry_handler";
import { NodeTypes } from "oxalis/geometries/materials/particle_material_factory";

class Skeleton {
  // This class is supposed to collect all the Geometries that belong to the skeleton, like
  // nodes, edges and trees

  isVisible: boolean;
  showInactiveTrees: boolean;
  prevTracing: SkeletonTracingType;
  geometryHandler: SkeletonGeometryHandler;

  constructor() {
    this.isVisible = true;
    this.showInactiveTrees = true;

    const tracing = Store.getState().skeletonTracing;
    this.geometryHandler = new SkeletonGeometryHandler(tracing.trees);
    this.prevTracing = tracing;

    Store.subscribe(() => this.update());
  }


  update() {
    const tracing = Store.getState().skeletonTracing;
    const diff = diffTrees(this.prevTracing.trees, tracing.trees);

    for (const update of diff) {
      switch (update.action) {
        case "createNode": {
          const treeColor = tracing.trees[update.value.treeId].color;
          this.geometryHandler.createNode(update.value, treeColor);
          break;
        }
        case "deleteNode":
          this.geometryHandler.deleteNode(update.value.id);
          break;
        case "createEdge": {
          const tree = tracing.trees[update.value.treeId];
          const source = tree.nodes[update.value.source];
          const target = tree.nodes[update.value.target];
          this.geometryHandler.createEdge(source, target);
          break;
        }
        case "deleteEdge":
          this.geometryHandler.deleteEdge(update.value.source, update.value.target);
          break;
        case "updateNode":
          this.geometryHandler.updateNodeScalar("radius", update.value.id, update.value.radius);
          break;
        case "updateTree": {
          // diff branchpoints
          const treeId = update.value.id;
          const tree = tracing.trees[treeId];
          const prevTree = this.prevTracing.trees[treeId];
          const oldBranchPoints = prevTree.branchPoints.map(branchPoint => branchPoint.id);
          const newBranchPoints = tree.branchPoints.map(branchPoint => branchPoint.id);
          const { onlyA: deletedBranchPoints, onlyB: createdBranchPoints } = Utils.diffArrays(oldBranchPoints, newBranchPoints);

          for (const nodeId of deletedBranchPoints) {
            this.geometryHandler.updateNodeScalar("type", nodeId, NodeTypes.NORMAL);
          }

          for (const nodeId of createdBranchPoints) {
            this.geometryHandler.updateNodeScalar("type", nodeId, NodeTypes.BRANCH_POINT);
          }

          if (tree.color !== prevTree.color) {
            for (const node of _.values(tree.nodes)) {
              this.geometryHandler.updateNodeVector("treeColor", node.id, tree.color);
            }
          }
          break;
        }
        default:
      }
    }

    // this.geometryHandler.updateUniforms();
    this.prevTracing = tracing;
  }

  getMeshes = () => this.geometryHandler.getMeshes()

  setVisibility(isVisible: boolean) {
    this.isVisible = isVisible;

    /* for (const mesh of this.getMeshes()) {
      mesh.isVisible = isVisible;
    }
    app.vent.trigger("rerender"); */
  }


  setVisibilityTemporary(/* isVisible: boolean */) {
    // for (const mesh of this.getMeshes()) {
    //   mesh.visible = isVisible && ((mesh.isVisible != null) ? mesh.isVisible : true);
    // }
    // (TODO: still needed?) app.vent.trigger("rerender");
  }


  restoreVisibility() {
//    this.setVisibilityTemporary(this.isVisible);
  }


  toggleVisibility() {
    this.setVisibility(!this.isVisible);
  }


  updateForCam(/* id: OrthoViewType */) {
    /* for (const tree of _.values(this.treeGeometryCache)) {
      //tree.showRadius(id !== OrthoViews.TDView && !Store.getState().userConfiguration.overrideNodeRadius);
    }

    if (id !== OrthoViews.TDView) {
      this.setVisibilityTemporary(this.isVisible);
    }
    this.setVisibilityTemporary(true);*/
  }


  toggleInactiveTreeVisibility() {
    // this.showInactiveTrees = !this.showInactiveTrees;
    // return this.setInactiveTreeVisibility(this.showInactiveTrees);
  }


  setInactiveTreeVisibility(/* isVisible: boolean */) {
    /* for (const mesh of this.getMeshes()) {
      mesh.isVisible = visible;
    }
    const treeGeometry = this.getTreeGeometry(Store.getState().skeletonTracing.activeTreeId);
    if (treeGeometry != null) {
      treeGeometry.edges.isVisible = true;
      treeGeometry.nodes.isVisible = true;
      app.vent.trigger("rerender");
    } */
  }


  getAllNodes() {
    return _.map(this.geometryHandler.nodeGeometries, geometry => geometry.getMesh());
  }


  setSizeAttenuation(/* sizeAttenuation: boolean */) {
    /* return _.map(this.treeGeometryCache, tree =>
      tree.setSizeAttenuation(sizeAttenuation));*/
  }
}

export default Skeleton;
