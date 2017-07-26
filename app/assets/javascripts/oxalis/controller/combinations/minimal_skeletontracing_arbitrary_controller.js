/**
 * minimal_skeletontracing_arbitrary_controller.js
 * @flow
 */

import _ from "lodash";
import Store from "oxalis/store";
import Constants from "oxalis/constants";
import ArbitraryController from "oxalis/controller/viewmodes/arbitrary_controller";
import { InputKeyboard, InputKeyboardNoLoop } from "libs/input";
import { deleteNodeAction, createBranchPointAction, requestDeleteBranchPointAction } from "oxalis/model/actions/skeletontracing_actions";
import { setFlightmodeRecordingAction } from "oxalis/model/actions/settings_actions";
import { zoomInAction, zoomOutAction, yawFlycamAction, pitchFlycamAction } from "oxalis/model/actions/flycam_actions";

class MinimalSkeletonTracingArbitraryController extends ArbitraryController {

  // See comment in Controller class on general controller architecture.
  //
  // Minimal Skeleton Tracing Arbitrary Controller:
  // Extends Arbitrary controller to add controls that are specific to minimal Arbitrary mode.
  // Initiated on TaskTypes with "Advanced Tracing Options"
  // Mainly used to simplify mechanical turk tracings

  constructor() {
    super();
    _.defer(() => this.setRecord(true));
  }

  initKeyboard(): void {
    this.input.keyboard = new InputKeyboard({
      space: timeFactor => this.move(timeFactor),
      // Zoom in/out
      i: () => { Store.dispatch(zoomInAction()); },
      o: () => { Store.dispatch(zoomOutAction()); },
      // Rotate in distance
      left: (timeFactor) => {
        const rotateValue = Store.getState().userConfiguration.rotateValue;
        Store.dispatch(yawFlycamAction(rotateValue * timeFactor, this.props.viewMode === Constants.MODE_ARBITRARY));
      },
      right: (timeFactor) => {
        const rotateValue = Store.getState().userConfiguration.rotateValue;
        Store.dispatch(yawFlycamAction(-rotateValue * timeFactor, this.props.viewMode === Constants.MODE_ARBITRARY));
      },
      up: (timeFactor) => {
        const rotateValue = Store.getState().userConfiguration.rotateValue;
        Store.dispatch(pitchFlycamAction(-rotateValue * timeFactor, this.props.viewMode === Constants.MODE_ARBITRARY));
      },
      down: (timeFactor) => {
        const rotateValue = Store.getState().userConfiguration.rotateValue;
        Store.dispatch(pitchFlycamAction(rotateValue * timeFactor, this.props.viewMode === Constants.MODE_ARBITRARY));
      },
    });

    this.input.keyboardNoLoop = new InputKeyboardNoLoop({

      // Branches
      b: () => { Store.dispatch(createBranchPointAction()); },
      j: () => { Store.dispatch(requestDeleteBranchPointAction()); },

      // Branchpointvideo
      ".": () => this.nextNode(true),
      ",": () => this.nextNode(false),

    });

    this.input.keyboardOnce = new InputKeyboard({
      // Delete active node and recenter last node
      "shift + space": () => { Store.dispatch(deleteNodeAction()); },
    }, -1);
  }

  // make sure that it is not possible to keep nodes from being created
  setWaypoint(): void {
    if (!Store.getState().flightmodeRecording) {
      Store.dispatch(setFlightmodeRecordingAction(true));
    }
    super.setWaypoint();
  }
}


export default MinimalSkeletonTracingArbitraryController;
