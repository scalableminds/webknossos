import type { Action } from "viewer/model/actions/actions";
import { updateKey } from "viewer/model/helpers/deep_update";
import type { WebknossosState } from "viewer/store";

function LayerRegistrationWorkerReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "SET_LAYER_REGISTRATION_VIEW_STATE": {
      return updateKey(state, "layerRegistrationWorker", { viewState: action.viewState });
    }

    case "SET_LANDMARK_PAIR_INFO": {
      return updateKey(state, "layerRegistrationWorker", { landmarkPairInfo: action.pairInfo });
    }

    default:
      return state;
  }
}

export default LayerRegistrationWorkerReducer;
