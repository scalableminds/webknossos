import update from "immutability-helper";
import type { Action } from "viewer/model/actions/actions";
import type { WebknossosState } from "viewer/store";

function FlycamInfoCacheReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "SET_MAXIMUM_ZOOM_FOR_ALL_MAGS_FOR_LAYER": {
      return update(state, {
        flycamInfoCache: {
          maximumZoomForAllMags: {
            [action.layerName]: {
              $set: action.magRange,
            },
          },
        },
      });
    }

    default:
      return state;
  }
}

export default FlycamInfoCacheReducer;
