import type { Action } from "viewer/model/actions/actions";
import type { MipLayerConfig, WebknossosState } from "viewer/store";

function MipBBoxReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "SET_MIP_FOR_BBOX": {
      const existing = state.mipBBoxSettings[action.id] ?? [];
      const updated = existing.some((l) => l.layerName === action.config.layerName)
        ? existing.map((l) => (l.layerName === action.config.layerName ? action.config : l))
        : [...existing, action.config];
      return {
        ...state,
        mipBBoxSettings: { ...state.mipBBoxSettings, [action.id]: updated },
      };
    }

    case "REMOVE_MIP_LAYER_FOR_BBOX": {
      const existing = state.mipBBoxSettings[action.id] ?? [];
      const updated = existing.filter((l) => l.layerName !== action.layerName);
      const next: Record<number, MipLayerConfig[]> = { ...state.mipBBoxSettings };
      if (updated.length === 0) {
        delete next[action.id];
      } else {
        next[action.id] = updated;
      }
      return { ...state, mipBBoxSettings: next };
    }

    case "REMOVE_MIP_FOR_BBOX": {
      const next: Record<number, MipLayerConfig[]> = { ...state.mipBBoxSettings };
      delete next[action.id];
      return { ...state, mipBBoxSettings: next };
    }

    case "DELETE_USER_BOUNDING_BOX": {
      if (!(action.id in state.mipBBoxSettings)) return state;
      const next: Record<number, MipLayerConfig[]> = { ...state.mipBBoxSettings };
      delete next[action.id];
      return { ...state, mipBBoxSettings: next };
    }

    case "RESET_STORE": {
      return { ...state, mipBBoxSettings: {} };
    }

    default:
      return state;
  }
}

export default MipBBoxReducer;
