import update from "immutability-helper";
import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState } from "oxalis/store";

function FlycamInfoCacheReducer(state: OxalisState, action: Action): OxalisState {
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
