import type { Action } from "viewer/model/actions/actions";
import { updateKey } from "viewer/model/helpers/deep_update";
import type { WebknossosState } from "viewer/store";

function LayerRegistrationLandmarkIframeReducer(
  state: WebknossosState,
  action: Action,
): WebknossosState {
  switch (action.type) {
    case "SET_LAYER_REGISTRATION_VIEW_STATE": {
      return updateKey(state, "layerRegistrationLandmarkIframe", { viewState: action.viewState });
    }

    case "SET_LANDMARK_PAIR_INFO": {
      return updateKey(state, "layerRegistrationLandmarkIframe", {
        landmarkPairInfo: action.pairInfo,
      });
    }

    default:
      return state;
  }
}

export default LayerRegistrationLandmarkIframeReducer;
