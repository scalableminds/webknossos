/**
 * minimal_skeletontracing_arbitrary_controller.js
 * @flow
 */

import _ from "lodash";
import { InputKeyboard, InputKeyboardNoLoop } from "libs/input";
import Toast from "libs/toast";
import Store from "oxalis/store";
import ArbitraryController from "oxalis/controller/viewmodes/arbitrary_controller";
import Constants from "oxalis/constants";
import type Model from "oxalis/model";
import type View from "oxalis/view";
import type SceneController from "oxalis/controller/scene_controller";
import type SkeletonTracingController from "oxalis/controller/annotations/skeletontracing_controller";

class MinimalSkeletonTracingArbitraryController extends ArbitraryController {

  // See comment in Controller class on general controller architecture.
  //
  // Minimal Skeleton Tracing Arbitrary Controller:
  // Extends Arbitrary controller to add controls that are specific to minimal Arbitrary mode.

  constructor(
    model: Model,
    view: View,
    sceneController: SceneController,
    skeletonTracingController: SkeletonTracingController,
  ) {
    super(model, view, sceneController, skeletonTracingController);

    _.defer(() => this.setRecord(true));
  }

  initKeyboard(): void {
    this.input.keyboard = new InputKeyboard({
      space: timeFactor => this.move(timeFactor),
      // Zoom in/out
      i: () => this.cam.zoomIn(),
      o: () => this.cam.zoomOut(),
      // Rotate in distance
      left: (timeFactor) => {
        const rotateValue = Store.getState().userConfiguration.rotateValue;
        this.cam.yaw(rotateValue * timeFactor, this.mode === Constants.MODE_ARBITRARY);
      },
      right: (timeFactor) => {
        const rotateValue = Store.getState().userConfiguration.rotateValue;
        this.cam.yaw(-rotateValue * timeFactor, this.mode === Constants.MODE_ARBITRARY);
      },
      up: (timeFactor) => {
        const rotateValue = Store.getState().userConfiguration.rotateValue;
        this.cam.pitch(-rotateValue * timeFactor, this.mode === Constants.MODE_ARBITRARY);
      },
      down: (timeFactor) => {
        const rotateValue = Store.getState().userConfiguration.rotateValue;
        this.cam.pitch(rotateValue * timeFactor, this.mode === Constants.MODE_ARBITRARY);
      },
    });

    this.input.keyboardNoLoop = new InputKeyboardNoLoop({

      // Branches
      b: () => this.pushBranch(),
      j: () => this.popBranch(),

      // Branchpointvideo
      ".": () => this.nextNode(true),
      ",": () => this.nextNode(false),

    });

    this.input.keyboardOnce = new InputKeyboard({
      // Delete active node and recenter last node
      "shift + space": () => this.deleteActiveNode(),
    }, -1);
  }


  // make sure that it is not possible to keep nodes from being created
  setWaypoint(): void {
    if (this.isBranchpointvideoMode()) { return; }
    if (!this.model.get("flightmodeRecording")) {
      this.model.set("flightmodeRecording", true);
    }
    super.setWaypoint();
  }


  deleteActiveNode(): void {
    if (this.isBranchpointvideoMode()) { return; }
    const { skeletonTracing } = this.model;
    const activeNode = skeletonTracing.getActiveNode();
    if (activeNode.id === 1) {
      Toast.error("Unable: Attempting to delete first node");
    } else {
      _.defer(() => this.model.skeletonTracing.deleteActiveNode().then(() => this.centerActiveNode()));
    }
  }
}


export default MinimalSkeletonTracingArbitraryController;
