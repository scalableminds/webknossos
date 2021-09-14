// @flow

import _ from "lodash";

import { V3 } from "libs/mjs";
import { applyState } from "oxalis/model_initialization";
import { getRotation, getPosition } from "oxalis/model/accessors/flycam_accessor";
import { getSkeletonTracing, getActiveNode } from "oxalis/model/accessors/skeletontracing_accessor";
import Store, { type OxalisState } from "oxalis/store";
import * as Utils from "libs/utils";
import constants, { type ViewMode, ViewModeValues, type Vector3 } from "oxalis/constants";
import window, { location } from "libs/window";

const MAX_UPDATE_INTERVAL = 1000;

export type UrlManagerState = {
  position?: Vector3,
  mode?: ViewMode,
  zoomStep?: number,
  activeNode?: number,
  rotation?: Vector3,
};

class UrlManager {
  baseUrl: string;
  initialState: UrlManagerState;

  initialize() {
    this.baseUrl = location.pathname + location.search;
    this.initialState = this.parseUrlHash();
  }

  reset(): void {
    // don't use location.hash = ""; since it refreshes the page
    window.history.replaceState({}, null, location.pathname + location.search);
    this.initialize();
  }

  update = _.throttle(() => this.updateUnthrottled(), MAX_UPDATE_INTERVAL);

  updateUnthrottled() {
    const url = this.buildUrl();
    window.history.replaceState({}, null, url);
  }

  onHashChange = () => {
    const urlState = this.parseUrlHash();
    applyState(urlState);
  };

  parseUrlHash(): UrlManagerState {
    const stateString = location.hash.slice(1);
    if (stateString.includes("{")) {
      // The hash is in json format
      return this.parseUrlHashJson();
    } else if (stateString.includes("=")) {
      // The hash was changed by a comment link
      return this.parseUrlHashCommentLink();
    } else {
      // The hash is in legacy format
      return this.parseUrlHashLegacy();
    }
  }

  parseUrlHashCommentLink(): UrlManagerState {
    // Comment link format:
    // activeNode=12 or position=1,2,3

    const stateString = location.hash.slice(1);
    const [key, value] = stateString.split("=");
    // The value can either be a single number or multiple numbers delimited by a ,
    return { [key]: value.includes(",") ? value.split(",").map(Number) : Number(value) };
  }

  parseUrlHashJson(): UrlManagerState {
    // State json format:
    // { "position"?: Vector3, "mode"?: number, "zoomStep"?: number, "rotation"?: Vector3, "activeNode"?: number}

    const stateString = location.hash.slice(1);
    try {
      return JSON.parse(stateString);
    } catch (e) {
      console.error(e);
      return {};
    }
  }

  parseUrlHashLegacy(): UrlManagerState {
    // State string format:
    // x,y,z,mode,zoomStep[,rotX,rotY,rotZ][,activeNode]

    const stateString = location.hash.slice(1);
    const state: UrlManagerState = {};

    if (stateString) {
      const stateArray = stateString.split(",").map(Number);
      const validStateArray = stateArray.map(value => (!isNaN(value) ? value : 0));
      if (validStateArray.length >= 5) {
        const positionValues = validStateArray.slice(0, 3);
        state.position = Utils.numberArrayToVector3(positionValues);

        const modeString = ViewModeValues[validStateArray[3]];
        if (modeString) {
          state.mode = modeString;
        } else {
          // Let's default to MODE_PLANE_TRACING
          state.mode = constants.MODE_PLANE_TRACING;
        }
        // default to zoom step 1
        state.zoomStep = validStateArray[4] !== 0 ? validStateArray[4] : 1;

        if (validStateArray.length >= 8) {
          state.rotation = Utils.numberArrayToVector3(validStateArray.slice(5, 8));

          if (validStateArray[8] != null) {
            state.activeNode = validStateArray[8];
          }
        } else if (validStateArray[5] != null) {
          state.activeNode = validStateArray[5];
        }
      }
    }

    return state;
  }

  startUrlUpdater(): void {
    Store.subscribe(() => this.update());
    window.onhashchange = () => this.onHashChange();
  }

  buildUrlHash(state: OxalisState) {
    const position = V3.floor(getPosition(state.flycam));
    const { viewMode: mode } = state.temporaryConfiguration;
    const zoomStep = Utils.roundTo(state.flycam.zoomStep, 3);
    const rotationOptional = constants.MODES_ARBITRARY.includes(mode)
      ? { rotation: getRotation(state.flycam).map(e => Utils.roundTo(e, 2)) }
      : {};

    const activeNodeOptional = getSkeletonTracing(state.tracing)
      .chain(skeletonTracing => getActiveNode(skeletonTracing))
      .map(node => ({ activeNode: node.id }))
      .getOrElse({});

    // $FlowIssue[exponential-spread] See https://github.com/facebook/flow/issues/8299
    const urlState = { position, mode, zoomStep, ...rotationOptional, ...activeNodeOptional };

    return JSON.stringify(urlState);
  }

  buildUrl(): string {
    const state = Store.getState();
    const hash = this.buildUrlHash(state);
    const newBaseUrl = updateTypeAndId(
      this.baseUrl,
      state.tracing.annotationType,
      state.tracing.annotationId,
    );
    return `${newBaseUrl}#${hash}`;
  }
}

export function updateTypeAndId(
  baseUrl: string,
  annotationType: string,
  annotationId: string,
): string {
  // Update the baseUrl with a potentially new annotation id and or tracing type.
  // There are two possible routes (/annotations or /datasets), but the annotation id
  // will only ever be updated for the annotations route as the other route is for
  // dataset viewing only
  return baseUrl.replace(
    /^(.*\/annotations)\/(.*?)\/([^/?]*)(\/?.*)$/,
    (all, base, type, id, rest) => `${base}/${annotationType}/${annotationId}${rest}`,
  );
}

export default new UrlManager();
