/**
 * skeleton.js
 * @flow
 */

import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import Store from "oxalis/throttled_store";
import Model from "oxalis/model";
import { OrthoViews } from "oxalis/constants";
import type { Vector3, OrthoViewType } from "oxalis/constants";
import TreeGeometry from "oxalis/geometries/tree_geometry";

class Skeleton {
  // This class is supposed to collect all the Geometries that belong to the skeleton, like
  // nodes, edges and trees

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  trigger: Function;

  model: Model;
  isVisible: boolean;
  treeGeometryCache: {[id:number]: TreeGeometry};
  showInactiveTrees: boolean;


  constructor(model: Model) {
    this.model = model;
    _.extend(this, Backbone.Events);

    this.treeGeometryCache = {};
    this.isVisible = true;

    this.showInactiveTrees = true;

    // this.reset();

    // Potentially quite ressource intensive
    // Test this some more
    // Perhaps load can be eased a bit with ThreeJS-React wrappers?
    Store.subscribe(() => this.reset());
  }

  createNewTree(treeId: number, treeColor: Vector3): TreeGeometry {
    const tree = new TreeGeometry(treeId, treeColor, this.model);
    tree.showRadius(!Store.getState().userConfiguration.overrideNodeRadius);
    this.treeGeometryCache[treeId] = tree;
    this.trigger("newGeometries", tree.getMeshes());

    return tree;
  }

  evictFromCache = _.throttle(() => {
    const treeIds = Object.keys(Store.getState().skeletonTracing.trees);

    // actually free the buffers etc. from the GPU
    _.values(_.omit(this.treeGeometryCache, treeIds)).forEach((treeGeometry) => {
      this.trigger("removeGeometries", treeGeometry.getMeshes());
      treeGeometry.dispose();
    });

    // remove geometry from cache
    this.treeGeometryCache = _.pick(this.treeGeometryCache, treeIds);
  }, 500)

  reset() {
    const trees = _.values(Store.getState().skeletonTracing.trees);

    // periodically evict unused tree geometries left over after tree deletion/splitting
    this.evictFromCache();

    for (const tree of trees) {
      let treeGeometry = this.getTreeGeometry(tree.treeId);
      if (!treeGeometry) {
        treeGeometry = this.createNewTree(tree.treeId, tree.color);
      }
      treeGeometry.reset(tree.nodes, tree.edges);

      for (const branchpoint of tree.branchPoints) {
        treeGeometry.updateNodeColor(branchpoint.id, null, true);
      }
    }
    app.vent.trigger("rerender");
  }

  getMeshes = () => {
    let meshes = [];
    for (const tree of _.values(this.treeGeometryCache)) {
      meshes = meshes.concat(tree.getMeshes());
    }
    return meshes;
  }

  getTreeGeometry(treeId: ?number) {
    if (!treeId) {
      treeId = Store.getState().skeletonTracing.activeTreeId;
    }
    if (treeId != null) {
      return this.treeGeometryCache[treeId];
    }
    return null;
  }


  setVisibilityTemporary(isVisible: boolean) {
    for (const mesh of this.getMeshes()) {
      mesh.visible = isVisible && ((mesh.isVisible != null) ? mesh.isVisible : true);
    }
    app.vent.trigger("rerender");
  }


  setVisibility(isVisible: boolean) {
    this.isVisible = isVisible;

    for (const mesh of this.getMeshes()) {
      mesh.isVisible = isVisible;
    }
    app.vent.trigger("rerender");
  }


  restoreVisibility() {
    this.setVisibilityTemporary(this.isVisible);
  }


  toggleVisibility() {
    this.setVisibility(!this.isVisible);
  }


  updateForCam(id: OrthoViewType) {
    for (const tree of _.values(this.treeGeometryCache)) {
      tree.showRadius(id !== OrthoViews.TDView && !Store.getState().userConfiguration.overrideNodeRadius);
    }

    if (id !== OrthoViews.TDView) {
      this.setVisibilityTemporary(this.isVisible);
    }
    this.setVisibilityTemporary(true);
  }


  toggleInactiveTreeVisibility() {
    this.showInactiveTrees = !this.showInactiveTrees;
    return this.setInactiveTreeVisibility(this.showInactiveTrees);
  }


  setInactiveTreeVisibility(visible: boolean) {
    for (const mesh of this.getMeshes()) {
      mesh.isVisible = visible;
    }
    const treeGeometry = this.getTreeGeometry(Store.getState().skeletonTracing.activeTreeId);
    if (treeGeometry != null) {
      treeGeometry.edges.isVisible = true;
      treeGeometry.nodes.isVisible = true;
      app.vent.trigger("rerender");
    }
  }

  getAllNodes() {
    return _.map(this.treeGeometryCache, tree => tree.nodes);
  }

  setSizeAttenuation(sizeAttenuation: boolean) {
    return _.map(this.treeGeometryCache, tree =>
      tree.setSizeAttenuation(sizeAttenuation));
  }
}

export default Skeleton;
