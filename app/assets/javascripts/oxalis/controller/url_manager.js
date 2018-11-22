/**
 * url_manager.js
 * @flow
 */

import _ from "lodash";

import { V3 } from "libs/mjs";
import { applyState } from "oxalis/model_initialization";
import { getRotation, getPosition } from "oxalis/model/accessors/flycam_accessor";
import { getSkeletonTracing, getActiveNode } from "oxalis/model/accessors/skeletontracing_accessor";
import Store, { type Tracing } from "oxalis/store";
import * as Utils from "libs/utils";
import constants, { type Mode, ModeValues, type Vector3 } from "oxalis/constants";
import window, { document, location } from "libs/window";

const MAX_UPDATE_INTERVAL = 1000;

export type UrlManagerState = {
  position?: Vector3,
  mode?: Mode,
  zoomStep?: number,
  activeNode?: number,
  rotation?: Vector3,
};

class UrlManager {
  baseUrl: string;
  initialState: UrlManagerState;

  initialize() {
    this.baseUrl = document.location.pathname + document.location.search;
    this.initialState = this.parseUrl();
  }

  reset(): void {
    // don't use document.location.hash = ""; since it refreshes the page
    window.history.replaceState({}, null, document.location.pathname + document.location.search);
    this.initialize();
  }

  update = _.throttle(() => this.updateUnthrottled(), MAX_UPDATE_INTERVAL);

  updateUnthrottled() {
    const url = this.buildUrl();
    window.history.replaceState({}, null, url);
  }

  onHashChange() {
    const stateString = location.hash.slice(1);
    if (stateString) {
      const [key, value] = stateString.split("=");
      // The value can either be a single number or multiple numbers delimited by a ,
      applyState({ [key]: value.indexOf(",") > -1 ? value.split(",").map(Number) : Number(value) });
    }
  }

  parseUrl(): UrlManagerState {
    // State string format:
    // x,y,z,mode,zoomStep[,rotX,rotY,rotZ][,activeNode]

    const stateString = location.hash.slice(1);
    const state: UrlManagerState = {};

    if (stateString) {
      const stateArray = stateString.split(",").map(Number);
      if (stateArray.length >= 5) {
        state.position = Utils.numberArrayToVector3(stateArray.slice(0, 3));

        const modeString = ModeValues[stateArray[3]];
        if (modeString) {
          state.mode = modeString;
        } else {
          // Let's default to MODE_PLANE_TRACING
          state.mode = constants.MODE_PLANE_TRACING;
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
    window.onhashchange = () => this.onHashChange();
  }

  buildHash(tracing: Tracing) {
    const position = V3.floor(getPosition(Store.getState().flycam));
    const { viewMode } = Store.getState().temporaryConfiguration;
    const viewModeIndex = ModeValues.indexOf(viewMode);
    const zoomStep = Store.getState().flycam.zoomStep.toFixed(2);
    const rotation = constants.MODES_ARBITRARY.includes(viewMode)
      ? getRotation(Store.getState().flycam).map(e => e.toFixed(2))
      : [];

    const activeNodeId = getSkeletonTracing(tracing)
      .chain(skeletonTracing => getActiveNode(skeletonTracing))
      .map(node => [node.id])
      .getOrElse([]);

    return [...position, viewModeIndex, zoomStep, ...rotation, ...activeNodeId].join(",");
  }

  buildUrl(): string {
    const { tracing } = Store.getState();

    const hash = this.buildHash(tracing);
    const newBaseUrl = updateTypeAndId(this.baseUrl, tracing.tracingType, tracing.annotationId);
    return `${newBaseUrl}#${hash}`;
  }
}

export function updateTypeAndId(
  baseUrl: string,
  tracingType: string,
  annotationId: string,
): string {
  // Update the baseUrl with a potentially new annotation id and or tracing type.
  // There are two possible routes (/annotations or /datasets), but the annotation id
  // will only ever be updated for the annotations route as the other route is for
  // dataset viewing only
  return baseUrl.replace(
    /^(.*\/annotations)\/(.*?)\/([^/?]*)(\/?.*)$/,
    (all, base, type, id, rest) => `${base}/${tracingType}/${annotationId}${rest}`,
  );
}

export default new UrlManager();
