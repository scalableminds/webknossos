/**
 * minimal_skeletontracing_arbitrary_controller.js
 * @flow weak
 */

import _ from "lodash";
import Input from "libs/input";
import Toast from "libs/toast";
import ArbitraryController from "../viewmodes/arbitrary_controller";
import Constants from "../../constants";

class MinimalSkeletonTracingArbitraryController extends ArbitraryController {

  // See comment in Controller class on general controller architecture.
  //
  // Minimal Skeleton Tracing Arbitrary Controller:
  // Extends Arbitrary controller to add controls that are specific to minimal Arbitrary mode.

  constructor(...args) {
    super(...args);
    _.defer(() => this.setRecord(true));
  }


  initKeyboard() {
    this.input.keyboard = new Input.Keyboard({

      space: timeFactor => this.move(timeFactor),

      // Zoom in/out
      i: () => this.cam.zoomIn(),
      o: () => this.cam.zoomOut(),

      // Rotate in distance
      left: timeFactor => this.cam.yaw(this.model.user.get("rotateValue") * timeFactor, this.mode === Constants.MODE_ARBITRARY),
      right: timeFactor => this.cam.yaw(-this.model.user.get("rotateValue") * timeFactor, this.mode === Constants.MODE_ARBITRARY),
      up: timeFactor => this.cam.pitch(-this.model.user.get("rotateValue") * timeFactor, this.mode === Constants.MODE_ARBITRARY),
      down: timeFactor => this.cam.pitch(this.model.user.get("rotateValue") * timeFactor, this.mode === Constants.MODE_ARBITRARY),
    });

    this.input.keyboardNoLoop = new Input.KeyboardNoLoop({

      // Branches
      b: () => this.pushBranch(),
      j: () => this.popBranch(),

      // Branchpointvideo
      ".": () => this.nextNode(true),
      ",": () => this.nextNode(false),

    });

    this.input.keyboardOnce = new Input.Keyboard({

      // Delete active node and recenter last node
      "shift + space": () => this.deleteActiveNode(),
    }

    , -1);
  }


  // make sure that it is not possible to keep nodes from being created
  setWaypoint(...args) {
    if (this.isBranchpointvideoMode()) { return; }
    if (!this.model.get("flightmodeRecording")) {
      this.model.set("flightmodeRecording", true);
    }
    super.setWaypoint(...args);
  }


  deleteActiveNode() {
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
