/**
 * url_manager.js
 * @flow
 */

import _ from "lodash";
import Utils from "libs/utils";
import { V3 } from "libs/mjs";
import Store from "oxalis/store";
import type { Vector3, ModeType } from "oxalis/constants";
import constants, { ModeValues } from "oxalis/constants";
import { getRotation, getPosition } from "oxalis/model/accessors/flycam_accessor";
import { getActiveNode } from "oxalis/model/accessors/skeletontracing_accessor";
import window from "libs/window";

const NO_MODIFY_TIMEOUT = 5000;
const MAX_UPDATE_INTERVAL = 1000;

export type UrlManagerState = {
  position?: Vector3,
  mode?: ModeType,
  zoomStep?: number,
  activeNode?: number,
  rotation?: Vector3,
};

class UrlManager {
  baseUrl: string;
  initialState: UrlManagerState;
  lastUrl: ?string

  constructor() {
    this.baseUrl = document.location.pathname + document.location.search;
    this.initialState = this.parseUrl();
  }

  update = _.throttle(
    () => {
      const url = this.buildUrl();
      if (!url) {
        return;
      }
      // Don't tamper with URL if changed externally for some time
      if (this.lastUrl == null || window.location.href === this.lastUrl) {
        window.location.replace(url);
        this.lastUrl = window.location.href;
      } else {
        setTimeout(() => { this.lastUrl = null; }, NO_MODIFY_TIMEOUT);
      }
    },
    MAX_UPDATE_INTERVAL,
  );

  parseUrl(): UrlManagerState {
    // State string format:
    // x,y,z,mode,zoomStep[,rotX,rotY,rotZ][,activeNode]

    const stateString = location.hash.slice(1);
    const state: UrlManagerState = {};

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
    Store.subscribe(() => this.update());
  }


  buildUrl(): ?string {
    if (!Store.getState().tracing) {
      return null;
    }
    const viewMode = Store.getState().temporaryConfiguration.viewMode;
    let state = V3.floor(getPosition(Store.getState().flycam));
    state.push(viewMode);

    if (constants.MODES_ARBITRARY.includes(viewMode)) {
      state = state
        .concat([Store.getState().flycam.zoomStep.toFixed(2)])
        .concat(getRotation(Store.getState().flycam).map(e => e.toFixed(2)));
    } else {
      state = state.concat([Store.getState().flycam.zoomStep.toFixed(2)]);
    }

    getActiveNode(Store.getState().tracing).map(node => state.push(node.id));
    return `${this.baseUrl}#${state.join(",")}`;
  }
}

export default UrlManager;
