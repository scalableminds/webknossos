import update from "immutability-helper";
import { getDataLayers } from "viewer/model/accessors/dataset_accessor";
import type { Action } from "viewer/model/actions/actions";
import { zoomReducer } from "viewer/model/reducers/flycam_reducer";
import type { WebknossosState } from "viewer/store";

function FlycamInfoCacheReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "SET_MAXIMUM_ZOOM_FOR_ALL_MAGS_FOR_LAYER": {
      const newState = update(state, {
        flycamInfoCache: {
          maximumZoomForAllMags: {
            [action.layerName]: {
              $set: action.magRange,
            },
          },
        },
      });

      const areZoomRangesKnownForAllLayers = getDataLayers(newState.dataset).every(
        (layer) => newState.flycamInfoCache.maximumZoomForAllMags[layer.name] != null,
      );
      if (!areZoomRangesKnownForAllLayers) {
        return newState;
      }

      // zoomReducer takes care of keeping the zoomStep in the valid zoom range which
      // might have changed due to the newly arrived change to maximumZoomForAllMags.
      return zoomReducer(newState, newState.flycam.zoomStep);
    }

    default:
      return state;
  }
}

export default FlycamInfoCacheReducer;
