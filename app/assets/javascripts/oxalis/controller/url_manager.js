/**
 * url_manager.js
 * @flow
 */

import _ from "lodash";
import Utils from "libs/utils";
import Backbone from "backbone";
import { V3 } from "libs/mjs";
import Model from "oxalis/model";
import Store from "oxalis/store";
import type { Vector3, ModeType } from "oxalis/constants";
import constants, { ModeValues } from "oxalis/constants";
import { getRotation, getPosition } from "oxalis/model/accessors/flycam3d_accessor";

type State = {
  position?: Vector3,
  mode?: ModeType,
  zoomStep?: number,
  activeNode?: number,
  rotation?: Vector3,
};

class UrlManager {
  baseUrl: string;
  model: Model;
  initialState: State;
  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  MAX_UPDATE_INTERVAL = 1000;

  constructor(model: Model) {
    this.model = model;
    this.baseUrl = document.location.pathname + document.location.search;
    this.initialState = this.parseUrl();

    _.extend(this, Backbone.Events);
  }

  update = _.throttle(
    () => { location.replace(this.buildUrl()); },
    this.MAX_UPDATE_INTERVAL,
  );

  parseUrl(): State {
    // State string format:
    // x,y,z,mode,zoomStep[,rotX,rotY,rotZ][,activeNode]

    const stateString = location.hash.slice(1);
    const state: State = {};

    if (stateString) {
      const stateArray = stateString.split(",").map(item => Number(item));
      if (stateArray.length >= 5) {
        state.position = Utils.numberArrayToVector3(stateArray.slice(0, 3));

        const modeNumber = ModeValues.find(el => el === stateArray[3]);
        if (modeNumber) {
          state.mode = modeNumber;
        } else {
          // Let's default to MODE_PLANE_TRACING
          state.mode = 0;
        }
        state.zoomStep = stateArray[4];

        if (stateArray.length >= 8) {
          state.rotation = Utils.numberArrayToVector3(stateArray.slice(5, 8));

          if (stateArray[8] != null) {
            state.activeNode = stateArray[8];
          }
        } else if (stateArray[5] != null) {
          state.activeNode = stateArray[5];
        }
      }
    }

    return state;
  }


  startUrlUpdater(): void {
    this.listenTo(this.model, "change:mode", this.update);

    if (Store.getState().skeletonTracing) {
      Store.subscribe(() => this.update());
    }
  }


  buildUrl(): string {
    let state = V3.floor(getPosition(Store.getState().flycam));
    state.push(this.model.mode);

    if (constants.MODES_ARBITRARY.includes(this.model.mode)) {
      state = state
        .concat([Store.getState().flycam.zoomStep.toFixed(2)])
        .concat(getRotation(Store.getState().flycam).map(e => e.toFixed(2)));
    } else {
      state = state.concat([Store.getState().flycam.zoomStep.toFixed(2)]);
    }

    if (Store.getState().skeletonTracing.activeNodeId != null) {
      state.push(Store.getState().skeletonTracing.activeNodeId);
    }

    return `${this.baseUrl}#${state.join(",")}`;
  }
}

export default UrlManager;
