/**
 * skeletontracing_controller.js
 * @flow weak
 */

import _ from "lodash";
import Backbone from "backbone";
import constants from "oxalis/constants";
import Model from "oxalis/model";
import SkeletonTracingView from "oxalis/view/skeletontracing/skeletontracing_view";
import SceneController from "oxalis/controller/scene_controller";

class SkeletonTracingController {

  // See comment in Controller class on general controller architecture.
  //
  // Skeleton Tracing Controller:
  // Add Skeleton Tracing controls that are not specific to the view mode.
  // Also, this would be the place to define general Skeleton Tracing
  // functions that can be called by the specific view mode controller.

  model: Model;
  skeletonTracingView: SkeletonTracingView;
  sceneController: SceneController;

  constructor(model, skeletonTracingView, sceneController) {
    this.model = model;
    this.skeletonTracingView = skeletonTracingView;
    this.sceneController = sceneController;
    _.extend(this, Backbone.Events);
  }


  setParticleSize = (delta) => {
    let particleSize = this.model.user.get("particleSize") + delta;
    particleSize = Math.min(constants.MAX_PARTICLE_SIZE, particleSize);
    particleSize = Math.max(constants.MIN_PARTICLE_SIZE, particleSize);

    return this.model.user.set("particleSize", (Number)(particleSize));
  }


  setRadius(delta) {
    return this.model.skeletonTracing.setActiveNodeRadius(
      this.model.skeletonTracing.getActiveNodeRadius() * Math.pow(1.05, delta),
    );
  }


  toggleSkeletonVisibility = () => {
    this.sceneController.skeleton.toggleVisibility();
    // Show warning, if this is the first time to use
    // this function for this user
    if (this.model.user.get("firstVisToggle")) {
      this.skeletonTracingView.showFirstVisToggle();
      this.model.user.set("firstVisToggle", false);
      return this.model.user.push();
    }
  }


  setActiveNode(nodeId, merge = false, centered = false) {
    this.model.skeletonTracing.setActiveNode(nodeId, merge);
    if (centered) { return this.model.skeletonTracing.centerActiveNode(); }
  }


  centerActiveNode = () => {
    const position = this.model.skeletonTracing.getActiveNodePos();
    if (position) {
      return this.model.flycam.setPosition(position);
    }
  }
}

export default SkeletonTracingController;
