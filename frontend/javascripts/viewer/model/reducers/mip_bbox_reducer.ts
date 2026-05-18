import type { Action } from "viewer/model/actions/actions";
import type { MipBboxConfig, WebknossosState } from "viewer/store";

function MipBboxReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "SET_MIP_FOR_BBOX": {
      return {
        ...state,
        mipBboxSettings: {
          ...state.mipBboxSettings,
          [action.id]: action.config,
        },
      };
    }

    case "REMOVE_MIP_FOR_BBOX": {
      const next: Record<number, MipBboxConfig> = { ...state.mipBboxSettings };
      delete next[action.id];
      return { ...state, mipBboxSettings: next };
    }

    case "DELETE_USER_BOUNDING_BOX": {
      if (!(action.id in state.mipBboxSettings)) return state;
      const next: Record<number, MipBboxConfig> = { ...state.mipBboxSettings };
      delete next[action.id];
      return { ...state, mipBboxSettings: next };
    }

    case "RESET_STORE": {
      return { ...state, mipBboxSettings: {} };
    }

    default:
      return state;
  }
}

export default MipBboxReducer;
