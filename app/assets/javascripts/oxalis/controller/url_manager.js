/**
 * url_manager.js
 * @flow weak
 */

import _ from "lodash";
import Utils from "libs/utils";
import Backbone from "backbone";
import { V3 } from "libs/mjs";
import Model from "oxalis/model";
import type { Vector3, ModeType } from "oxalis/constants";
import constants from "../constants";

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

  constructor(model) {
    this.model = model;
    this.baseUrl = document.location.pathname + document.location.search;
    this.initialState = this.parseUrl();

    _.extend(this, Backbone.Events);
  }

  update = _.throttle(
    () => location.replace(this.buildUrl()),
    this.MAX_UPDATE_INTERVAL,
  );

  parseUrl(): State {
    // State string format:
    // x,y,z,mode,zoomStep[,rotX,rotY,rotZ][,activeNode]

    const stateString = location.hash.slice(1);
    const state: State = {};

    if (stateString) {
      const stateArray = stateString.split(",");
      if (stateArray.length >= 5) {
        state.position = _.map(stateArray.slice(0, 3), e => +e);

        const modeNumber = [0, 1, 2, 3].find(el => el === +stateArray[3]);
        if (modeNumber) {
          state.mode = modeNumber;
        } else {
          // Let's default to MODE_PLANE_TRACING
          state.mode = 0;
        }
        state.zoomStep = +stateArray[4];

        if (stateArray.length >= 8) {
          state.rotation = _.map(stateArray.slice(5, 8), e => +e);

          if (stateArray[8] != null) {
            state.activeNode = +stateArray[8];
          }
        } else if (stateArray[5] != null) {
          state.activeNode = +stateArray[5];
        }
      }
    }

    return state;
  }


  startUrlUpdater() {
    this.listenTo(this.model.flycam, "changed", this.update);
    this.listenTo(this.model.flycam3d, "changed", this.update);
    this.listenTo(this.model, "change:mode", this.update);

    if (this.model.skeletonTracing) {
      this.listenTo(this.model.skeletonTracing, "newActiveNode", this.update);
    }
  }


  buildUrl() {
    const { flycam, flycam3d } = this.model;
    let state = V3.floor(flycam.getPosition());
    state.push(this.model.mode);

    if (constants.MODES_ARBITRARY.includes(this.model.mode)) {
      state = state
        .concat([flycam3d.getZoomStep().toFixed(2)])
        .concat(_.map(flycam3d.getRotation(), e => e.toFixed(2)));
    } else {
      state = state.concat([flycam.getZoomStep().toFixed(2)]);
    }

    if (Utils.__guard__(this.model.skeletonTracing, x => x.getActiveNodeId()) != null) {
      state.push(this.model.skeletonTracing.getActiveNodeId());
    }

    return `${this.baseUrl}#${state.join(",")}`;
  }
}

export default UrlManager;
