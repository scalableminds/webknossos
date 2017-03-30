/**
 * skeleton.js
 * @flow
 */

import _ from "lodash";
import Backbone from "backbone";
import Store from "oxalis/throttled_store";
import Model from "oxalis/model";
import type { SkeletonTracingType } from "oxalis/store";
import { diffTrees } from "oxalis/model/sagas/skeletontracing_saga";
import SkeletonGeometryHandler from "oxalis/geometries/skeleton_geometry_handler";

class Skeleton {
  // This class is supposed to collect all the Geometries that belong to the skeleton, like
  // nodes, edges and trees

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  trigger: Function;

  isVisible: boolean;
  showInactiveTrees: boolean;
  prevTracing: SkeletonTracingType;
  geometryHandler: SkeletonGeometryHandler;

  constructor(model: Model) {
    _.extend(this, Backbone.Events);

    this.isVisible = true;
    this.showInactiveTrees = true;

    const tracing = Store.getState().skeletonTracing;
    this.geometryHandler = new SkeletonGeometryHandler(tracing.trees, model);
    this.prevTracing = tracing;

    Store.subscribe(() => this.update());
  }


  update() {
    const tracing = Store.getState().skeletonTracing;
    const diff = diffTrees(this.prevTracing.trees, tracing.trees);

    for (const update of diff) {
      switch (update.action) {
        case "createNode":
          this.geometryHandler.addNode(update.value);
          break;
        case "removeNode":
          this.geometryHandler.removeNode(update.value);
          break;
        case "createEdge":
          break;
        case "removeEdge":
          break;
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
    /* for (const mesh of this.getMeshes()) {
      mesh.visible = isVisible && ((mesh.isVisible != null) ? mesh.isVisible : true);
    } */
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
    return [];
    // return _.map(this.treeGeometryCache, tree => tree.nodes);
  }


  setSizeAttenuation(/* sizeAttenuation: boolean */) {
    /* return _.map(this.treeGeometryCache, tree =>
      tree.setSizeAttenuation(sizeAttenuation));*/
  }
}

export default Skeleton;
