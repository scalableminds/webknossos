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

  initialize(): UrlManager {
    this.baseUrl = document.location.pathname + document.location.search;
    this.initialState = this.parseUrl();
    return this;
  }

  reset(): void {
    // don't use document.location.hash = ""; since it refreshes the page
    window.history.replaceState({}, null, document.location.pathname + document.location.search);
    this.initialize();
  }

  update = _.throttle(
    () => {
      const url = this.buildUrl();
      if (!url) {
        return;
      }
      // Don't tamper with URL if changed externally for some time
      if (this.lastUrl == null || window.location.href === this.lastUrl) {
        window.history.replaceState({}, null, url);
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

        const modeString = ModeValues[stateArray[3]];
        if (modeString) {
          state.mode = modeString;
        } else {
          // Let's default to MODE_PLANE_TRACING
          state.mode = "orthogonal";
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
    const tracing = Store.getState().tracing;
    if (!tracing) {
      return null;
    }
    const viewMode = Store.getState().temporaryConfiguration.viewMode;
    let state = V3.floor(getPosition(Store.getState().flycam));
    // Convert viewMode to number
    state.push(ModeValues.indexOf(viewMode));

    if (constants.MODES_ARBITRARY.includes(viewMode)) {
      state = state
        .concat([Store.getState().flycam.zoomStep.toFixed(2)])
        .concat(getRotation(Store.getState().flycam).map(e => e.toFixed(2)));
    } else {
      state = state.concat([Store.getState().flycam.zoomStep.toFixed(2)]);
    }

    getActiveNode(tracing).map(node => state.push(node.id));
    const newBaseUrl = updateTypeAndId(this.baseUrl, tracing.tracingType, tracing.tracingId);
    return `${newBaseUrl}#${state.join(",")}`;
  }
}

export function updateTypeAndId(baseUrl: string, tracingType: string, tracingId: string): string {
  // Update the baseUrl with a potentially new tracing id and or tracing type.
  // There are two possible routes (annotations or datasets) which will be handled
  // both here. Chaining the replace function is possible, since they are mutually
  // exclusive and thus can't apply both simultaneously.
  return baseUrl
    .replace(/^(.*\/annotations)\/(.*?)\/([^/]*)(\/?.*)$/, (all, base, type, id, rest) =>
      `${base}/${tracingType}/${tracingId}${rest}`,
    )
    .replace(/^(.*\/datasets)\/([^/]*)(\/.*)$/, (all, base, id, rest) =>
      `${base}/${tracingId}${rest}`,
    );
}

export default new UrlManager();
