/**
 * skeletontracing_controller.js
 * @flow
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

  constructor(
    model: Model,
    skeletonTracingView: SkeletonTracingView,
    sceneController: SceneController,
  ) {
    _.extend(this, Backbone.Events);
    this.model = model;
    this.skeletonTracingView = skeletonTracingView;
    this.sceneController = sceneController;
  }


  setParticleSize = (delta: number): void => {
    let particleSize = this.model.user.get("particleSize") + delta;
    particleSize = Math.min(constants.MAX_PARTICLE_SIZE, particleSize);
    particleSize = Math.max(constants.MIN_PARTICLE_SIZE, particleSize);

    this.model.user.set("particleSize", (Number)(particleSize));
  }


  setRadius(delta: number): void {
    this.model.skeletonTracing.setActiveNodeRadius(
      this.model.skeletonTracing.getActiveNodeRadius() * Math.pow(1.05, delta),
    );
  }


  toggleSkeletonVisibility = (): void => {
    this.sceneController.skeleton.toggleVisibility();
    // Show warning, if this is the first time to use
    // this function for this user
    if (this.model.user.get("firstVisToggle")) {
      this.skeletonTracingView.showFirstVisToggle();
      this.model.user.set("firstVisToggle", false);
      this.model.user.push();
    }
  }


  setActiveNode(nodeId: number, merge: boolean = false, centered: boolean = false): void {
    this.model.skeletonTracing.setActiveNode(nodeId, merge);
    if (centered) {
      this.model.skeletonTracing.centerActiveNode();
    }
  }


  centerActiveNode = (): void => {
    const position = this.model.skeletonTracing.getActiveNodePos();
    if (position) {
      this.model.flycam.setPosition(position);
    }
  }
}

export default SkeletonTracingController;
