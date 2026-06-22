import type { Action } from "viewer/model/actions/actions";
import type { MipLayerConfig, WebknossosState } from "viewer/store";

function MipBboxReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "SET_MIP_FOR_BBOX": {
      const existing = state.mipBboxSettings[action.id] ?? [];
      const updated = existing.some((l) => l.layerName === action.config.layerName)
        ? existing.map((l) => (l.layerName === action.config.layerName ? action.config : l))
        : [...existing, action.config];
      return {
        ...state,
        mipBboxSettings: { ...state.mipBboxSettings, [action.id]: updated },
      };
    }

    case "REMOVE_MIP_LAYER_FOR_BBOX": {
      const existing = state.mipBboxSettings[action.id] ?? [];
      const updated = existing.filter((l) => l.layerName !== action.layerName);
      const next: Record<number, MipLayerConfig[]> = { ...state.mipBboxSettings };
      if (updated.length === 0) {
        delete next[action.id];
      } else {
        next[action.id] = updated;
      }
      return { ...state, mipBboxSettings: next };
    }

    case "REMOVE_MIP_FOR_BBOX": {
      const next: Record<number, MipLayerConfig[]> = { ...state.mipBboxSettings };
      delete next[action.id];
      return { ...state, mipBboxSettings: next };
    }

    case "DELETE_USER_BOUNDING_BOX": {
      if (!(action.id in state.mipBboxSettings)) return state;
      const next: Record<number, MipLayerConfig[]> = { ...state.mipBboxSettings };
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
