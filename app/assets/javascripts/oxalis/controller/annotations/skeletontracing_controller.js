/**
 * skeletontracing_controller.js
 * @flow
 */

import _ from "lodash";
import Backbone from "backbone";
import Store from "oxalis/store";
import constants from "oxalis/constants";
import Model from "oxalis/model";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { setActiveNodeRadiusAction } from "oxalis/model/actions/skeletontracing_actions";
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
    let particleSize = Store.getState().userConfiguration.particleSize + delta;
    particleSize = Math.min(constants.MAX_PARTICLE_SIZE, particleSize);
    particleSize = Math.max(constants.MIN_PARTICLE_SIZE, particleSize);

    Store.dispatch(updateUserSettingAction("particleSize", particleSize));
  }


  setRadius(delta: number): void {
    const radius = Store.getState().skeletonTracing.getActiveNodeRadius();
    Store.dispatch(setActiveNodeRadiusAction(radius * Math.pow(1.05, delta)));
  }


  toggleSkeletonVisibility = (): void => {
    this.sceneController.skeleton.toggleVisibility();
    // Show warning, if this is the first time to use
    // this function for this user
    if (Store.getState().userConfiguration.firstVisToggle) {
      this.skeletonTracingView.showFirstVisToggle();
      Store.dispatch(updateUserSettingAction("firstVisToggle", false));
    }
  }


  centerActiveNode = (): void => {
    const position = Store.getState().skeletonTracing.getActiveNodePos();
    if (position) {
      this.model.flycam.setPosition(position);
    }
  }
}

export default SkeletonTracingController;
