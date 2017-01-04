import app from "app";
import backbone from "backbone";
import constants from "../constants";
import { V3 } from "libs/mjs";

class UrlManager {
  static initClass() {


    this.prototype.MAX_UPDATE_INTERVAL  = 1000;
  }

  constructor(model) {

    this.model = model;
    this.baseUrl      = document.location.pathname + document.location.search;
    this.initialState = this.parseUrl();

    this.update = _.throttle(
      () => location.replace(this.buildUrl()),
      this.MAX_UPDATE_INTERVAL
    );

    _.extend(this, Backbone.Events);
  }


  parseUrl() {

    // State string format:
    // x,y,z,mode,zoomStep[,rotX,rotY,rotZ][,activeNode]

    const stateString = location.hash.slice(1);
    const state = {};

    if (stateString) {

      const stateArray = stateString.split(",");
      if (stateArray.length >= 5) {

        state.position = _.map(stateArray.slice(0, 3), e => +e);
        state.mode     = +stateArray[3];
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
      return this.listenTo(this.model.skeletonTracing, "newActiveNode", this.update);
    }
  }


  buildUrl() {

    const { flycam, flycam3d } = this.model;
    let state = V3.floor(flycam.getPosition());
    state.push( this.model.mode );

    if (constants.MODES_ARBITRARY.includes(this.model.mode)) {
      state = state
        .concat( [flycam3d.getZoomStep().toFixed(2)] )
        .concat( _.map(flycam3d.getRotation(), e => e.toFixed(2)) );

    } else {
      state = state.concat( [flycam.getZoomStep().toFixed(2)] );
    }

    if (__guard__(this.model.skeletonTracing, x => x.getActiveNodeId()) != null) {
      state.push(this.model.skeletonTracing.getActiveNodeId());
    }

    return this.baseUrl + "#" + state.join(",");
  }
}
UrlManager.initClass();

export default UrlManager;

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}
